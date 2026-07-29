import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LOOKBACK_WINDOW_COUNT,
  MIN_ELAPSED_SECONDS,
  TIMEFRAME_MINUTES,
} from "@flare-alert/core";
import type { Timeframe } from "@flare-alert/core";

import { SymbolAggregator } from "./aggregator.js";

/** 프레임 하나를 깨우는 데 필요한 최소 초. 완결 창 lookback개. */
function warmupSeconds(timeframe: Timeframe): number {
  return LOOKBACK_WINDOW_COUNT[timeframe] * TIMEFRAME_MINUTES[timeframe] * 60;
}

function sliceOf(aggregator: SymbolAggregator, timeframe: Timeframe) {
  return aggregator.slices().find((slice) => slice.timeframe === timeframe);
}

describe("SymbolAggregator 창 경계", () => {
  it("창이 절대 시각 기준으로 열린다", () => {
    // 1일봉이 UTC 자정에 열려야 한다. 프로세스를 켠 시각이 기준이 되면
    // 백테스트에서 잰 값과 다른 창을 보게 된다.
    const aggregator = new SymbolAggregator("TESTUSDT");

    // 자정 직전 1분부터 시작한다.
    const midnight = 1_800_000 * 86_400; // 86400의 배수 = UTC 자정
    aggregator.feedMinute(midnight - 60, 100, 1);
    aggregator.feedMinute(midnight, 100, 1);

    const daily = aggregator.slices().find((s) => s.timeframe === "1d");
    // 아직 lookback이 안 차서 slice가 안 나오는 게 정상이다.
    assert.equal(daily, undefined);

    // 대신 경과 시간이 자정 기준으로 세어지는지는 내부 상태로 본다.
    // 자정 직후 1분을 넣었으므로 1일 창은 방금 열렸다.
    assert.equal(aggregator.currentSecond, midnight + 59);
  });

  it("경과 시간이 창이 열린 뒤로만 세어진다", () => {
    const aggregator = new SymbolAggregator("TESTUSDT");
    const timeframe: Timeframe = "1m";
    const start = 1_800_000 * 86_400;

    // 완결 창을 lookback개 만든다.
    const lookback = LOOKBACK_WINDOW_COUNT[timeframe];
    for (let i = 0; i < lookback; i += 1) {
      aggregator.feedMinute(start + i * 60, 600, 1);
    }

    // 다음 창의 첫 초부터 초 단위로 진행한다.
    const windowStart = start + lookback * 60;
    for (let s = 0; s < 30; s += 1) {
      aggregator.advanceSecond(windowStart + s);
    }

    const slice = sliceOf(aggregator, timeframe);
    assert.ok(slice !== undefined);
    assert.equal(slice.elapsedSeconds, 30);
    assert.equal(slice.openedAtMs, windowStart * 1000);
  });

  it("창이 바뀌면 누적이 0부터 다시 쌓인다", () => {
    const aggregator = new SymbolAggregator("TESTUSDT");
    const start = 1_800_000 * 86_400;
    const lookback = LOOKBACK_WINDOW_COUNT["1m"];

    for (let i = 0; i < lookback; i += 1) {
      aggregator.feedMinute(start + i * 60, 600, 1);
    }

    const windowStart = start + lookback * 60;
    for (let s = 0; s < 60; s += 1) {
      aggregator.advanceSecond(windowStart + s);
    }
    // 이 창은 거래가 없었으므로 0이어야 한다.
    assert.equal(sliceOf(aggregator, "1m")?.quoteVolume, 0);

    // 다음 창 첫 초에 체결을 넣는다. 판정이 시작되는 시점까지 진행해야
    // slice가 나오므로 MIN_ELAPSED_SECONDS만큼 흘린다.
    const next = windowStart + 60;
    aggregator.ingest(next * 1000, 10, 500);
    const minElapsed = MIN_ELAPSED_SECONDS["1m"];
    for (let s = 0; s < minElapsed; s += 1) {
      aggregator.advanceSecond(next + s);
    }

    const slice = sliceOf(aggregator, "1m");
    assert.equal(slice?.quoteVolume, 500);
    assert.equal(slice?.elapsedSeconds, minElapsed);
  });
});

