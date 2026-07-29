import {
  HistogramPercentileEstimator,
  LOOKBACK_WINDOW_COUNT,
  MIN_ELAPSED_SECONDS,
  TIMEFRAMES,
  TIMEFRAME_MINUTES,
  computeBaseline,
  computeScore,
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
  minElapsedSeconds: number;
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
    minElapsedSeconds: MIN_ELAPSED_SECONDS[timeframe],
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

      const windowStartLocal = ordinal * frame.windowSeconds - startAbsSecond;
      const elapsedSeconds = t - windowStartLocal + 1;

      // 표본이 적어 속도가 발산하는 구간은 건너뛴다.
      if (elapsedSeconds < frame.minElapsedSeconds) {
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

      const quoteVolume =
        (prefix[t + 1] ?? 0) - (prefix[windowStartLocal] ?? 0);
      const velocity = quoteVolume / (elapsedSeconds / 60);

      const stats = perFrame[frame.timeframe];
      stats.evaluated += 1;

      const score = computeScore(
        {
          key: frame.key,
          openedAtMs: (startAbsSecond + windowStartLocal) * 1000,
          evaluatedAtMs: atMs,
          elapsedMinutes: elapsedSeconds / 60,
          quoteVolume,
          velocity,
        },
        baseline,
      );

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

      if (percentile < options.minPercentile) {
        continue;
      }

      if (quoteVolume < options.minQuoteVolume) {
        stats.rejectedTurnover += 1;
        continue;
      }

      // 거래대금을 같이 담는다. 하한을 뒤 단계에서 훑을 수 있어야 한다.
      collector.push(t, frame.index, percentile, quoteVolume);
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
