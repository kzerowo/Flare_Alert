import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAD_FLOOR_RATIO } from "./constants.js";
import { computeBaseline, computeScore, ratioToMedian } from "./score.js";
import type { RollingWindow, SeriesKey } from "./types.js";

const KEY: SeriesKey = {
  exchange: "binance",
  symbol: "BTCUSDT",
  timeframe: "5m",
};

function makeWindow(velocity: number): RollingWindow {
  return {
    key: KEY,
    openedAtMs: 0,
    evaluatedAtMs: 60_000,
    elapsedMinutes: 1,
    quoteVolume: velocity,
    velocity,
  };
}

describe("computeBaseline", () => {
  it("중앙값과 MAD를 낸다", () => {
    const baseline = computeBaseline([10, 12, 8, 10, 10]);
    assert.equal(baseline.median, 10);
    assert.equal(baseline.sampleCount, 5);
    assert.ok(baseline.mad > 0);
  });

  it("MAD가 하한 아래로 내려가지 않는다", () => {
    // 전부 100이라 원래 MAD는 0이다.
    const baseline = computeBaseline([100, 100, 100, 100]);
    assert.equal(baseline.mad, 100 * MAD_FLOOR_RATIO);
  });

  it("하한은 중앙값에 비례한다 (종목 규모와 무관하게 작동해야 함)", () => {
    const big = computeBaseline([1_000_000, 1_000_000, 1_000_000]);
    const small = computeBaseline([10, 10, 10]);

    // 규모가 10만 배 차이나면 하한도 10만 배 차이나야 한다.
    assert.equal(big.mad / small.mad, 100_000);
  });

  it("실제 MAD가 하한보다 크면 그대로 쓴다", () => {
    const baseline = computeBaseline([10, 50, 90, 10, 90]);
    assert.ok(baseline.mad > baseline.median * MAD_FLOOR_RATIO);
  });

  it("빈 표본은 던진다", () => {
    assert.throws(() => computeBaseline([]));
  });
});

describe("computeScore", () => {
  it("중앙값과 같으면 0", () => {
    const baseline = computeBaseline([10, 12, 8, 10, 10]);
    assert.equal(computeScore(makeWindow(baseline.median), baseline), 0);
  });

  it("MAD 하나만큼 위면 1", () => {
    const baseline = computeBaseline([10, 12, 8, 10, 10]);
    const window = makeWindow(baseline.median + baseline.mad);
    assert.equal(computeScore(window, baseline), 1);
  });

  it("아래로 벗어나면 음수", () => {
    const baseline = computeBaseline([10, 12, 8, 10, 10]);
    const score = computeScore(makeWindow(1), baseline);
    assert.ok(score !== null && score < 0);
  });

  it("MAD가 0이면 null (죽은 종목은 점수로 판단하지 않는다)", () => {
    // 속도가 계속 0이었던 종목. 하한도 0이라 분모가 살아나지 않는다.
    const baseline = computeBaseline([0, 0, 0, 0]);
    assert.equal(baseline.mad, 0);
    assert.equal(computeScore(makeWindow(500), baseline), null);
  });

  it("규모가 달라도 같은 상대 급등이면 같은 점수", () => {
    // 이게 이 서비스의 핵심 주장이다. 절대 거래량이 10만 배 달라도
    // "평소 대비 얼마나 벗어났나"가 같으면 점수가 같아야 한다.
    const smallBase = computeBaseline([10, 12, 8, 10, 11, 9]);
    const bigBase = computeBaseline([
      1_000_000, 1_200_000, 800_000, 1_000_000, 1_100_000, 900_000,
    ]);

    const smallScore = computeScore(
      makeWindow(smallBase.median + 3 * smallBase.mad),
      smallBase,
    );
    const bigScore = computeScore(
      makeWindow(bigBase.median + 3 * bigBase.mad),
      bigBase,
    );

    assert.equal(smallScore, 3);
    assert.equal(bigScore, 3);
  });
});

describe("ratioToMedian", () => {
  it("표시용 배수를 낸다", () => {
    const baseline = computeBaseline([10, 10, 10, 10]);
    assert.equal(ratioToMedian(makeWindow(30), baseline), 3);
  });

  it("중앙값이 0이면 null", () => {
    const baseline = computeBaseline([0, 0, 0]);
    assert.equal(ratioToMedian(makeWindow(30), baseline), null);
  });
});
