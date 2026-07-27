import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HistogramPercentileEstimator,
  PERCENTILE_HISTOGRAM_INTERNALS,
} from "./percentile.js";
import type { SeriesKey } from "./types.js";

const KEY: SeriesKey = {
  exchange: "binance",
  symbol: "BTCUSDT",
  timeframe: "5m",
};

const OTHER_KEY: SeriesKey = {
  exchange: "binance",
  symbol: "ANKRUSDT",
  timeframe: "5m",
};

const DAY_0 = Date.UTC(2026, 0, 1);
const MS_PER_DAY = 86_400_000;

function makeEstimator(minSamples = 100, historyDays = 14) {
  return new HistogramPercentileEstimator({ minSamples, historyDays });
}

/** 정규분포 비슷한 표본을 결정적으로 만든다 (테스트가 흔들리면 안 된다). */
function pseudoNormal(index: number): number {
  const a = Math.sin(index * 12.9898) * 43758.5453;
  const b = Math.sin(index * 78.233) * 12345.6789;
  return (a - Math.floor(a)) + (b - Math.floor(b)) - 1;
}

describe("구간 설계", () => {
  const { toBinIndex, BIN_COUNT } = PERCENTILE_HISTOGRAM_INTERNALS;

  it("S가 커지면 구간 인덱스도 단조 증가한다", () => {
    let previous = -1;
    for (const s of [-100, -5, -1, 0, 1, 3, 10, 50, 500]) {
      const bin = toBinIndex(s);
      assert.ok(bin >= previous, `S=${s}에서 역전`);
      previous = bin;
    }
  });

  it("범위를 벗어나도 구간 안에 안전하게 들어간다", () => {
    assert.equal(toBinIndex(-1e12), 0);
    assert.equal(toBinIndex(1e12), BIN_COUNT - 1);
  });

  it("우리가 신경 쓰는 구간(S 2~5)의 해상도가 살아 있다", () => {
    // 상위 1~5% 판정이 일어나는 영역이라 여기가 뭉개지면 안 된다.
    const bins = new Set([2, 2.5, 3, 3.5, 4, 4.5, 5].map(toBinIndex));
    assert.equal(bins.size, 7);
  });
});

describe("HistogramPercentileEstimator", () => {
  it("표본이 부족하면 null", () => {
    const estimator = makeEstimator(100);

    for (let i = 0; i < 99; i += 1) {
      estimator.observe(KEY, i / 100, DAY_0);
    }

    assert.equal(estimator.toPercentile(KEY, 0.5), null);
    assert.equal(estimator.sampleCount(KEY), 99);
  });

  it("표본이 충분해지면 값을 낸다", () => {
    const estimator = makeEstimator(100);

    for (let i = 0; i < 200; i += 1) {
      estimator.observe(KEY, i / 100, DAY_0);
    }

    const result = estimator.toPercentile(KEY, 0.5);
    assert.ok(result !== null);
  });

  it("관측한 적 없는 키는 null", () => {
    const estimator = makeEstimator(1);
    estimator.observe(KEY, 1, DAY_0);
    assert.equal(estimator.toPercentile(OTHER_KEY, 1), null);
  });

  it("키마다 분포를 따로 관리한다", () => {
    const estimator = makeEstimator(10);

    // KEY는 조용한 종목, OTHER_KEY는 원래 심하게 흔들리는 종목.
    for (let i = 0; i < 100; i += 1) {
      estimator.observe(KEY, i / 100, DAY_0);
      estimator.observe(OTHER_KEY, i / 2, DAY_0);
    }

    const quiet = estimator.toPercentile(KEY, 5);
    const volatile = estimator.toPercentile(OTHER_KEY, 5);

    assert.ok(quiet !== null && volatile !== null);
    // 같은 S=5가 종목에 따라 전혀 다른 백분위여야 한다.
    assert.ok(quiet > 99, `조용한 종목: ${quiet}`);
    assert.ok(volatile < 30, `변동 큰 종목: ${volatile}`);
  });

  it("백분위가 실제 상위 비율과 맞는다", () => {
    const estimator = makeEstimator(100);
    const samples: number[] = [];

    for (let i = 0; i < 20_000; i += 1) {
      const s = pseudoNormal(i) * 3;
      samples.push(s);
      estimator.observe(KEY, s, DAY_0);
    }

    const sorted = [...samples].sort((a, b) => a - b);

    for (const target of [50, 90, 95, 99]) {
      const cutoff = sorted[Math.floor((target / 100) * sorted.length)];
      assert.ok(cutoff !== undefined);

      const estimated = estimator.toPercentile(KEY, cutoff);
      assert.ok(estimated !== null);

      // 히스토그램 근사라 정확히 일치하지는 않는다. 1%p 안이면 충분하다.
      assert.ok(
        Math.abs(estimated - target) < 1,
        `목표 ${target}, 추정 ${estimated.toFixed(2)}`,
      );
    }
  });

  it("단조성: S가 크면 백분위도 크거나 같다", () => {
    const estimator = makeEstimator(10);
    for (let i = 0; i < 5_000; i += 1) {
      estimator.observe(KEY, pseudoNormal(i) * 2, DAY_0);
    }

    let previous = -1;
    for (const s of [-5, -1, 0, 0.5, 1, 2, 5, 20]) {
      const p = estimator.toPercentile(KEY, s);
      assert.ok(p !== null);
      assert.ok(p >= previous, `S=${s}에서 백분위 역전`);
      previous = p;
    }
  });

  it("보관 기간을 넘긴 날짜는 버린다", () => {
    const estimator = makeEstimator(1, 3);

    for (let day = 0; day < 10; day += 1) {
      for (let i = 0; i < 100; i += 1) {
        estimator.observe(KEY, 1, DAY_0 + day * MS_PER_DAY);
      }
    }

    // 3일치만 남아야 한다.
    assert.equal(estimator.sampleCount(KEY), 300);
  });

  it("NaN과 Infinity는 무시한다", () => {
    const estimator = makeEstimator(1);

    estimator.observe(KEY, Number.NaN, DAY_0);
    estimator.observe(KEY, Number.POSITIVE_INFINITY, DAY_0);
    assert.equal(estimator.sampleCount(KEY), 0);

    estimator.observe(KEY, 1, DAY_0);
    assert.equal(estimator.toPercentile(KEY, Number.NaN), null);
  });
});