describe("SymbolAggregator 속도", () => {
  it("속도가 분당 거래대금이다", () => {
    const aggregator = new SymbolAggregator("TESTUSDT");
    const start = 1_800_000 * 86_400;
    const lookback = LOOKBACK_WINDOW_COUNT["1m"];

    for (let i = 0; i < lookback; i += 1) {
      aggregator.feedMinute(start + i * 60, 600, 1);
    }

    const windowStart = start + lookback * 60;
    // 30초 동안 300을 넣으면 분당 600이다.
    for (let s = 0; s < 30; s += 1) {
      aggregator.ingest((windowStart + s) * 1000, 10, 10);
      aggregator.advanceSecond(windowStart + s);
    }

    const slice = sliceOf(aggregator, "1m");
    assert.ok(slice !== undefined);
    assert.equal(slice.quoteVolume, 300);
    assert.equal(slice.velocity, 600);
  });

  it("완결 창의 속도가 기준선 표본으로 쌓인다", () => {
    const aggregator = new SymbolAggregator("TESTUSDT");
    const start = 1_800_000 * 86_400;
    const lookback = LOOKBACK_WINDOW_COUNT["1m"];

    // 분당 600씩 흘려보낸다.
    for (let i = 0; i < lookback; i += 1) {
      aggregator.feedMinute(start + i * 60, 600, 1);
    }
    // 창 하나를 더 열어야 slice가 나온다.
    aggregator.feedMinute(start + lookback * 60, 600, 1);

    const slice = sliceOf(aggregator, "1m");
    assert.ok(slice !== undefined);
    assert.equal(slice.velocities.length, lookback);
    for (const velocity of slice.velocities) {
      assert.equal(velocity, 600);
    }
  });
});

describe("SymbolAggregator 예열", () => {
  it("완결 창이 모자라면 프레임이 나오지 않는다", () => {
    const aggregator = new SymbolAggregator("TESTUSDT");
    const start = 1_800_000 * 86_400;

    // 1분 창을 lookback - 1개만 만든다.
    const lookback = LOOKBACK_WINDOW_COUNT["1m"];
    for (let i = 0; i < lookback - 1; i += 1) {
      aggregator.feedMinute(start + i * 60, 600, 1);
    }

    assert.equal(sliceOf(aggregator, "1m"), undefined);

    // 하나 더 넣으면(= 완결 창이 lookback개) 나온다.
    aggregator.feedMinute(start + (lookback - 1) * 60, 600, 1);
    aggregator.feedMinute(start + lookback * 60, 600, 1);
    assert.ok(sliceOf(aggregator, "1m") !== undefined);
  });

  it("창이 열린 직후에는 판정하지 않는다", () => {
    // 표본이 적을 때 v = 거래대금 / 경과분 이 발산한다.
    const aggregator = new SymbolAggregator("TESTUSDT");
    const start = 1_800_000 * 86_400;
    const lookback = LOOKBACK_WINDOW_COUNT["1m"];

    for (let i = 0; i < lookback; i += 1) {
      aggregator.feedMinute(start + i * 60, 600, 1);
    }

    const windowStart = start + lookback * 60;
    const minElapsed = MIN_ELAPSED_SECONDS["1m"];

    for (let s = 0; s < minElapsed - 1; s += 1) {
      aggregator.advanceSecond(windowStart + s);
    }
    assert.equal(sliceOf(aggregator, "1m"), undefined);

    aggregator.advanceSecond(windowStart + minElapsed - 1);
    assert.ok(sliceOf(aggregator, "1m") !== undefined);
  });

  it("긴 프레임일수록 늦게 깨어난다", () => {
    const aggregator = new SymbolAggregator("TESTUSDT");
    const start = 1_800_000 * 86_400;

    // 1분 프레임만 깨어날 만큼 넣는다.
    const minutes = warmupSeconds("1m") / 60 + 1;
    for (let i = 0; i < minutes; i += 1) {
      aggregator.feedMinute(start + i * 60, 600, 1);
    }

    const ready = aggregator.slices().map((slice) => slice.timeframe);
    assert.deepEqual(ready, ["1m"]);
  });
});

