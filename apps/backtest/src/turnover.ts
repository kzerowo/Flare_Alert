// 거래대금 하한(MIN_QUOTE_VOLUME) 측정.
//
// 이 값은 지금까지 근거 없이 정해져 있었다. 그런데 소형주의 동작을
// 혼자서 결정한다 — 바이낸스 50,000 USDT 기준으로 ANKR/ONE은 판정
// 시도의 대부분이 여기서 잘려 나간다. 값이 옳은지 한 번도 확인하지 않은 채
// "잡코인이 1만원에서 20만원이 되면 S는 폭발하지만 실제로 진입할 수 없다"는
// 논리만으로 서 있었다.
//
// 그 논리 자체는 맞다. 문제는 경계가 어디냐다. 너무 높으면 소형주가
// 통째로 침묵하고(= 그 사용자에게는 서비스가 죽은 것과 같다), 너무 낮으면
// 들어갈 수도 없는 알림이 쌓인다.
//
// 재는 방법은 품질 측정과 같다. 알림 이후 가격 이동폭을 같은 종목의
// 무작위 시점과 비교한다. 다만 이번에는 거래대금 구간별로 나눠서 본다.
// 신호가 사라지는 구간이 있다면 거기가 하한이다.

import { evaluate } from "./engine.js";
import type { EmittedAlert } from "./engine.js";
import type { CrossingStream } from "./crossings.js";
import { HORIZONS, measureFrom } from "./quality.js";
import type { Baseline } from "./quality.js";

/**
 * 거래대금 구간.
 *
 * 로그 간격으로 나눈다. 거래대금은 종목에 따라 네 자릿수씩 차이 나므로
 * 선형으로 자르면 한쪽 끝에 전부 몰린다.
 */
export const TURNOVER_BUCKETS = [
  0, 1_000, 5_000, 20_000, 50_000, 200_000, 1_000_000, 5_000_000,
] as const;

function bucketIndexOf(quoteVolume: number): number {
  let index = 0;
  for (let i = 0; i < TURNOVER_BUCKETS.length; i += 1) {
    if (quoteVolume >= (TURNOVER_BUCKETS[i] ?? 0)) {
      index = i;
    }
  }
  return index;
}

export function bucketLabel(index: number): string {
  const low = TURNOVER_BUCKETS[index] ?? 0;
  const high = TURNOVER_BUCKETS[index + 1];

  const format = (value: number): string => {
    if (value >= 1_000_000) {
      return `${value / 1_000_000}M`;
    }
    if (value >= 1000) {
      return `${value / 1000}K`;
    }
    return String(value);
  };

  if (high === undefined) {
    return `${format(low)}+`;
  }
  return `${format(low)}~${format(high)}`;
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) {
    return 0;
  }
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export interface TurnoverBucketResult {
  bucket: number;
  label: string;
  alerts: number;
  /** 알림 이후 이동폭 중앙값 (1분 지평) */
  alertMove: number;
  /** 같은 지평의 무작위 기준선 중앙값 */
  baselineMove: number;
  /** 알림 ÷ 무작위. 1이면 정보가 없다는 뜻이다. 기준선이 0이면 null. */
  lift: number | null;
}

export interface TurnoverReport {
  symbol: string;
  buckets: TurnoverBucketResult[];
  totalAlerts: number;
}

export interface TurnoverOptions {
  sensitivity: number;
  eventGapSeconds: number;
  cooldownScale: number;
  tightening: number;
  /** 어느 지평으로 볼 것인가. HORIZONS의 인덱스. 기본은 1분. */
  horizonIndex?: number;
}

/**
 * 거래대금 구간별로 알림 품질을 잰다.
 *
 * 하한을 걸지 않고 알림을 전부 뽑은 뒤 구간별로 나눈다. 그래서 이 함수는
 * 거래대금 하한 0으로 추출한 스트림에서만 의미가 있다.
 */
export function measureTurnover(
  stream: CrossingStream,
  prices: Float32Array,
  baseline: Baseline,
  options: TurnoverOptions,
): TurnoverReport {
  const horizonIndex = options.horizonIndex ?? 0;

  const alerts: EmittedAlert[] = [];
  evaluate(stream, {
    sensitivity: options.sensitivity,
    eventGapSeconds: options.eventGapSeconds,
    cooldownScale: options.cooldownScale,
    tightening: options.tightening,
    onAlert: (alert) => alerts.push(alert),
  });

  const moves: number[][] = TURNOVER_BUCKETS.map(() => []);

  for (const alert of alerts) {
    const movement = measureFrom(prices, alert.second);
    if (movement === null) {
      continue;
    }
    const index = bucketIndexOf(alert.quoteVolume);
    moves[index]?.push(movement.maxMove[horizonIndex] ?? 0);
  }

  const baseSorted = baseline[horizonIndex] ?? [];
  const baselineMove = median(baseSorted);

  const buckets = TURNOVER_BUCKETS.map((_, index) => {
    const sorted = [...(moves[index] ?? [])].sort((a, b) => a - b);
    const alertMove = median(sorted);

    // 기준선 중앙값이 0이면 배수를 낼 수 없다. 거래가 드문 종목은 무작위로
    // 찍은 1분 구간의 절반 이상이 체결이 없어 가격이 그대로다.
    let lift: number | null = null;
    if (baselineMove > 0) {
      lift = alertMove / baselineMove;
    }

    return {
      bucket: TURNOVER_BUCKETS[index] ?? 0,
      label: bucketLabel(index),
      alerts: sorted.length,
      alertMove,
      baselineMove,
      lift,
    };
  });

  return { symbol: stream.symbol, buckets, totalAlerts: alerts.length };
}

/** HORIZONS를 다시 내보낸다. 호출부가 quality.js를 따로 안 봐도 되게. */
export { HORIZONS };
