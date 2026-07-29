import {
  EVENT_GAP_SECONDS,
  TIMEFRAMES,
  percentileToSlider,
  sliderToPercentile,
} from "@flare-alert/core";
import type { Timeframe } from "@flare-alert/core";

import type { CrossingStream } from "./crossings.js";
import { evaluate } from "./engine.js";

// ---------------------------------------------------------------------------
// 사건의 "규모"와 민감도 눈금
//
// 알림은 채널당 하나다. 프레임은 판정 축이 아니라 민감도의 참고 라벨이다.
// 라벨이 뜻하는 바는 "이 위치에 두면 그 봉 차트에서 눈에 띌 정도의 급등에
// 알림이 온다"이다.
//
// 그래서 재야 할 것은 "프레임 f를 하루 몇 번 울리게 하는 임계"가 아니라
// "f 규모의 사건이 알림이 되려면 임계가 어디까지 내려와야 하는가"다.
//
// 사건의 규모는 그 순간 몇 번째 프레임까지 이상치인지로 잰다.
// 짧게 터지고 마는 급등은 1분 창만 흔들고, 크고 오래 가는 급등은
// 1일 창까지 흔든다. 규모가 클수록 채널 신호(프레임 최대 백분위)가
// 높으므로 더 엄격한 임계에서도 살아남는다.
// ---------------------------------------------------------------------------

/** 사건 하나. 병합 창 안에서 한 덩어리로 본다. */
interface ScaledEvent {
  /** 이상치였던 프레임 중 가장 긴 것 */
  longestFrame: number;
  /** 그 사건이 만든 채널 신호 (프레임 최대 백분위) */
  channelSignal: number;
}

function collectEvents(
  stream: CrossingStream,
  anomalyReference: number,
): ScaledEvent[] {
  const events: ScaledEvent[] = [];
  const eventGapMs = EVENT_GAP_SECONDS * 1000;
  const startAbsSecond = Math.floor(stream.startMs / 1000);

  let openUntilMs = Number.NEGATIVE_INFINITY;
  let currentLongest = -1;
  let currentSignal = 0;

  const flush = (): void => {
    if (currentLongest >= 0) {
      events.push({
        longestFrame: currentLongest,
        channelSignal: currentSignal,
      });
    }
    currentLongest = -1;
    currentSignal = 0;
  };

  for (let i = 0; i < stream.seconds.length; i += 1) {
    const second = stream.seconds[i] ?? 0;
    const atMs = (startAbsSecond + second) * 1000;
    const percentile = stream.percentiles[i] ?? 0;
    const frame = stream.frames[i] ?? 0;

    if (percentile < anomalyReference) {
      continue;
    }

    if (atMs > openUntilMs) {
      flush();
    }

    if (frame > currentLongest) {
      currentLongest = frame;
    }
    if (percentile > currentSignal) {
      currentSignal = percentile;
    }

    openUntilMs = atMs + eventGapMs;
  }

  flush();
  return events;
}

/**
 * 분위수. 눈금을 어디에 둘지 정하는 손잡이다.
 *
 * 중앙값(0.5)을 쓰면 그 규모 사건의 절반만 잡힌다. "1분봉 기준"이라는
 * 라벨을 붙이려면 1분봉급 사건 대부분이 잡혀야 하므로 더 낮은 분위수를
 * 써야 한다. 낮출수록 눈금이 오른쪽으로 가고 알림이 늘어난다.
 */
function quantileOf(values: number[], q: number): number {
  if (values.length === 0) {
    return Number.NaN;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const position = q * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  if (lower === upper) {
    return sorted[lower] ?? Number.NaN;
  }

  const weight = position - lower;
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
}

export interface ScaleMarker {
  timeframe: Timeframe;
  /** 이 규모의 사건이 통과하려면 필요한 임계 백분위 (중앙값) */
  percentile: number;
  sliderPosition: number;
  /** 그 규모 이상의 사건 수 */
  eventCount: number;
  /** 그 규모 이상 사건의 하루 발생 빈도 (= 눈금의 목표 알림 수) */
  targetPerDay: number;
}

/**
 * 프레임 규모별로 "필요한 민감도"를 측정한다.
 *
 * 규모가 클수록(1d까지 흔들릴수록) 채널 신호가 높아서 더 엄격한 임계에서도
 * 통과한다. 따라서 1d 눈금이 왼쪽, 1m 눈금이 오른쪽에 온다.
 */
/**
 * 규모별 사건 발생 빈도로 눈금을 정한다.
 *
 * 정의: "이 위치에 두면 그 규모 이상의 급등 개수만큼 알림이 온다."
 * 1분봉급 이상 사건이 하루 17번 일어나면 1분봉 눈금에서 17번 울려야 한다.
 *
 * 앞서 쓴 "규모별 신호의 분위수" 방식은 버렸다. 분위수를 낮춰도 1분봉이
 * 하루 14회를 넘지 못하는데 눈금은 전부 한 곳에 뭉쳐서, 실제 차트 감각과
 * 맞추면서 슬라이더 폭을 유지할 방법이 없었다.
 *
 * anomalyReference는 "무엇을 사건으로 셀 것인가"의 기준선이다.
 * 낮출수록 작은 움직임까지 사건으로 세어 전체 빈도가 올라간다.
 * 이 값을 실제 차트 감각에 맞춰 고른다.
 */
export function measureScaleMarkers(
  streams: readonly CrossingStream[],
  anomalyReference: number,
): ScaleMarker[] {
  const countByFrame = new Map<number, number>();
  let totalDays = 0;

  for (const stream of streams) {
    totalDays += stream.measuredDays;
    for (const event of collectEvents(stream, anomalyReference)) {
      countByFrame.set(
        event.longestFrame,
        (countByFrame.get(event.longestFrame) ?? 0) + 1,
      );
    }
  }

  return TIMEFRAMES.map((timeframe, frameIndex) => {
    // 그 규모 "이상"의 사건을 센다. 1분봉 눈금은 모든 사건을 포함한다.
    let cumulative = 0;
    for (let i = frameIndex; i < TIMEFRAMES.length; i += 1) {
      cumulative += countByFrame.get(i) ?? 0;
    }

    const perDay = cumulative / totalDays;
    const sliderPosition = findPositionForRate(streams, perDay);

    return {
      timeframe,
      percentile: sliderToPercentile(sliderPosition),
      sliderPosition,
      eventCount: cumulative,
      targetPerDay: perDay,
    };
  });
}

/** 목표 빈도를 내는 슬라이더 위치를 이분 탐색으로 찾는다. */
function findPositionForRate(
  streams: readonly CrossingStream[],
  targetPerDay: number,
): number {
  let low = 1;
  let high = 100;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const rate = measureChannelCurve(streams, [mid])[0]?.perDay ?? 0;

    if (rate < targetPerDay) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

/**
 * 슬라이더 위치별 채널 알림 수.
 *
 * 프레임을 나누지 않는다. 알림은 채널당 하나이므로 사용자가 볼 숫자도
 * 하나여야 한다.
 */
export function measureChannelCurve(
  streams: readonly CrossingStream[],
  positions: readonly number[],
): { position: number; percentile: number; perDay: number }[] {
  return positions.map((position) => {
    const percentile = sliderToPercentile(position);

    let total = 0;
    for (const stream of streams) {
      total += evaluate(stream, {
        sensitivity: percentile,
        eventGapSeconds: EVENT_GAP_SECONDS,
        cooldownScale: 1,
        tightening: 5,
      }).alertsPerDay;
    }

    return { position, percentile, perDay: total / streams.length };
  });
}
