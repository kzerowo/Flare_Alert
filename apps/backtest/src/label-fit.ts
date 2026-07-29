// 사용자 기준으로 알림을 채점한다.
//
// 지금까지의 측정(lift, 알림 수)에는 정답이 없었다. "배수가 높다"거나
// "무작위보다 많이 움직였다"는 알고리즘이 스스로 만든 잣대라, 사용자가
// 차트를 보고 "이건 알려줬어야지"라고 느끼는 것과 맞는지는 알 수 없었다.
//
// 2026-07-30, 사용자가 BTC 15분봉 차트에 "이 정도면 알림이 와야 한다"를
// 직접 표시해 주었다. 그 표시를 숫자로 환산하니 이렇게 나왔다.
//
//   15분봉 거래대금 ≥ 직전 32봉 중앙값의 약 4배  (하루 4.2회)
//
// 표시된 개수(3일간 12~14개, 하루 4~5회)와 실제 4배 이상 봉의 빈도
// (하루 4.17회)가 일치해서, 읽기가 맞다는 것도 확인됐다.
//
// 여기서는 그 기준을 정답으로 놓고 재현율과 정밀도를 잰다. 처음으로
// 알고리즘 바깥에서 온 잣대다.

import { evaluate } from "./engine.js";
import type { EngineConfig } from "./engine.js";
import type { CrossingStream } from "./crossings.js";

/** 15분봉 하나의 길이(초). */
const BAR_SECONDS = 900;

/** 기준선으로 삼는 직전 봉 개수. LOOKBACK_WINDOW_COUNT["15m"]와 맞춘다. */
const BAR_LOOKBACK = 32;

/**
 * 사용자가 표시한 배수. 15분봉 4배 = 하루 4.17회로 표시 개수와 맞았다.
 * 낮추면 정답이 늘어나 재현율은 쉬워지고 정밀도는 어려워진다.
 */
export const LABEL_RATIO = 4;

/**
 * 알림이 사건보다 이만큼 일찍 나와도 맞춘 것으로 본다(초).
 *
 * 사용자는 "21:14에 처음 울려야 정상"이라고 했는데 그 15분봉은 21:15에
 * 열린다. 즉 사건을 알아채는 시점은 봉이 열리기 전일 수 있다. 한 봉만큼
 * 허용한다.
 */
const EARLY_TOLERANCE_SECONDS = BAR_SECONDS;

