"use client";

import { useMemo, useState } from "react";

import {
  FRAME_STANDARD_PERCENTILE,
  SENSITIVITY_DEFAULT,
  SLIDER_MAX,
  SLIDER_MIN,
  TIMEFRAMES,
  formatTail,
  percentileToSlider,
  sliderToPercentile,
} from "@flare-alert/core";
import type { Timeframe } from "@flare-alert/core";

/**
 * 프레임별 표준 민감도 눈금.
 *
 * 백테스트 실측값이다. "그 프레임 하나만 켰을 때 하루 1회쯤 울리는 지점".
 * 슬라이더 위치가 겹치는 프레임이 있어서 (4h 76, 1d 77) 라벨을 그대로
 * 겹쳐 놓으면 읽을 수 없다. 아래에서 묶어서 처리한다.
 */
interface Marker {
  position: number;
  timeframes: Timeframe[];
}

function buildMarkers(): Marker[] {
  const byPosition = new Map<number, Timeframe[]>();

  for (const timeframe of TIMEFRAMES) {
    const position = percentileToSlider(FRAME_STANDARD_PERCENTILE[timeframe]);
    const existing = byPosition.get(position);
    if (existing === undefined) {
      byPosition.set(position, [timeframe]);
    } else {
      existing.push(timeframe);
    }
  }

  // 라벨이 겹쳐 읽히지 않는 것을 막는다. 2 이하로 붙은 눈금은 하나로 합친다.
  const sorted = [...byPosition.entries()].sort((a, b) => a[0] - b[0]);
  const merged: Marker[] = [];

  for (const [position, timeframes] of sorted) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && position - previous.position <= 2) {
      previous.timeframes.push(...timeframes);
      continue;
    }
    merged.push({ position, timeframes: [...timeframes] });
  }

  return merged;
}

/** 슬라이더 위치를 트랙 위의 퍼센트로. */
function toTrackPercent(position: number): number {
  return ((position - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;
}

export function SensitivitySlider() {
  const markers = useMemo(buildMarkers, []);
  const [position, setPosition] = useState(() =>
    percentileToSlider(SENSITIVITY_DEFAULT),
  );

  const percentile = sliderToPercentile(position);

  // 지금 위치가 어느 프레임의 표준에 가장 가까운지.
  const nearest = useMemo(() => {
    let best = markers[0];
    if (best === undefined) {
      return null;
    }
    for (const marker of markers) {
      if (
        Math.abs(marker.position - position) <
        Math.abs(best.position - position)
      ) {
        best = marker;
      }
    }
    return best;
  }, [markers, position]);

  return (
    <div className="w-full max-w-xl">
      <div className="mb-2 flex items-baseline justify-between">
        <label htmlFor="sensitivity" className="text-sm font-medium">
          민감도
        </label>
        <span className="text-sm tabular-nums text-flare-muted">
          {position} · {formatTail(percentile)}
        </span>
      </div>

      {/* 눈금 라벨. 트랙 위쪽에 절대 위치로 얹는다. */}
      <div className="relative h-10">
        {markers.map((marker) => (
          <div
            key={marker.position}
            className="absolute flex -translate-x-1/2 flex-col items-center"
            style={{ left: `${toTrackPercent(marker.position)}%` }}
          >
            <span className="whitespace-nowrap text-[11px] text-flare-muted">
              {marker.timeframes.join("·")}
            </span>
            <span className="mt-0.5 h-2 w-px bg-flare-muted/50" />
          </div>
        ))}
      </div>

      <input
        id="sensitivity"
        type="range"
        min={SLIDER_MIN}
        max={SLIDER_MAX}
        step={1}
        value={position}
        onChange={(event) => setPosition(Number(event.target.value))}
        className="w-full accent-flare-accent"
      />

      <div className="mt-1 flex justify-between text-xs text-flare-muted">
        <span>조용히</span>
        <span>자주</span>
      </div>

      <p className="mt-4 text-sm text-flare-muted">
        {nearest === null ? null : (
          <>
            지금 위치는 <b className="text-flare-accent">
              {nearest.timeframes.join(", ")}
            </b>{" "}
            기준 표준에 가깝습니다. 그 프레임만 켜면 종목당 하루 1회쯤
            울립니다.
          </>
        )}
      </p>

      <p className="mt-2 text-xs leading-relaxed text-flare-muted/70">
        눈금은 백테스트 실측값입니다 (바이낸스 6종목, 2026년 4~6월). 프레임마다
        울리는 빈도가 크게 달라서, 같은 민감도에서 1분봉은 1일봉보다 30배쯤 자주
        울립니다. 여러 프레임을 함께 켜면 짧은 쪽이 알림 대부분을 차지합니다.
      </p>
    </div>
  );
}