describe("SymbolAggregator 체결 버퍼", () => {
  it("이미 지나간 초의 체결은 버린다", () => {
    // 늦게 온 체결을 소급 반영하면 같은 창을 두 번 다른 값으로 평가하게 된다.
    const aggregator = new SymbolAggregator("TESTUSDT");
    const start = 1_800_000 * 86_400;
    const lookback = LOOKBACK_WINDOW_COUNT["1m"];

    for (let i = 0; i < lookback; i += 1) {
      aggregator.feedMinute(start + i * 60, 600, 1);
    }

    const windowStart = start + lookback * 60;
    aggregator.advanceSecond(windowStart);
    aggregator.advanceSecond(windowStart + 1);

    // 이미 지난 초로 들어온 체결.
    aggregator.ingest((windowStart + 1) * 1000, 10, 999);

    // 판정이 시작되는 시점까지 진행한다.
    for (let s = 2; s < MIN_ELAPSED_SECONDS["1m"]; s += 1) {
      aggregator.advanceSecond(windowStart + s);
    }

    assert.equal(sliceOf(aggregator, "1m")?.quoteVolume, 0);
  });

  it("미래 초의 체결은 그 초가 올 때 반영된다", () => {
    const aggregator = new SymbolAggregator("TESTUSDT");
    const start = 1_800_000 * 86_400;
    const lookback = LOOKBACK_WINDOW_COUNT["1m"];

    for (let i = 0; i < lookback; i += 1) {
      aggregator.feedMinute(start + i * 60, 600, 1);
    }

    const windowStart = start + lookback * 60;
    const arrivesAt = windowStart + 20;

    // 20초 뒤 체결이 먼저 도착했다.
    aggregator.ingest(arrivesAt * 1000, 10, 250);

    // 그 초에 닿기 전까지는 창에 반영되지 않는다.
    for (let s = 0; s < 20; s += 1) {
      aggregator.advanceSecond(windowStart + s);
    }
    assert.equal(sliceOf(aggregator, "1m")?.quoteVolume, 0);

    aggregator.advanceSecond(arrivesAt);
    assert.equal(sliceOf(aggregator, "1m")?.quoteVolume, 250);
  });
});

describe("분 단위 채우기와 초 단위 진행이 같은 창을 만든다", () => {
  it("같은 거래대금이면 같은 창이 나온다", () => {
    // 과거 채우기(분 단위)와 실시간(초 단위)이 다른 창을 만들면
    // 백테스트에서 잰 파라미터가 의미를 잃는다.
    const byMinute = new SymbolAggregator("TESTUSDT");
    const bySecond = new SymbolAggregator("TESTUSDT");
    const start = 1_800_000 * 86_400;
    const lookback = LOOKBACK_WINDOW_COUNT["5m"];
    const totalMinutes = lookback * 5 + 5;

    for (let m = 0; m < totalMinutes; m += 1) {
      const minuteStart = start + m * 60;
      byMinute.feedMinute(minuteStart, 600, 1);

      for (let s = 0; s < 60; s += 1) {
        bySecond.ingest((minuteStart + s) * 1000, 1, 10);
        bySecond.advanceSecond(minuteStart + s);
      }
    }

    const a = sliceOf(byMinute, "5m");
    const b = sliceOf(bySecond, "5m");

    assert.ok(a !== undefined && b !== undefined);
    assert.equal(a.quoteVolume, b.quoteVolume);
    assert.equal(a.elapsedSeconds, b.elapsedSeconds);
    assert.equal(a.velocity, b.velocity);
    assert.deepEqual(a.velocities, b.velocities);
  });
});