/** 정답으로 삼는 사건 하나. 초 오프셋은 stream.startMs 기준. */
export interface LabelEvent {
  startSecond: number;
  endSecond: number;
  /** 사건 안에서 가장 높았던 봉 배수 */
  peakRatio: number;
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
 * 초 단위 거래대금에서 정답 사건을 뽑는다.
 *
 * 이웃한 정답 봉은 한 사건으로 묶는다. 큰 급등은 15분봉 두세 개에 걸치는데,
 * 봉마다 알림을 요구하면 알고리즘이 옳게 동작해도 재현율이 깎인다.
 * 봉 하나만큼의 틈은 건너뛰고 이어 붙인다 — 정점 직후 한 봉이 잠시
 * 식었다고 별개 사건으로 세면 같은 문제가 생긴다.
 */
export function buildLabelEvents(
  volumes: Float64Array,
  ratioThreshold: number = LABEL_RATIO,
): LabelEvent[] {
  const barCount = Math.floor(volumes.length / BAR_SECONDS);
  const bars = new Float64Array(barCount);

  for (let i = 0; i < barCount; i += 1) {
    let sum = 0;
    const base = i * BAR_SECONDS;
    for (let k = 0; k < BAR_SECONDS; k += 1) {
      sum += volumes[base + k] ?? 0;
    }
    bars[i] = sum;
  }

  const ratios = new Float64Array(barCount);
  for (let i = BAR_LOOKBACK; i < barCount; i += 1) {
    const prev: number[] = [];
    for (let k = i - BAR_LOOKBACK; k < i; k += 1) {
      prev.push(bars[k] ?? 0);
    }
    prev.sort((a, b) => a - b);
    const base = median(prev);
    ratios[i] = base > 0 ? (bars[i] ?? 0) / base : 0;
  }

  const events: LabelEvent[] = [];
  let i = BAR_LOOKBACK;

  while (i < barCount) {
    if ((ratios[i] ?? 0) < ratioThreshold) {
      i += 1;
      continue;
    }

    let last = i;
    let peak = ratios[i] ?? 0;
    let j = i + 1;

    // 봉 하나만큼의 틈은 건너뛴다.
    while (j < barCount && j - last <= 2) {
      if ((ratios[j] ?? 0) >= ratioThreshold) {
        last = j;
        peak = Math.max(peak, ratios[j] ?? 0);
      }
      j += 1;
    }

    events.push({
      startSecond: i * BAR_SECONDS,
      endSecond: (last + 1) * BAR_SECONDS - 1,
      peakRatio: peak,
    });

    i = last + 1;
  }

  return events;
}

export interface FitResult {
  symbol: string;
  alerts: number;
  alertsPerDay: number;
  labelEvents: number;
  /** 정답 사건 중 알림이 잡아낸 비율 */
  recall: number;
  /** 알림 중 정답 사건에 떨어진 비율 */
  precision: number;
  /** 놓친 사건들의 배수 중앙값. 무엇을 놓치는지 본다. */
  missedPeakMedian: number;
  /**
   * 사건이 시작하고 첫 알림까지 걸린 시간의 중앙값(초). 음수면 봉이 열리기
   * 전에 알아챈 것이다.
   *
   * 재현율만으로는 이걸 볼 수 없다. 사용자가 실제로 불만을 제기한 건
   * "안 울렸다"가 아니라 "2분 늦게 울렸다"였는데, 사건 안에만 들어오면
   * 재현율은 똑같이 맞춘 것으로 센다.
   */
  latencyMedian: number;
}

/**
 * 한 설정으로 알림을 뽑아 정답과 맞춰 본다.
 *
 * 한 사건에 알림이 여럿 떨어져도 재현율은 하나로 센다. 반대로 정밀도는
 * 알림 하나하나를 센다 — 같은 사건에 다섯 번 울리면 사용자에게는 네 번이
 * 군더더기이기 때문이다.
 */
export function measureFit(
  stream: CrossingStream,
  events: readonly LabelEvent[],
  config: Omit<EngineConfig, "onAlert">,
): FitResult {
  const alertSeconds: number[] = [];
  evaluate(stream, {
    ...config,
    onAlert: (alert) => alertSeconds.push(alert.second),
  });

  const covered = new Set<number>();
  /** 사건별 첫 알림 시각. 지연을 재는 데 쓴다. */
  const firstAlertAt = new Map<number, number>();
  let hits = 0;

  for (const second of alertSeconds) {
    let matched = false;
    for (let e = 0; e < events.length; e += 1) {
      const event = events[e];
      if (event === undefined) {
        continue;
      }
      if (
        second >= event.startSecond - EARLY_TOLERANCE_SECONDS &&
        second <= event.endSecond
      ) {
        covered.add(e);
        const existing = firstAlertAt.get(e);
        if (existing === undefined || second < existing) {
          firstAlertAt.set(e, second);
        }
        matched = true;
        break;
      }
    }
    if (matched) {
      hits += 1;
    }
  }

  const latencies: number[] = [];
  for (const [e, second] of firstAlertAt) {
    const event = events[e];
    if (event !== undefined) {
      latencies.push(second - event.startSecond);
    }
  }
  latencies.sort((a, b) => a - b);

  const missedPeaks: number[] = [];
  for (let e = 0; e < events.length; e += 1) {
    if (!covered.has(e)) {
      missedPeaks.push(events[e]?.peakRatio ?? 0);
    }
  }
  missedPeaks.sort((a, b) => a - b);

  return {
    symbol: stream.symbol,
    alerts: alertSeconds.length,
    alertsPerDay: alertSeconds.length / Math.max(stream.measuredDays, 1),
    labelEvents: events.length,
    recall: events.length > 0 ? covered.size / events.length : 0,
    precision: alertSeconds.length > 0 ? hits / alertSeconds.length : 0,
    missedPeakMedian: median(missedPeaks),
    latencyMedian: median(latencies),
  };
}

/**
 * 사용자 기준을 그대로 실시간 규칙으로 옮겼을 때의 상한.
 *
 * 지금 파이프라인이 정답과 안 맞는 이유가 "기준이 원래 실시간으로 못 잡는
 * 것이라서"인지, 아니면 "우리 구현이 어긋나서"인지 갈라야 한다. 그래서
 * 중간 단계(속도, MAD, 백분위)를 전부 빼고 사용자 말 그대로만 구현해 본다.
 *
 *   최근 15분 거래대금 ≥ 직전 32개 15분 구간 중앙값 × ratioThreshold
 *
 * 봉 마감을 기다리지 않는다. 매 순간 "최근 15분"을 본다 — 창이 항상 꽉 차
 * 있으므로 부분 창 외삽이 아예 없다.
 *
 * 이 값이 높게 나오면 기준 자체는 실시간으로 잡을 수 있다는 뜻이고,
 * 문제는 우리 점수 방식에 있다는 결론이 된다.
 */
export function measureTrailingReference(
  volumes: Float64Array,
  events: readonly LabelEvent[],
  measuredDays: number,
  options: {
    ratioThreshold: number;
    eventGapSeconds: number;
    /** 몇 초마다 판정할 것인가. 1초로 두면 느리고 결과는 거의 같다. */
    stepSeconds?: number;
  },
): FitResult {
  const step = options.stepSeconds ?? 15;

  // 누적합을 만들어 두면 임의 구간 거래대금이 뺄셈 한 번이다.
  const prefix = new Float64Array(volumes.length + 1);
  for (let i = 0; i < volumes.length; i += 1) {
    prefix[i + 1] = (prefix[i] ?? 0) + (volumes[i] ?? 0);
  }
  const rangeSum = (from: number, to: number): number =>
    (prefix[to] ?? 0) - (prefix[from] ?? 0);

  const alertSeconds: number[] = [];
  const window: number[] = new Array<number>(BAR_LOOKBACK);

  // 기준선까지 거슬러 올라갈 수 있는 첫 시점.
  const earliest = BAR_SECONDS * (BAR_LOOKBACK + 1);

  let lastAboveSecond = Number.NEGATIVE_INFINITY;
  let firedThisEvent = false;

  for (let t = earliest; t < volumes.length; t += step) {
    const current = rangeSum(t - BAR_SECONDS, t);

    for (let k = 0; k < BAR_LOOKBACK; k += 1) {
      const end = t - BAR_SECONDS * (k + 1);
      window[k] = rangeSum(end - BAR_SECONDS, end);
    }
    const sorted = [...window].sort((a, b) => a - b);
    const base = median(sorted);

    const above = base > 0 && current / base >= options.ratioThreshold;

    // 사건 경계 판정은 이 시점을 반영하기 전의 값으로.
    if (t - lastAboveSecond > options.eventGapSeconds) {
      firedThisEvent = false;
    }
    if (above) {
      lastAboveSecond = t;
    }

    if (above && !firedThisEvent) {
      alertSeconds.push(t);
      firedThisEvent = true;
    }
  }

  // 채점은 measureFit과 같은 방식으로.
  const covered = new Set<number>();
  const firstAlertAt = new Map<number, number>();
  let hits = 0;

  for (const second of alertSeconds) {
    for (let e = 0; e < events.length; e += 1) {
      const event = events[e];
      if (event === undefined) {
        continue;
      }
      if (
        second >= event.startSecond - EARLY_TOLERANCE_SECONDS &&
        second <= event.endSecond
      ) {
        covered.add(e);
        const existing = firstAlertAt.get(e);
        if (existing === undefined || second < existing) {
          firstAlertAt.set(e, second);
        }
        hits += 1;
        break;
      }
    }
  }

  const missedPeaks: number[] = [];
  for (let e = 0; e < events.length; e += 1) {
    if (!covered.has(e)) {
      missedPeaks.push(events[e]?.peakRatio ?? 0);
    }
  }
  missedPeaks.sort((a, b) => a - b);

  const latencies: number[] = [];
  for (const [e, second] of firstAlertAt) {
    const event = events[e];
    if (event !== undefined) {
      latencies.push(second - event.startSecond);
    }
  }
  latencies.sort((a, b) => a - b);

  return {
    symbol: "(기준 그대로)",
    alerts: alertSeconds.length,
    alertsPerDay: alertSeconds.length / Math.max(measuredDays, 1),
    labelEvents: events.length,
    recall: events.length > 0 ? covered.size / events.length : 0,
    precision: alertSeconds.length > 0 ? hits / alertSeconds.length : 0,
    missedPeakMedian: median(missedPeaks),
    latencyMedian: median(latencies),
  };
}
