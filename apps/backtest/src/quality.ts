// 알림 품질 측정.
//
// 지금까지의 백테스트는 "얼마나 자주 울리는가"만 셌다. 정작 중요한
// "울린 뒤 실제로 가격이 움직였는가"는 한 번도 재지 않았다.
//
// 재는 방식에서 한 가지를 조심해야 한다. 거래량 급등은 방향이 없다 —
// 폭락할 때도 거래량은 터진다. 그래서 알림 후 수익률을 그냥 평균 내면
// 상승과 하락이 상쇄되어 0 근처가 나오고, 알고리즘이 좋든 나쁘든 같은
// 숫자가 나온다.
//
// 그래서 부호 없는 이동폭을 본다. 그리고 그 값 자체는 의미가 없다 —
// 변동성이 큰 종목은 아무 때나 찍어도 크게 나온다. 같은 종목의 무작위
// 시점과 비교해야 "알림이 실제로 뭔가를 골라냈는지"를 알 수 있다.

import type { CrossingStream } from "./crossings.js";
import { evaluate } from "./engine.js";
import type { EmittedAlert } from "./engine.js";

/** 알림 이후 몇 초까지 볼 것인가. */
export const HORIZONS = [60, 300, 900, 3600] as const;

// noUncheckedIndexedAccess가 켜져 있어 인덱스 접근은 undefined가 섞인다.
// 가장 긴 지평이라는 뜻이므로 최대값으로 직접 구한다.
const MAX_HORIZON = Math.max(...HORIZONS);

/** 한 시점 이후의 가격 움직임. 지평별로 하나씩. */
interface Movement {
  /** 지평 안에서 시작가 대비 가장 멀리 갔던 거리 (부호 없음) */
  maxMove: number[];
  /** 지평 끝 시점의 수익률 (부호 있음) */
  endMove: number[];
}

/**
 * 재현 가능한 난수.
 *
 * Math.random을 쓰면 실행할 때마다 기준선이 흔들려서, 알고리즘을 고쳤을 때
 * 개선된 건지 표본이 바뀐 건지 구분할 수 없다.
 */
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

/**
 * 한 시점 이후의 움직임을 지평별로 잰다.
 *
 * 지평마다 따로 훑지 않고 한 번에 처리한다. 최대 지평까지 걸어가면서
 * 경계를 지날 때마다 그 순간의 값을 적어 둔다.
 *
 * 기준가는 P[t]다. t초의 종가이므로 t초에 일어난 움직임은 이미 지나간
 * 뒤다. 알림도 t초의 거래량으로 결정되므로, 여기서부터 앞을 보는 것이
 * 선행 편향 없이 "알림 이후"를 재는 방법이다.
 */
