import assert from "node:assert/strict";
import { test } from "node:test";

import { LOOKBACK_WINDOW_COUNT, SENSITIVITY_SCALES } from "./constants.js";
import {
  MIN_LABELS_FOR_FIT,
  bandRange,
  computeBarRatios,
  fitSensitivity,
} from "./sensitivity-test.js";
import type { LabeledBar } from "./sensitivity-test.js";
import { levelForScale, sensitivityAt } from "./sensitivity.js";
import type { Timeframe } from "./types.js";

// ---------------------------------------------------------------------------
// computeBarRatios
// ---------------------------------------------------------------------------

test("기준선을 만들 과거가 없는 앞쪽 봉은 배수가 없다", () => {
  const lookback = LOOKBACK_WINDOW_COUNT["15m"];
  const volumes = Array.from({ length: lookback + 5 }, () => 100);

  const ratios = computeBarRatios(volumes, "15m");

  assert.equal(ratios.length, volumes.length);
  for (let i = 0; i < lookback; i += 1) {
    assert.equal(ratios[i], null, `${i}번 봉은 null이어야 한다`);
  }
  for (let i = lookback; i < volumes.length; i += 1) {
    assert.equal(ratios[i], 1, `${i}번 봉은 평탄하므로 1배다`);
  }
});

test("배수는 직전 봉들의 중앙값 대비다", () => {
  const lookback = LOOKBACK_WINDOW_COUNT["5m"];
  const volumes = [...Array.from({ length: lookback }, () => 200), 700];

  const ratios = computeBarRatios(volumes, "5m");

  assert.equal(ratios[lookback], 3.5);
});

test("중앙값이 0이면 배수가 아니라 null이다", () => {
  const lookback = LOOKBACK_WINDOW_COUNT["1h"];
  const volumes = [...Array.from({ length: lookback }, () => 0), 500];

  const ratios = computeBarRatios(volumes, "1h");

  // 거래가 없던 구간에 "무한대 배수"를 주면 죽은 코인이 모든 라벨을
  // 지배한다. score.ts가 MAD 0에서 null을 내는 것과 같은 이유다.
  assert.equal(ratios[lookback], null);
});

test("중앙값은 평균이 아니다 — 급등 한 번이 기준선을 끌어올리지 않는다", () => {
  const lookback = LOOKBACK_WINDOW_COUNT["15m"];
  const history = Array.from({ length: lookback }, () => 100);
  history[0] = 100_000; // 한 봉만 거대한 급등
  const volumes = [...history, 400];

  const ratios = computeBarRatios(volumes, "15m");

  // 평균 기준이면 배수가 0.1 근처로 뭉개진다. 중앙값은 100을 지킨다.
  assert.equal(ratios[lookback], 4);
});

// ---------------------------------------------------------------------------
// bandRange
// ---------------------------------------------------------------------------

test("구간의 오른쪽 끝이 그 봉의 앵커 자리다", () => {
  for (const scale of SENSITIVITY_SCALES) {
    const { max } = bandRange(scale.timeframe);
    assert.equal(
      max,
      levelForScale(scale.timeframe),
      `${scale.timeframe} 구간의 끝이 앵커와 어긋난다`,
    );
  }
});

test("구간들은 1~100을 빈틈없이 덮고 겹치지 않는다", () => {
  const ranges = SENSITIVITY_SCALES.map((scale) => bandRange(scale.timeframe));

  assert.equal(ranges[0]?.min, 1);
  assert.equal(ranges[ranges.length - 1]?.max, 100);

  for (let i = 1; i < ranges.length; i += 1) {
    assert.equal(ranges[i]?.min, (ranges[i - 1]?.max ?? 0) + 1);
  }
});

// ---------------------------------------------------------------------------
// fitSensitivity
// ---------------------------------------------------------------------------

/** 배수 목록을 라벨 붙은 봉으로. wanted에 든 인덱스만 찍은 것으로 본다. */
function bars(ratios: number[], wanted: number[]): LabeledBar[] {
  const marked = new Set(wanted);
  return ratios.map((ratio, index) => ({
    ratio,
    wanted: marked.has(index),
  }));
}

test("라벨이 너무 적으면 추정하지 않는다", () => {
  const few = bars([10, 2, 1, 1, 1], [0, 1]);

  assert.equal(fitSensitivity(few, "15m"), null);
  assert.equal(
    bars([10, 2, 1], [0, 1]).filter((bar) => bar.wanted).length,
    MIN_LABELS_FOR_FIT - 1,
  );
});

test("추천 위치는 언제나 고른 봉의 구간 안이다", () => {
  for (const scale of SENSITIVITY_SCALES) {
    const { min, max } = bandRange(scale.timeframe);

    // 아주 느슨한 라벨(작은 봉까지 다 찍음)과 아주 빡빡한 라벨 양쪽 모두.
    const loose = bars([1.2, 1.5, 2, 2.5, 3, 1, 1, 1], [0, 1, 2, 3, 4]);
    const strict = bars([80, 60, 50, 5, 4, 3, 2, 1], [0, 1, 2]);

    for (const labels of [loose, strict]) {
      const fit = fitSensitivity(labels, scale.timeframe);
      assert.ok(fit !== null, `${scale.timeframe}에서 추정에 실패했다`);
      assert.ok(
        fit.level >= min && fit.level <= max,
        `${scale.timeframe}: ${fit.level}이 구간 ${min}~${max} 밖이다`,
      );
      assert.equal(fit.timeframe, scale.timeframe);
    }
  }
});

