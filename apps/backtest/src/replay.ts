import {
  HistogramPercentileEstimator,
  LOOKBACK_WINDOW_COUNT,
  TIMEFRAMES,
  TIMEFRAME_MINUTES,
  computeBaseline,
  computeScore,
  ratioToMedian,
} from "@flare-alert/core";
import type {
  SeriesKey,
  Timeframe,
  VolatilityBaseline,
} from "@flare-alert/core";

import { CrossingCollector } from "./crossings.js";
import type { CrossingStream } from "./crossings.js";
import type { SymbolSeries } from "./data.js";

export interface ExtractOptions {
  /** 이 백분위 미만은 버린다. 어떤 파라미터로도 알림이 될 수 없는 구간. */
  minPercentile: number;
  /**
   * 이 배수 이상이면 백분위가 낮아도 담는다.
   *
   * 사용자가 실제로 쓰는 잣대는 배수("평소의 4배")이고 우리 내부 표현은
   * 백분위다. 둘 중 어느 쪽으로 판정할지 아직 안 정했으므로, 한쪽 기준만
   * 걸러 버리면 다른 쪽을 측정할 수 없게 된다.
   */
  minRatio: number;
  /**
   * 절대 거래대금 하한. 창 누적 거래대금이 이 값 미만이면 버린다.
   *
   * 0으로 두면 거르지 않는다. 하한 자체를 재려면 걸러진 것까지 남아 있어야
   * 하므로, 그 측정을 할 때는 0으로 뽑고 뒤 단계에서 훑는다.
   */
  minQuoteVolume: number;
  /** 분포를 쌓기만 하고 교차를 기록하지 않는 초기 기간(일). */
  warmupDays: number;
}

export interface FrameStats {
  /** 판정을 시도한 초의 수 */
  evaluated: number;
  /** 점수를 낼 수 없었던 횟수 (MAD가 0) */
  scoreUndefined: number;
  /** 표본이 부족해 백분위를 못 낸 횟수 */
  insufficientHistory: number;
  /** 거래대금 하한에 걸린 횟수 */
  rejectedTurnover: number;
}

export interface ExtractResult {
  stream: CrossingStream;
  perFrame: Record<Timeframe, FrameStats>;
  elapsedMs: number;
}

const EXCHANGE = "binance" as const;

function emptyFrameRecord<T>(make: () => T): Record<Timeframe, T> {
  const record = {} as Record<Timeframe, T>;
  for (const tf of TIMEFRAMES) {
    record[tf] = make();
  }
  return record;
}

/** 프레임 하나에 대해 미리 계산해두는 것들. */
interface FrameContext {
  timeframe: Timeframe;
  index: number;
  key: SeriesKey;
  windowSeconds: number;
  lookback: number;
  /** 완결된 창들의 속도. 인덱스는 windowOrdinal - firstOrdinal. */
  velocities: Float64Array;
  firstOrdinal: number;
  /** 현재 창의 기준선. 창이 바뀔 때만 다시 계산한다. */
  baseline: VolatilityBaseline | null;
  baselineOrdinal: number;
}

/**
 * 완결된 창들의 속도를 미리 뽑아둔다.
 *
 * 기준선은 "직전 N개 완결 창"의 중앙값이므로 창이 바뀔 때만 달라진다.
 * 매 초 다시 계산하면 같은 결과를 수백 번 반복하게 된다.
 *
 * 기준선은 경계 정렬 창을 그대로 쓴다. 판정 대상만 트레일링 창으로 바꾼다.
 * 둘 다 "꽉 찬 W초 구간의 분당 거래대금"이라 단위가 같고, 정렬 창은 겹치지
 * 않아 중앙값이 안정적이다. 트레일링 창은 직전 완결 창 하나와 부분적으로
 * 겹치는데, lookback이 14개 이상이라 중앙값에 미치는 영향은 무시할 만하다.
 */
function buildFrameContext(
  series: SymbolSeries,
  prefix: Float64Array,
  timeframe: Timeframe,
  index: number,
): FrameContext {
  const windowSeconds = TIMEFRAME_MINUTES[timeframe] * 60;
  const startAbsSecond = Math.floor(series.startMs / 1000);
  const totalSeconds = series.volumes.length;

  // 창 경계는 절대 시각 기준으로 잡는다. 그래야 1d 창이 UTC 자정에 열린다.
  const firstOrdinal = Math.ceil(startAbsSecond / windowSeconds);
  const lastOrdinal = Math.floor(
    (startAbsSecond + totalSeconds) / windowSeconds,
  );

  const count = Math.max(0, lastOrdinal - firstOrdinal);
  const velocities = new Float64Array(count);
  const minutes = windowSeconds / 60;

  for (let i = 0; i < count; i += 1) {
    const ordinal = firstOrdinal + i;
    const startLocal = ordinal * windowSeconds - startAbsSecond;
    const endLocal = startLocal + windowSeconds;
    const volume = (prefix[endLocal] ?? 0) - (prefix[startLocal] ?? 0);
    velocities[i] = volume / minutes;
  }

  return {
    timeframe,
    index,
    key: { exchange: EXCHANGE, symbol: series.symbol, timeframe },
    windowSeconds,
    lookback: LOOKBACK_WINDOW_COUNT[timeframe],
    velocities,
    firstOrdinal,
    baseline: null,
    baselineOrdinal: -1,
  };
}

