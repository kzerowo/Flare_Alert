import {
  FRAME_MERGE_WINDOW_SECONDS,
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

/** 규모 판정에 쓸 기준 백분위. 이보다 높으면 그 프레임이 흔들렸다고 본다. */
const ANOMALY_REFERENCE = 99;

function collectEvents(stream: CrossingStream): ScaledEvent[] {
  const events: ScaledEvent[] = [];
  const mergeWindowMs = FRAME_MERGE_WINDOW_SECONDS * 1000;
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

    if (percentile < ANOMALY_REFERENCE) {
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

    openUntilMs = atMs + mergeWindowMs;
  }

  flush();
  return events;
}

function medianOf(values: number[]): number {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? Number.NaN;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export interface ScaleMarker {
  timeframe: Timeframe;
  /** 이 규모의 사건이 통과하려면 필요한 임계 백분위 (중앙값) */
  percentile: number;
  sliderPosition: number;
  eventCount: number;
}

/**
 * 프레임 규모별로 "필요한 민감도"를 측정한다.
 *
 * 규모가 클수록(1d까지 흔들릴수록) 채널 신호가 높아서 더 엄격한 임계에서도
 * 통과한다. 따라서 1d 눈금이 왼쪽, 1m 눈금이 오른쪽에 온다.
 */
export function measureScaleMarkers(
  streams: readonly CrossingStream[],
): ScaleMarker[] {
  const signalsByFrame = new Map<number, number[]>();

  for (const stream of streams) {
    for (const event of collectEvents(stream)) {
      const bucket = signalsByFrame.get(event.longestFrame);
      if (bucket === undefined) {
        signalsByFrame.set(event.longestFrame, [event.channelSignal]);
      } else {
        bucket.push(event.channelSignal);
      }
    }
  }

  return TIMEFRAMES.map((timeframe, frameIndex) => {
    const signals = signalsByFrame.get(frameIndex) ?? [];
    const percentile = medianOf(signals);

    return {
      timeframe,
      percentile,
      sliderPosition: Number.isNaN(percentile)
        ? Number.NaN
        : percentileToSlider(percentile),
      eventCount: signals.length,
    };
  });
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
        mergeWindowSeconds: FRAME_MERGE_WINDOW_SECONDS,
        cooldownScale: 1,
        tightening: 5,
      }).alertsPerDay;
    }

    return { position, percentile, perDay: total / streams.length };
  });
}
