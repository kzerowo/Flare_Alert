import {
  FRAME_MERGE_WINDOW_SECONDS,
  TIMEFRAMES,
  percentileToSlider,
} from "@flare-alert/core";
import type { Timeframe } from "@flare-alert/core";

import type { CrossingStream } from "./crossings.js";
import { evaluate } from "./engine.js";

/**
 * 프레임별 "표준 민감도"를 실측으로 찾는다.
 *
 * 채널은 민감도 하나를 여러 프레임에 함께 적용하지만, 프레임마다 울리는
 * 빈도가 크게 다르다. 대형 종목에서 1분봉은 알림의 8할을 만들고 1일봉은
 * 2%밖에 안 만든다. 그래서 "1분봉을 주로 볼 거면 이쯤"이라는 안내가
 * 없으면 사용자가 슬라이더를 어디에 둬야 할지 알 수 없다.
 *
 * 격리해서 잰다. 프레임 하나만 켠 상태에서 목표 빈도가 나오는 민감도를
 * 이분 탐색으로 찾는다.
 */

export interface FrameStandard {
  timeframe: Timeframe;
  /** 목표 빈도를 내는 백분위 임계 */
  percentile: number;
  /** 슬라이더 위치 (1~100) */
  sliderPosition: number;
  /** 그 민감도에서 실제로 나온 하루 알림 수 (종목 평균) */
  measuredPerDay: number;
}

/** 프레임 하나를 격리했을 때의 종목 평균 하루 알림 수. */
function averagePerDay(
  streams: readonly CrossingStream[],
  frameIndex: number,
  percentile: number,
): number {
  let total = 0;

  for (const stream of streams) {
    const result = evaluate(stream, {
      sensitivity: percentile,
      mergeWindowSeconds: FRAME_MERGE_WINDOW_SECONDS,
      cooldownScale: 1,
      tightening: 5,
      onlyFrame: frameIndex,
    });
    total += result.alertsPerDay;
  }

  return total / streams.length;
}

/**
 * 목표 빈도에 가장 가까운 백분위를 이분 탐색으로 찾는다.
 *
 * 빈도는 백분위에 대해 단조 감소하므로 이분 탐색이 성립한다.
 * 탐색 하한은 교차 스트림이 담고 있는 구간으로 제한된다.
 */
function findPercentileFor(
  streams: readonly CrossingStream[],
  frameIndex: number,
  targetPerDay: number,
  minPercentile: number,
): { percentile: number; measured: number } {
  let low = minPercentile;
  let high = 99.99;

  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    const rate = averagePerDay(streams, frameIndex, mid);

    if (rate > targetPerDay) {
      // 너무 자주 울린다 → 임계를 올린다
      low = mid;
    } else {
      high = mid;
    }
  }

  const percentile = Math.round(((low + high) / 2) * 100) / 100;
  return {
    percentile,
    measured: averagePerDay(streams, frameIndex, percentile),
  };
}

export function measureFrameStandards(
  streams: readonly CrossingStream[],
  targetPerDay: number,
): FrameStandard[] {
  const minPercentile = Math.max(
    ...streams.map((s) => s.minPercentile),
  );

  return TIMEFRAMES.map((timeframe, frameIndex) => {
    const { percentile, measured } = findPercentileFor(
      streams,
      frameIndex,
      targetPerDay,
      minPercentile,
    );

    return {
      timeframe,
      percentile,
      sliderPosition: percentileToSlider(percentile),
      measuredPerDay: measured,
    };
  });
}

/** 각 프레임을 여러 민감도에서 격리 측정한 표. 표준값의 근거를 보여준다. */
export function frameRateTable(
  streams: readonly CrossingStream[],
  percentiles: readonly number[],
): Map<Timeframe, number[]> {
  const table = new Map<Timeframe, number[]>();

  TIMEFRAMES.forEach((timeframe, frameIndex) => {
    table.set(
      timeframe,
      percentiles.map((p) => averagePerDay(streams, frameIndex, p)),
    );
  });

  return table;
}