function measureFrom(prices: Float32Array, t: number): Movement | null {
  const base = prices[t];
  if (base === undefined || base <= 0) {
    return null;
  }
  if (t + MAX_HORIZON >= prices.length) {
    return null;
  }

  const maxMove: number[] = [];
  const endMove: number[] = [];

  let running = 0;
  let horizonIndex = 0;

  for (let k = 1; k <= MAX_HORIZON; k += 1) {
    const price = prices[t + k];
    if (price !== undefined && price > 0) {
      const move = Math.abs(price / base - 1);
      if (move > running) {
        running = move;
      }
    }

    if (k === HORIZONS[horizonIndex]) {
      maxMove.push(running);
      const end = prices[t + k];
      if (end !== undefined && end > 0) {
        endMove.push(end / base - 1);
      } else {
        endMove.push(0);
      }
      horizonIndex += 1;
    }
  }

  return { maxMove, endMove };
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

/** 정렬된 분포에서 value가 상위 몇 %에 있는지 (0~100). */
function percentileRankOf(sorted: readonly number[], value: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((sorted[mid] ?? 0) < value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return (low / sorted.length) * 100;
}

/** 분포에서 q분위 값. q는 0~1. */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[index] ?? 0;
}

export interface QualityReport {
  symbol: string;
  alertCount: number;
  baselineCount: number;
  /** 지평별 결과. HORIZONS와 같은 순서. */
  perHorizon: {
    horizonSeconds: number;
    /** 알림 시점 이후 이동폭의 중앙값 */
    alertMove: number;
    /** 무작위 시점 이후 이동폭의 중앙값 */
    baselineMove: number;
    /**
     * 알림 ÷ 무작위. 1이면 알림에 정보가 없다는 뜻이다.
     * 기준선 중앙값이 0이면(거래가 드문 종목) 낼 수 없어 null이다.
     */
    lift: number | null;
    /** 알림의 중앙값이 무작위 분포에서 상위 몇 %인가 */
    percentileRank: number;
    /**
     * 무작위 시점의 상위 10% 기준을 넘긴 알림의 비율.
     * 알림이 무작위와 같다면 10%가 나온다. 높을수록 잘 골라낸 것이다.
     */
    hitRate: number;
    /** 지평 끝에서 오른 알림의 비율. 0.5면 방향성이 없다는 뜻이다. */
    upFraction: number;
  }[];
}

export interface QualityOptions {
  sensitivity: number;
  mergeWindowSeconds: number;
  cooldownScale: number;
  tightening: number;
}

/**
 * 무작위 시점의 이동폭 분포. 지평별로 하나씩, 오름차순 정렬되어 있다.
 *
 * 민감도를 여러 개 훑을 때 이걸 매번 다시 만들면 안 된다. 종목당
 * 20,000 × 3,600번을 걷는 작업이라, 조합 수만큼 곱해지면 몇 분이 된다.
 * 기준선은 민감도와 무관하므로 종목당 한 번만 만들어 돌려 쓴다.
 */
export type Baseline = readonly number[][];

export function buildBaseline(
  prices: Float32Array,
  startSecond: number,
  samples: number,
  seed: number,
): { baseline: Baseline; count: number } {
  const random = makeRandom(seed);
  const collected: number[][] = HORIZONS.map(() => []);

  const lowest = startSecond;
  const highest = prices.length - MAX_HORIZON - 1;
  const span = highest - lowest;

  let count = 0;
  if (span > 0) {
    for (let i = 0; i < samples; i += 1) {
      const t = lowest + Math.floor(random() * span);
      const movement = measureFrom(prices, t);
      if (movement === null) {
        continue;
      }
      count += 1;
      for (let h = 0; h < HORIZONS.length; h += 1) {
        collected[h]?.push(movement.maxMove[h] ?? 0);
      }
    }
  }

  for (const list of collected) {
    list.sort((a, b) => a - b);
  }

  return { baseline: collected, count };
}

export function measureQuality(
  stream: CrossingStream,
  prices: Float32Array,
  baseline: Baseline,
  baselineCount: number,
  options: QualityOptions,
): QualityReport {
  // ---- 알림 시점 모으기 ----
  const alerts: EmittedAlert[] = [];
  evaluate(stream, {
    sensitivity: options.sensitivity,
    mergeWindowSeconds: options.mergeWindowSeconds,
    cooldownScale: options.cooldownScale,
    tightening: options.tightening,
    onAlert: (alert) => alerts.push(alert),
  });

  const alertMoves: number[][] = HORIZONS.map(() => []);
  const alertEnds: number[][] = HORIZONS.map(() => []);

  for (const alert of alerts) {
    const movement = measureFrom(prices, alert.second);
    if (movement === null) {
      continue;
    }
    for (let h = 0; h < HORIZONS.length; h += 1) {
      alertMoves[h]?.push(movement.maxMove[h] ?? 0);
      alertEnds[h]?.push(movement.endMove[h] ?? 0);
    }
  }

  // ---- 비교 ----
  //
  // 기준선은 같은 종목, 같은 기간에서 아무 때나 찍었을 때의 분포다.
  // 알림 시점이 이보다 크게 움직였는지가 우리가 알고 싶은 전부다.
  const perHorizon = HORIZONS.map((horizonSeconds, h) => {
    const alertSorted = [...(alertMoves[h] ?? [])].sort((a, b) => a - b);
    const baseSorted = baseline[h] ?? [];

    const alertMove = median(alertSorted);
    const baselineMove = median(baseSorted);

    /*
     * 기준선 중앙값이 0이면 배수를 낼 수 없다.
     *
     * 거래가 드문 종목은 무작위로 찍은 1분 구간의 절반 이상이 체결이
     * 아예 없어서 가격이 그대로다. 0으로 나눈 값을 0배로 적으면
     * "정보 없음"으로 읽혀서 정반대로 해석된다. null로 두고 분위수를
     * 대신 읽어야 한다.
     */
    let lift: number | null = null;
    if (baselineMove > 0) {
      lift = alertMove / baselineMove;
    }

    // 무작위 상위 10% 기준선을 알림이 얼마나 넘는가.
    const cut = quantile(baseSorted, 0.9);
    let over = 0;
    for (const value of alertSorted) {
      if (value >= cut) {
        over += 1;
      }
    }
    const hitRate = alertSorted.length > 0 ? over / alertSorted.length : 0;

    const ends = alertEnds[h] ?? [];
    let up = 0;
    for (const value of ends) {
      if (value > 0) {
        up += 1;
      }
    }
    const upFraction = ends.length > 0 ? up / ends.length : 0;

    return {
      horizonSeconds,
      alertMove,
      baselineMove,
      lift,
      percentileRank: percentileRankOf(baseSorted, alertMove),
      hitRate,
      upFraction,
    };
  });

  return {
    symbol: stream.symbol,
    alertCount: alertMoves[0]?.length ?? 0,
    baselineCount,
    perHorizon,
  };
}
