import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TimeDecayCooldown } from "./cooldown.js";
import type { SeriesKey, Timeframe } from "./types.js";

const KEY: SeriesKey = {
  exchange: "binance",
  symbol: "BTCUSDT",
  timeframe: "5m",
};

const OTHER_FRAME: SeriesKey = { ...KEY, timeframe: "1h" };

const T0 = Date.UTC(2026, 0, 1);

const DURATIONS: Record<Timeframe, number> = {
  "1m": 100,
  "5m": 100,
  "15m": 100,
  "1h": 100,
  "4h": 100,
  "1d": 100,
};

function makeCooldown(curve: "linear" | "exponential" = "exponential") {
  return new TimeDecayCooldown({
    tightening: 5,
    durations: DURATIONS,
    curve,
  });
}

describe("TimeDecayCooldown", () => {
  it("발사 전에는 민감도 그대로", () => {
    const cooldown = makeCooldown();
    assert.equal(cooldown.effectiveThreshold(KEY, 95, T0), 95);
  });

  it("발사 직후에는 꼬리가 조여진다", () => {
    const cooldown = makeCooldown();
    cooldown.record(KEY, T0);

    // 민감도 95 = 상위 5%. 5배로 조이면 상위 1% = 임계 99.
    const threshold = cooldown.effectiveThreshold(KEY, 95, T0);
    assert.ok(Math.abs(threshold - 99) < 0.01, `실제: ${threshold}`);
  });

  it("쿨다운이 끝나면 정확히 원래 값으로 돌아온다", () => {
    const cooldown = makeCooldown();
    cooldown.record(KEY, T0);

    assert.equal(cooldown.effectiveThreshold(KEY, 95, T0 + 100_000), 95);
    assert.equal(cooldown.effectiveThreshold(KEY, 95, T0 + 200_000), 95);
  });

  it("시간이 지날수록 단조롭게 풀린다", () => {
    const cooldown = makeCooldown();
    cooldown.record(KEY, T0);

    let previous = Number.POSITIVE_INFINITY;
    for (let elapsed = 0; elapsed <= 100; elapsed += 10) {
      const threshold = cooldown.effectiveThreshold(
        KEY,
        95,
        T0 + elapsed * 1000,
      );
      assert.ok(threshold <= previous, `${elapsed}초에서 역전`);
      previous = threshold;
    }
  });

  it("민감도가 높아도 임계가 100을 넘지 않는다", () => {
    // 백분위에 덧셈을 하면 여기서 103이 나와 완전 묵음이 된다.
    // 곱셈 방식을 쓰는 이유가 이것이다 (docs/decisions.md 7번).
    const cooldown = makeCooldown();
    cooldown.record(KEY, T0);

    for (const sensitivity of [95, 99, 99.9, 99.99]) {
      const threshold = cooldown.effectiveThreshold(KEY, sensitivity, T0);
      assert.ok(threshold < 100, `민감도 ${sensitivity} → ${threshold}`);
    }
  });

  it("민감도가 몇이든 꼬리를 같은 배수로 조인다", () => {
    const cooldown = makeCooldown();
    cooldown.record(KEY, T0);

    for (const sensitivity of [90, 95, 99, 99.9]) {
      const threshold = cooldown.effectiveThreshold(KEY, sensitivity, T0);
      const tailBefore = 100 - sensitivity;
      const tailAfter = 100 - threshold;
      assert.ok(
        Math.abs(tailBefore / tailAfter - 5) < 0.01,
        `민감도 ${sensitivity}: ${tailBefore / tailAfter}배`,
      );
    }
  });

  it("충분히 큰 사건은 쿨다운 중에도 통과한다", () => {
    // 고정 시간 묵음과의 차이. 조여진 임계보다 크면 여전히 나간다.
    const cooldown = makeCooldown();
    cooldown.record(KEY, T0);

    const threshold = cooldown.effectiveThreshold(KEY, 95, T0 + 10_000);
    assert.ok(99.95 > threshold, `임계 ${threshold}`);
  });

  it("프레임마다 따로 관리된다", () => {
    const cooldown = makeCooldown();
    cooldown.record(KEY, T0);

    assert.ok(cooldown.effectiveThreshold(KEY, 95, T0) > 95);
    assert.equal(cooldown.effectiveThreshold(OTHER_FRAME, 95, T0), 95);
  });

  it("exponential이 linear보다 빨리 풀린다", () => {
    // 쿨다운 끝에서 0에 닿도록 정규화하면 exp(-3x)는 구간 내내
    // 1-x 아래에 있다. 30% 지점에서 0.375 대 0.7.
    // "지수는 꼬리가 길다"는 통념과 반대이므로 여기에 고정해둔다.
    const linear = makeCooldown("linear");
    const exponential = makeCooldown("exponential");

    linear.record(KEY, T0);
    exponential.record(KEY, T0);

    for (const elapsed of [10, 30, 50, 70, 90]) {
      const at = T0 + elapsed * 1000;
      assert.ok(
        exponential.effectiveThreshold(KEY, 95, at) <
          linear.effectiveThreshold(KEY, 95, at),
        `${elapsed}초에서 역전`,
      );
    }
  });

  it("clear로 상태를 지운다", () => {
    const cooldown = makeCooldown();
    cooldown.record(KEY, T0);
    cooldown.clear();

    assert.equal(cooldown.effectiveThreshold(KEY, 95, T0), 95);
    assert.equal(cooldown.lastFired(KEY), null);
  });
});
