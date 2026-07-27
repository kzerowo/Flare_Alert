"use client";

import { useMemo, useState } from "react";

import {
  FRAME_SCALE_PERCENTILE,
  SENSITIVITY_DEFAULT,
  SLIDER_MAX,
  SLIDER_MIN,
  TIMEFRAMES,
  estimateAlertsPerDay,
  formatAlertsPerDay,
  percentileToSlider,
} from "@flare-alert/core";
import type { Timeframe } from "@flare-alert/core";

const FRAME_LABEL: Record<Timeframe, string> = {
  "1m": "1분봉",
  "5m": "5분봉",
  "15m": "15분봉",
  "1h": "1시간봉",
  "4h": "4시간봉",
  "1d": "1일봉",
};

/**
 * 사건 규모 눈금.
 *
 * 알림은 채널당 하나이고 기준은 민감도 하나뿐이다. 프레임은 판정 축이
 * 아니라 "이 민감도가 어느 정도인지" 알려주는 참고 라벨이다.
 *
 * 1분봉급 급등은 짧게 터지고 말아 신호가 약하므로 민감도를 높여야
 * 잡힌다(오른쪽). 1일봉급은 크고 오래 가서 신호가 강하므로 낮은
 * 민감도로도 잡힌다(왼쪽).
 */
interface Marker {
  position: number;
  timeframes: Timeframe[];
}

function buildMarkers(): Marker[] {
  const byPosition = new Map<number, Timeframe[]>();

  for (const timeframe of TIMEFRAMES) {
    const position = percentileToSlider(FRAME_SCALE_PERCENTILE[timeframe]);
    const existing = byPosition.get(position);
    if (existing === undefined) {
      byPosition.set(position, [timeframe]);
    } else {
      existing.push(timeframe);
    }
  }

  // 라벨이 겹쳐 못 읽는 것을 막는다. 긴 프레임끼리는 위치가 가깝다.
  const sorted = [...byPosition.entries()].sort((a, b) => a[0] - b[0]);
  const merged: Marker[] = [];

  for (const [position, timeframes] of sorted) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && position - previous.position <= 4) {
      previous.timeframes.push(...timeframes);
      continue;
    }
    merged.push({ position, timeframes: [...timeframes] });
  }

  return merged;
}

function toTrackPercent(position: number): number {
  return ((position - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;
}

/**
 * 지금 민감도가 잡아내는 가장 작은 규모.
 *
 * TIMEFRAMES는 짧은 것부터이고 눈금 위치는 그 반대로 감소한다.
 * 그러므로 조건을 만족하는 첫 항목이 곧 가장 작은 규모다.
 * 마지막 항목을 잡으면 언제나 1일봉이 나온다.
 */
function scaleAt(position: number): Timeframe | null {
  for (const timeframe of TIMEFRAMES) {
    const markerPosition = percentileToSlider(
      FRAME_SCALE_PERCENTILE[timeframe],
    );
    if (markerPosition <= position) {
      return timeframe;
    }
  }

  return null;
}

export function SensitivitySlider() {
  const markers = useMemo(buildMarkers, []);
  const [position, setPosition] = useState(() =>
    percentileToSlider(SENSITIVITY_DEFAULT),
  );

  const perDay = estimateAlertsPerDay(position);
  const caught = scaleAt(position);

  return (
    <div className="w-full max-w-xl">
      <div className="mb-1 flex items-baseline justify-between">
        <label htmlFor="sensitivity" className="text-sm font-medium">
          민감도
        </label>
        <span className="text-lg font-semibold tabular-nums text-flare-accent">
          {position}%
        </span>
      </div>

      <div className="relative h-9">
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

      <div className="mt-6 rounded-lg border border-flare-muted/20 p-4">
        {caught === null ? (
          <p className="text-sm text-flare-muted">
            가장 큰 급등에만 알림이 옵니다.
          </p>
        ) : (
          <p className="text-sm">
            <b className="text-flare-accent">{FRAME_LABEL[caught]}</b> 차트에서
            눈에 띌 규모의 급등부터 알림이 옵니다.
          </p>
        )}

        <p className="mt-2 text-sm text-flare-muted">
          코인 1개당 {formatAlertsPerDay(perDay)} 정도. 채널에 코인을 여러 개
          넣으면 그만큼 늘어납니다.
        </p>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-flare-muted/70">
        눈금은 민감도의 세기를 가늠하기 위한 참고입니다. 알림 기준은 민감도
        하나뿐이며, 봉마다 따로 울리지 않고 채널당 하나로 나갑니다.
        수치는 바이낸스 6종목 백테스트(2026년 4~6월) 평균이라, 대형 종목일수록
        더 자주 울립니다.
      </p>
    </div>
  );
}
