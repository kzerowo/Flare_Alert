import {
  COOLDOWN_DURATION_SECONDS,
  COOLDOWN_TAIL_TIGHTENING,
  TIMEFRAMES,
  TimeDecayCooldown,
} from "@flare-alert/core";
import type { SeriesKey, Timeframe } from "@flare-alert/core";

import type { CrossingStream } from "./crossings.js";

export interface EngineConfig {
  sensitivity: number;
  /** 같은 종목의 후속 교차를 하나의 알림으로 흡수하는 시간(초). */
  mergeWindowSeconds: number;
  /** 쿨다운 기본 지속시간에 곱할 배수. */
  cooldownScale: number;
  /** 알림 직후 허용 꼬리 비율을 조이는 배수. */
  tightening: number;
  /**
   * 지정하면 이 프레임의 교차만 본다.
   * 프레임별 표준 민감도를 재는 데 쓴다. 채널은 여러 프레임을 함께 켜지만,
   * "1분봉 기준으로는 어느 민감도가 적당한가"를 알려면 프레임을 격리해야 한다.
   */
  onlyFrame?: number;

  /**
   * 알림이 실제로 나갈 때마다 부른다.
   *
   * 개수만 필요한 스윕에서는 넘기지 않는다. 조합마다 수천 개의 객체를
   * 만들어 버리기 때문이다. 알림 품질 측정처럼 시각이 필요할 때만 쓴다.
   *
   * second는 stream.startMs 기준 초 오프셋이라, 같은 종목의 가격 배열을
   * 그대로 이 값으로 인덱싱할 수 있다.
   */
  onAlert?: (alert: EmittedAlert) => void;
}

/** 실제로 나간 알림 하나. */
export interface EmittedAlert {
  /** stream.startMs 기준 초 오프셋 */
  second: number;
  /** 판정을 통과한 신호 중 가장 높은 백분위 */
  percentile: number;
  /** 그 신호를 낸 프레임 */
  frame: Timeframe;
  /** 그 신호의 창 누적 거래대금. 거래대금 하한을 재는 데 쓴다. */
  quoteVolume: number;
}

export interface EngineResult {
  config: EngineConfig;
  /** 임계를 넘은 (초, 프레임) 조합의 수 */
  rawCrossings: number;
  /** 쿨다운에 걸린 수 */
  rejectedCooldown: number;
  /** 이미 나간 알림에 병합된 수 */
  mergedIntoExisting: number;
  /** 실제로 사용자에게 나간 알림 수 */
  alerts: number;
  alertsPerDay: number;
  /** 알림 하나당 평균 병합 프레임 수 */
  averageStrength: number;
  byPrimaryFrame: Record<Timeframe, number>;
}

/** 켜져 있는 비트 수 = 병합된 서로 다른 프레임 수. */
function popcount(mask: number): number {
  let count = 0;
  let bits = mask;
  while (bits !== 0) {
    bits &= bits - 1;
    count += 1;
  }
  return count;
}

function scaledDurations(scale: number): Record<Timeframe, number> {
  const durations = {} as Record<Timeframe, number>;
  for (const tf of TIMEFRAMES) {
    durations[tf] = COOLDOWN_DURATION_SECONDS[tf] * scale;
  }
  return durations;
}

/**
 * 뽑아둔 교차 스트림에 쿨다운과 병합을 적용해 최종 알림 수를 낸다.
 *
 * 무거운 계산은 이미 끝나 있으므로 파라미터 조합 하나당 수십 밀리초면 된다.
 * 이 덕분에 조합을 수십 개 훑을 수 있다.
 */
