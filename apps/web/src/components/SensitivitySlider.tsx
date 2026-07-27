"use client";

import { useMemo, useState } from "react";

import {
  FRAME_STANDARD_PERCENTILE,
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
 * 프레임별 권장 위치 눈금.
 *
 * "그 봉을 주로 볼 때 슬라이더를 어디 두면 되는가"다. 그 봉의 성격이
 * 아니라 설정 안내다. 1분봉이 왼쪽인 이유는 원래 자주 터지는 봉이라
 * 조용하게 만들려면 임계를 높여야 하기 때문이다.
 *
 * 4h(76)와 1d(77)처럼 붙어 있는 눈금은 라벨이 겹쳐 못 읽으므로 합친다.
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

  const sorted = [...byPosition.entries()].sort((a, b) => a[0] - b[0]);
  const merged: Marker[] = [];

  for (const [position, timeframes] of sorted) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && position - previous.position <= 3) {
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

export function SensitivitySlider() {
  const markers = useMemo(buildMarkers, []);
  const [position, setPosition] = useState(() =>
    percentileToSlider(SENSITIVITY_DEFAULT),
  );

  const rates = useMemo(
    () =>
      TIMEFRAMES.map((timeframe) => ({
        timeframe,
        perDay: estimateAlertsPerDay(timeframe, position),
      })),
    [position],
  );

  const maxRate = Math.max(...rates.map((r) => r.perDay), 0.01);

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

      {/* 권장 위치 눈금 */}
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

      <p className="mt-3 text-xs text-flare-muted">
        위 눈금은 그 봉을 주로 볼 때 권장하는 위치입니다.
      </p>

      {/* 지금 위치에서 프레임별로 얼마나 울리는지 */}
      <div className="mt-6 rounded-lg border border-flare-muted/20 p-4">
        <h3 className="text-sm font-medium">이 설정에서 예상되는 알림</h3>
        <p className="mt-1 text-xs text-flare-muted">
          코인 1개 기준. 봉을 여러 개 켜면 합쳐집니다.
        </p>

        <ul className="mt-3 space-y-2">
          {rates.map(({ timeframe, perDay }) => (
            <li key={timeframe} className="flex items-center gap-3 text-sm">
              <span className="w-16 shrink-0 text-flare-muted">
                {FRAME_LABEL[timeframe]}
              </span>

              <span className="h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-flare-muted/15">
                <span
                  className="block h-full rounded-full bg-flare-accent"
                  style={{ width: `${(perDay / maxRate) * 100}%` }}
                />
              </span>

              <span className="tabular-nums text-flare-muted">
                {formatAlertsPerDay(perDay)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-flare-muted/70">
        바이낸스 6종목 백테스트(2026년 4~6월) 실측 평균입니다. 대형 종목일수록
        더 자주, 소형일수록 덜 울립니다.
      </p>
    </div>
  );
}