test("깨끗하게 갈리는 라벨은 전부 잡고 헛울림이 없다", () => {
  // 찍은 것은 크게, 안 찍은 것은 작게. 사이가 넓다.
  const labels = bars([12, 11, 10, 9, 1.2, 1.1, 1, 1, 1, 1], [0, 1, 2, 3]);

  const fit = fitSensitivity(labels, "15m");

  assert.ok(fit !== null);
  assert.equal(fit.recall, 1);
  assert.equal(fit.precision, 1);
  assert.equal(fit.caught, 4);
  assert.equal(fit.extra, 0);
});

test("잡봉 사이에 섞인 오클릭 하나는 민감도를 끌어내리지 않는다", () => {
  // 실제 화면과 같은 모양으로 깐다. 평범한 봉 90개가 0.4~2.2배에 촘촘히
  // 깔려 있고, 그 위에 뚜렷한 급등 5개가 있다.
  const ordinary = Array.from(
    { length: 90 },
    (_, i) => 0.4 + (i * 1.8) / 89,
  );
  const ratios = [14, 12, 11, 10, 9, ...ordinary];

  // 급등 5개를 찍고, 1.1배쯤 되는 평범한 봉 하나를 실수로 눌렀다.
  const slip = 5 + 35;
  assert.ok(
    Math.abs((ratios[slip] ?? 0) - 1.1) < 0.05,
    "오클릭 대상은 잡봉 한가운데여야 한다",
  );

  const mistaken = fitSensitivity(bars(ratios, [0, 1, 2, 3, 4, slip]), "15m");
  const intended = fitSensitivity(bars(ratios, [0, 1, 2, 3, 4]), "15m");

  assert.ok(mistaken !== null && intended !== null);

  // 찍은 것을 전부 잡는 최소 배수를 임계로 삼았다면 1.1까지 내려가면서
  // 잡봉 50여 개를 같이 데려왔을 것이다. F1은 그 하나를 버린다.
  assert.equal(mistaken.level, intended.level);
  assert.equal(mistaken.caught, 5);
  assert.equal(mistaken.extra, 0);
});

test("임계는 찍은 봉과 안 찍은 봉 사이에 자리 잡는다", () => {
  // 찍은 것(9배 이상)과 안 찍은 것(1.5배 이하) 사이가 텅 비어 있다.
  const labels = bars([20, 15, 12, 9, 1.5, 1.4, 1.2, 1, 1, 1], [0, 1, 2, 3]);

  const fit = fitSensitivity(labels, "1m");

  assert.ok(fit !== null);
  assert.equal(fit.recall, 1);
  assert.equal(fit.precision, 1);
  // 찍은 것 중 가장 작은 봉은 넘지 않고, 안 찍은 것 중 가장 큰 봉보다는 높다.
  assert.ok(fit.ratio <= 9, `${fit.ratio}배는 찍은 봉을 놓친다`);
  assert.ok(fit.ratio > 1.5, `${fit.ratio}배는 안 찍은 봉을 데려온다`);
});

test("잦은 쪽으로 더 갈 수 없으면 loud로 잘렸다고 알린다", () => {
  // 구간에서 가장 낮은 배수보다도 작은 봉들을 찍었다.
  const labels = bars([2, 1.9, 1.8, 1.7, 1.6], [0, 1, 2, 3, 4]);

  const fit = fitSensitivity(labels, "5m");

  assert.ok(fit !== null);
  assert.equal(fit.level, bandRange("5m").max);
  assert.equal(fit.clamped, "loud");
  assert.ok(fit.recall < 1, "다 잡았다면 잘린 것이 아니다");
});

test("조용한 쪽으로 더 갈 수 없으면 quiet으로 잘렸다고 알린다", () => {
  // 아주 큰 봉만 셋 찍었는데, 구간에서 가장 높은 배수로도 다른 큰 봉들이
  // 같이 울린다.
  const labels = bars([200, 180, 170, 60, 55, 50, 45], [0, 1, 2]);

  const fit = fitSensitivity(labels, "4h");

  assert.ok(fit !== null);
  assert.equal(fit.level, bandRange("4h").min);
  assert.equal(fit.clamped, "quiet");
  assert.ok(fit.extra > 0, "헛울림이 없다면 잘린 것이 아니다");
});

test("재현율·정밀도는 추천한 자리의 실제 성적이다", () => {
  const labels = bars([20, 15, 8, 6, 5, 4, 3, 2, 1, 1], [0, 1, 2, 5]);

  const fit = fitSensitivity(labels, "15m");
  assert.ok(fit !== null);

  const fired = labels.filter((bar) => bar.ratio >= fit.ratio);
  const caught = fired.filter((bar) => bar.wanted).length;

  assert.equal(fit.caught, caught);
  assert.equal(fit.extra, fired.length - caught);
  assert.equal(fit.recall, caught / 4);
  assert.equal(fit.precision, caught / fired.length);
  assert.equal(fit.wanted, 4);
});

test("추천한 자리의 배수·빈도는 슬라이더가 그 자리에서 보여주는 값과 같다", () => {
  const labels = bars([12, 10, 9, 8, 2, 1.5, 1, 1], [0, 1, 2, 3]);

  for (const timeframe of SENSITIVITY_SCALES.map((s) => s.timeframe)) {
    const fit = fitSensitivity(labels, timeframe as Timeframe);
    assert.ok(fit !== null);

    // 결과 화면과 슬라이더가 다른 숫자를 말하면 사용자는 둘 중 하나를
    // 거짓으로 받아들인다.
    const shown = sensitivityAt(fit.level);
    assert.equal(fit.ratio, shown.ratio);
    assert.equal(fit.alertsPerDay, shown.alertsPerDay);
    assert.equal(fit.timeframe, shown.timeframe);
  }
});
