// 시간대 교란 보정.
//
// 지금까지의 품질 측정에는 알려진 결함이 하나 있었다. 알림은 거래가 활발한
// 시간대에 몰리는데, 비교 기준선은 24시간에 걸쳐 균등하게 뽑았다. 활발한
// 시간대는 원래 가격이 더 많이 움직이므로, 측정된 배수의 일부는 "알림이
// 뭔가를 골라냈다"가 아니라 그냥 "알림이 낮에 몰렸다"일 수 있다.
//
// 여기서는 같은 시각대끼리 비교한다. UTC 3시에 뜬 알림은 UTC 3시의
// 무작위 시점들과만 비교한다. 이렇게 해도 배수가 남으면 그건 시간대가
// 아니라 신호다.
//
// 남는 교란: 요일과 이벤트(FOMC 등)는 여전히 보정하지 않는다. 다만
// 시간대만큼 체계적이지 않아서 우선순위를 뒤로 뒀다.

import { evaluate } from "./engine.js";
import type { EmittedAlert } from "./engine.js";
import type { CrossingStream } from "./crossings.js";
import { HORIZONS, measureFrom } from "./quality.js";

const HOURS_PER_DAY = 24;

/** 시각대별 기준선. 인덱스는 UTC 시(0~23), 그 안은 지평별 정렬된 분포. */
export type HourlyBaseline = readonly (readonly number[][])[];

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 초 오프셋이 UTC 몇 시인가. */
function hourOf(startAbsSecond: number, second: number): number {
  return Math.floor((startAbsSecond + second) / 3600) % HOURS_PER_DAY;
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

/**
 * 시각대별 기준선을 만든다.
 *
 * 무작위로 뽑은 시점을 그 시점의 UTC 시로 나눠 담는다. 시각대마다
 * 따로 뽑지 않고 한 번에 뽑아 분류하는 이유는, 그래야 각 시각대의 표본이
 * 실제 데이터 분포를 그대로 반영하기 때문이다.
 */
export function buildHourlyBaseline(
  prices: Float32Array,
  startAbsSecond: number,
  startSecond: number,
  samples: number,
  seed: number,
): { baseline: HourlyBaseline; counts: number[] } {
  const random = makeRandom(seed);

  const collected: number[][][] = Array.from({ length: HOURS_PER_DAY }, () =>
    HORIZONS.map(() => []),
  );
  const counts = new Array<number>(HOURS_PER_DAY).fill(0);

  const lowest = startSecond;
  const highest = prices.length - Math.max(...HORIZONS) - 1;
  const span = highest - lowest;

  if (span > 0) {
    for (let i = 0; i < samples; i += 1) {
      const t = lowest + Math.floor(random() * span);
      const movement = measureFrom(prices, t);
      if (movement === null) {
        continue;
      }

      const hour = hourOf(startAbsSecond, t);
      const slot = collected[hour];
      if (slot === undefined) {
        continue;
      }

      counts[hour] = (counts[hour] ?? 0) + 1;
      for (let h = 0; h < HORIZONS.length; h += 1) {
        slot[h]?.push(movement.maxMove[h] ?? 0);
      }
    }
  }

  for (const hour of collected) {
    for (const list of hour) {
      list.sort((a, b) => a - b);
    }
  }

  return { baseline: collected, counts };
}

export interface HourMatchedResult {
  symbol: string;
  alertCount: number;
  /** 지평별 결과. HORIZONS와 같은 순서. */
  perHorizon: {
    horizonSeconds: number;
    /** 시각대를 맞춰 비교한 배수 */
    matchedLift: number | null;
    /** 시각대를 무시하고 비교한 배수 (기존 방식) */
    naiveLift: number | null;
  }[];
  /** 알림이 실제로 몰린 시각대. 진단용. */
  alertsByHour: number[];
}

export interface HourMatchedOptions {
  sensitivity: number;
  eventGapSeconds: number;
  cooldownScale: number;
  tightening: number;
}

/**
 * 시각대를 맞춘 배수와 맞추지 않은 배수를 같이 낸다.
 *
 * 두 값을 나란히 보아야 교란이 얼마나 컸는지 알 수 있다. 보정한 값만
 * 내놓으면 "원래 얼마였는데 얼마가 됐다"를 말할 수 없다.
 *
 * 알림마다 자기 시각대의 기준선과 비교해 개별 배수를 내고, 그 중앙값을
 * 쓴다. 전체를 한 분포로 합쳐서 중앙값을 내면 시각대별 기준선이 다시
 * 섞여 버려 보정한 의미가 없어진다.
 */
export function measureHourMatched(
  stream: CrossingStream,
  prices: Float32Array,
  hourly: HourlyBaseline,
  flat: readonly number[][],
  startAbsSecond: number,
  options: HourMatchedOptions,
): HourMatchedResult {
  const alerts: EmittedAlert[] = [];
  evaluate(stream, {
    sensitivity: options.sensitivity,
    eventGapSeconds: options.eventGapSeconds,
    cooldownScale: options.cooldownScale,
    tightening: options.tightening,
    onAlert: (alert) => alerts.push(alert),
  });

  const alertsByHour = new Array<number>(HOURS_PER_DAY).fill(0);
  // 지평별로 "알림 이동폭 ÷ 그 시각대 기준선"들을 모은다.
  const matchedRatios: number[][] = HORIZONS.map(() => []);
  const rawMoves: number[][] = HORIZONS.map(() => []);

  let counted = 0;

  for (const alert of alerts) {
    const movement = measureFrom(prices, alert.second);
    if (movement === null) {
      continue;
    }

    const hour = hourOf(startAbsSecond, alert.second);
    alertsByHour[hour] = (alertsByHour[hour] ?? 0) + 1;
    counted += 1;

    const hourBaseline = hourly[hour];

    for (let h = 0; h < HORIZONS.length; h += 1) {
      const move = movement.maxMove[h] ?? 0;
      rawMoves[h]?.push(move);

      const reference = median(hourBaseline?.[h] ?? []);
      if (reference > 0) {
        matchedRatios[h]?.push(move / reference);
      }
    }
  }

  const perHorizon = HORIZONS.map((horizonSeconds, h) => {
    const ratios = [...(matchedRatios[h] ?? [])].sort((a, b) => a - b);
    const matchedLift = ratios.length > 0 ? median(ratios) : null;

    const moves = [...(rawMoves[h] ?? [])].sort((a, b) => a - b);
    const flatReference = median(flat[h] ?? []);
    const naiveLift =
      flatReference > 0 && moves.length > 0
        ? median(moves) / flatReference
        : null;

    return { horizonSeconds, matchedLift, naiveLift };
  });

  return {
    symbol: stream.symbol,
    alertCount: counted,
    perHorizon,
    alertsByHour,
  };
}