export function evaluate(
  stream: CrossingStream,
  config: EngineConfig,
): EngineResult {
  if (config.sensitivity < stream.minPercentile) {
    throw new Error(
      `교차 스트림에 없는 구간입니다. ` +
        `민감도 ${config.sensitivity} < 스트림 하한 ${stream.minPercentile}`,
    );
  }

  const cooldown = new TimeDecayCooldown({
    durations: scaledDurations(config.cooldownScale),
    tightening: config.tightening,
  });

  const startAbsSecond = Math.floor(stream.startMs / 1000);
  const keys: SeriesKey[] = TIMEFRAMES.map((tf) => ({
    exchange: "binance",
    symbol: stream.symbol,
    timeframe: tf,
  }));

  const byPrimaryFrame = {} as Record<Timeframe, number>;
  for (const tf of TIMEFRAMES) {
    byPrimaryFrame[tf] = 0;
  }

  let rawCrossings = 0;
  let rejectedCooldown = 0;
  let mergedIntoExisting = 0;
  let alerts = 0;
  let strengthSum = 0;

  let lastAlertAtMs = Number.NEGATIVE_INFINITY;
  let openFrameMask = 0;

  const closeOpenAlert = (): void => {
    if (openFrameMask !== 0) {
      strengthSum += popcount(openFrameMask);
      openFrameMask = 0;
    }
  };

  const total = stream.seconds.length;
  let i = 0;

  while (i < total) {
    const second = stream.seconds[i] ?? 0;
    const atMs = (startAbsSecond + second) * 1000;

    // 같은 초에 속한 교차들을 한 덩어리로 본다.
    let end = i;
    while (end < total && stream.seconds[end] === second) {
      end += 1;
    }

    let passedMask = 0;
    let bestPercentile = Number.NEGATIVE_INFINITY;
    let bestFrame = -1;
    let bestQuoteVolume = 0;

    for (let j = i; j < end; j += 1) {
      const frameIndex = stream.frames[j] ?? 0;

      if (config.onlyFrame !== undefined && frameIndex !== config.onlyFrame) {
        continue;
      }

      const percentile = stream.percentiles[j] ?? 0;
      if (percentile < config.sensitivity) {
        continue;
      }

      rawCrossings += 1;

      const key = keys[frameIndex];
      if (key === undefined) {
        continue;
      }

      const threshold = cooldown.effectiveThreshold(
        key,
        config.sensitivity,
        atMs,
      );

      if (percentile < threshold) {
        rejectedCooldown += 1;
        continue;
      }

      cooldown.record(key, atMs);
      passedMask |= 1 << frameIndex;

      if (percentile > bestPercentile) {
        bestPercentile = percentile;
        bestFrame = frameIndex;
        bestQuoteVolume = stream.quoteVolumes[j] ?? 0;
      }
    }

    i = end;

    if (passedMask === 0) {
      continue;
    }

    const withinMergeWindow =
      atMs - lastAlertAtMs < config.mergeWindowSeconds * 1000;

    if (withinMergeWindow) {
      // 같은 사건으로 보고 기존 알림에 흡수한다. 새 알림을 만들지 않는다.
      mergedIntoExisting += popcount(passedMask);
      openFrameMask |= passedMask;
      continue;
    }

    closeOpenAlert();

    const primary = TIMEFRAMES[bestFrame];
    if (primary !== undefined) {
      byPrimaryFrame[primary] += 1;

      if (config.onAlert !== undefined) {
        config.onAlert({
          second,
          percentile: bestPercentile,
          frame: primary,
          quoteVolume: bestQuoteVolume,
        });
      }
    }

    alerts += 1;
    openFrameMask = passedMask;
    lastAlertAtMs = atMs;
  }

  closeOpenAlert();

  let averageStrength = 0;
  if (alerts > 0) {
    averageStrength = strengthSum / alerts;
  }

  return {
    config,
    rawCrossings,
    rejectedCooldown,
    mergedIntoExisting,
    alerts,
    alertsPerDay: alerts / Math.max(stream.measuredDays, 1),
    averageStrength,
    byPrimaryFrame,
  };
}

export const DEFAULT_TIGHTENING = COOLDOWN_TAIL_TIGHTENING;
