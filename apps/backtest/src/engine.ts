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
  /**
   * 신호가 임계 아래로 이만큼 내려가 있으면 사건이 끝난 것으로 본다(초).
   * 직전 알림이 아니라 직전 교차를 기준으로 잰다 — 이유는 EVENT_GAP_SECONDS 주석.
   */
  eventGapSeconds: number;
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
   * 고치기 전의 판정을 재현한다. 비교 측정에만 쓰고 제품 경로에서는 쓰지 않는다.
   *
   * 이전에는 사건 경계가 아니라 "마지막 알림으로부터 N초"라는 고정 스로틀이었다.
   * 그래서 작은 사건에 알림을 써버리면 그 안에 들어온 더 큰 사건이 통째로
   * 묻혔다. 고친 효과를 숫자로 보이려면 옛 동작을 돌려볼 수 있어야 한다.
   */
  legacyThrottle?: boolean;

  /**
   * 백분위 대신 배수로 판정한다.
   *
   * 사용자가 쓰는 잣대가 이것이다 — "평소의 4배". 백분위는 종목 간 이식을
   * 위한 내부 표현인데, 정작 사용자 기준과 맞는지는 재본 적이 없었다.
   *
   * 이 모드에서는 쿨다운을 걸지 않는다. 쿨다운은 백분위의 꼬리 비율을 조이는
   * 장치라 배수에 그대로 옮길 수 없고, 사건 기반 병합이 들어온 뒤로는 역할이
   * 겹친다(같은 사건에는 어차피 알림이 하나뿐이다). 비교할 때 이 차이를
   * 감안해야 한다.
   */
  ratioThreshold?: number;

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
  const byRatio = config.ratioThreshold !== undefined;

  if (!byRatio && config.sensitivity < stream.minPercentile) {
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

  // 사건 경계는 "마지막으로 임계를 넘은 시각"으로 잰다. 쿨다운에 막혔더라도
  // 임계를 넘었으면 사건은 이어지는 중이다.
  let lastAboveAtMs = Number.NEGATIVE_INFINITY;
  /** 지금 사건에서 이미 알림이 나갔는가. 사건 하나에 알림 하나. */
  let firedThisEvent = false;
  /** legacyThrottle 비교용. 옛 판정이 쓰던 기준점이다. */
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
    let bestValue = Number.NEGATIVE_INFINITY;
    let bestPercentile = Number.NEGATIVE_INFINITY;
    let bestFrame = -1;
    let bestQuoteVolume = 0;

    // 사건 경계 판정은 이 초를 반영하기 "전"의 값으로 해야 한다.
    const isNewEvent = atMs - lastAboveAtMs > config.eventGapSeconds * 1000;

    for (let j = i; j < end; j += 1) {
      const frameIndex = stream.frames[j] ?? 0;

      if (config.onlyFrame !== undefined && frameIndex !== config.onlyFrame) {
        continue;
      }

      const percentile = stream.percentiles[j] ?? 0;
      const ratio = stream.ratios[j] ?? 0;

      // 판정에 쓰는 값. 배수 모드면 배수, 아니면 백분위다.
      const value = byRatio ? ratio : percentile;
      const bar = byRatio ? (config.ratioThreshold ?? 0) : config.sensitivity;

      if (value < bar) {
        continue;
      }

      rawCrossings += 1;
      lastAboveAtMs = atMs;

      const key = keys[frameIndex];
      if (key === undefined) {
        continue;
      }

      if (!byRatio) {
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
      }

      passedMask |= 1 << frameIndex;

      // 대표 신호는 판정에 쓴 값이 가장 큰 프레임으로 고른다.
      if (value > bestValue) {
        bestValue = value;
        bestPercentile = percentile;
        bestFrame = frameIndex;
        bestQuoteVolume = stream.quoteVolumes[j] ?? 0;
      }
    }

    i = end;

    // 사건이 새로 시작했으면 발사 권리도 새로 생긴다. 이 초에 쿨다운으로
    // 아무것도 통과하지 못했더라도 리셋해 둬야, 사건 도중 쿨다운이 풀렸을 때
    // 그 사건의 첫 알림이 제대로 나간다.
    if (isNewEvent) {
      firedThisEvent = false;
    }

    if (passedMask === 0) {
      continue;
    }

    const suppressed =
      config.legacyThrottle === true
        ? atMs - lastAlertAtMs < config.eventGapSeconds * 1000
        : firedThisEvent;

    if (suppressed) {
      // 같은 사건이 계속 임계를 넘는 중이다. 이미 나간 알림에 흡수한다.
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
    firedThisEvent = true;
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