/**
 * 한 종목의 전체 기간을 1초 해상도로 훑어 임계 교차를 뽑아낸다.
 *
 * 실시간 detector와 같은 순서로 돈다. 매 초, 6개 프레임의 현재 창을
 * 평가하고 점수를 내고 백분위로 바꾼다. 쿨다운과 병합은 여기서 하지 않는다.
 * 그 둘은 파라미터에 따라 달라지므로 뒤 단계에서 따로 돌린다.
 */
export function extractCrossings(
  series: SymbolSeries,
  options: ExtractOptions,
): ExtractResult {
  const started = Date.now();
  const totalSeconds = series.volumes.length;
  const startAbsSecond = Math.floor(series.startMs / 1000);

  // 창 거래대금을 O(1)에 구하려고 누적합을 만든다.
  const prefix = new Float64Array(totalSeconds + 1);
  for (let i = 0; i < totalSeconds; i += 1) {
    prefix[i + 1] = (prefix[i] ?? 0) + (series.volumes[i] ?? 0);
  }

  const frames = TIMEFRAMES.map((tf, i) =>
    buildFrameContext(series, prefix, tf, i),
  );

  const estimator = new HistogramPercentileEstimator();
  const perFrame = emptyFrameRecord<FrameStats>(() => ({
    evaluated: 0,
    scoreUndefined: 0,
    insufficientHistory: 0,
    rejectedTurnover: 0,
  }));

  const collector = new CrossingCollector();
  const warmupSeconds = options.warmupDays * 86_400;
  let scoredEvaluations = 0;

  for (let t = 0; t < totalSeconds; t += 1) {
    const absSecond = startAbsSecond + t;
    const atMs = absSecond * 1000;
    const measuring = t >= warmupSeconds;

    for (const frame of frames) {
      const ordinal = Math.floor(absSecond / frame.windowSeconds);
      const velocityIndex = ordinal - frame.firstOrdinal;

      // 기준선을 만들 만큼 완결된 창이 쌓이지 않았다.
      if (velocityIndex < frame.lookback) {
        continue;
      }

      if (frame.baselineOrdinal !== ordinal) {
        const lookbackSlice = frame.velocities.subarray(
          velocityIndex - frame.lookback,
          velocityIndex,
        );
        frame.baseline = computeBaseline(Array.from(lookbackSlice));
        frame.baselineOrdinal = ordinal;
      }

      const baseline = frame.baseline;
      if (baseline === null) {
        continue;
      }

      // 트레일링 창. 경계에 맞춘 부분 창이 아니라 "지금부터 뒤로 W초"다.
      //
      // 예전에는 정렬된 창이 열린 뒤 경과분으로 나눠 속도를 외삽했다.
      // 1분 프레임은 10초만 지나면 판정을 시작했으므로 그 10초에 6을 곱한
      // 값을 완결 창들의 중앙값과 비교한 셈이고, 10초 표본의 분산이 훨씬
      // 커서 평범한 거래가 상시 이상치로 읽혔다. 실측으로 경과 10초에서는
      // 배수가 완결 봉 대비 4배 부풀려졌다.
      //
      // 트레일링 창은 언제 봐도 꽉 차 있으므로 외삽이 없고, 창이 리셋되는
      // 사각지대도 없다.
      const windowStartLocal = t + 1 - frame.windowSeconds;
      const quoteVolume =
        (prefix[t + 1] ?? 0) - (prefix[windowStartLocal] ?? 0);
      const velocity = quoteVolume / (frame.windowSeconds / 60);

      const stats = perFrame[frame.timeframe];
      stats.evaluated += 1;

      const window = {
        key: frame.key,
        openedAtMs: (startAbsSecond + windowStartLocal) * 1000,
        evaluatedAtMs: atMs,
        elapsedMinutes: frame.windowSeconds / 60,
        quoteVolume,
        velocity,
      };

      const score = computeScore(window, baseline);

      if (score === null) {
        stats.scoreUndefined += 1;
        continue;
      }

      // 백분위는 "과거" 분포 기준이어야 한다. 조회 먼저, 반영은 그 다음.
      const percentile = estimator.toPercentile(frame.key, score);
      estimator.observe(frame.key, score, atMs);

      if (percentile === null) {
        stats.insufficientHistory += 1;
        continue;
      }

      if (!measuring) {
        continue;
      }

      scoredEvaluations += 1;

      const ratio = ratioToMedian(window, baseline) ?? 0;

      // 두 기준 중 하나라도 넘으면 담는다. 어느 쪽으로 판정할지 정하지
      // 않았으므로 한쪽만 걸러 두면 다른 쪽을 측정할 수 없게 된다.
      if (percentile < options.minPercentile && ratio < options.minRatio) {
        continue;
      }

      if (quoteVolume < options.minQuoteVolume) {
        stats.rejectedTurnover += 1;
        continue;
      }

      // 거래대금과 배수를 같이 담는다. 하한과 판정 방식을 뒤 단계에서
      // 훑을 수 있어야 한다.
      collector.push(t, frame.index, percentile, quoteVolume, ratio);
    }
  }

  const measuredSeconds = Math.max(0, totalSeconds - warmupSeconds);
  const arrays = collector.toArrays();

  return {
    stream: {
      symbol: series.symbol,
      startMs: series.startMs,
      measuredDays: measuredSeconds / 86_400,
      scoredEvaluations,
      minPercentile: options.minPercentile,
      ...arrays,
    },
    perFrame,
    elapsedMs: Date.now() - started,
  };
}
