"use client";

import { useMemo } from "react";

import {
  FRAME_SCALE_PERCENTILE,
  SLIDER_MAX,
  SLIDER_MIN,
  TIMEFRAMES,
  estimateAlertsPerDay,
  formatAlertsPerDay,
  percentileToSlider,
  sliderToPercentile,
} from "@flare-alert/core";
import type { Timeframe } from "@flare-alert/core";

import { Icon } from "./Icon";

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
 * 위치는 백테스트 실측값이고 간격이 고르지 않다. 시안은 여섯 개를 균등
 * 배치했지만 그렇게 하면 라벨이 거짓말이 된다. 1분봉급 급등은 흔해서
 * 오른쪽, 1일봉급은 드물어서 왼쪽에 와야 한다.
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
 */
function scaleAt(position: number): Timeframe | null {
  for (const timeframe of TIMEFRAMES) {
    if (percentileToSlider(FRAME_SCALE_PERCENTILE[timeframe]) <= position) {
      return timeframe;
    }
  }
  return null;
}

interface Props {
  /** 백분위 임계. 슬라이더 위치가 아니라 저장되는 값 그대로다. */
  value: number;
  onChange: (percentile: number) => void;
  /** 채널에 담긴 코인 수. 예상 알림 수를 곱해서 보여준다. */
  symbolCount?: number;
}

export function SensitivitySlider({ value, onChange, symbolCount = 1 }: Props) {
  const markers = useMemo(buildMarkers, []);
  const position = percentileToSlider(value);

  const perCoin = estimateAlertsPerDay(position);
  const perDay = perCoin * Math.max(symbolCount, 1);
  const caught = scaleAt(position);

  return (
    <section className="space-y-md">
      <div className="flex items-end justify-between">
        <label htmlFor="sensitivity" className="label">
          민감도
        </label>
        <span className="font-mono text-headline text-primary">
          {position}%
        </span>
      </div>

      <div className="px-sm">
        {/* 규모 눈금. 간격이 고르지 않은 것이 정상이다. */}
        <div className="relative h-8">
          {markers.map((marker) => {
            const active = marker.position <= position;
            return (
              <div
                key={marker.position}
                className="absolute flex -translate-x-1/2 flex-col items-center"
                style={{ left: `${toTrackPercent(marker.position)}%` }}
              >
                <span
                  className={`whitespace-nowrap font-mono text-[11px] ${
                    active ? "font-bold text-primary" : "text-outline"
                  }`}
                >
                  {marker.timeframes.join("·")}
                </span>
                <span
                  className={`mt-0.5 h-2 w-px ${
                    active ? "bg-primary/60" : "bg-outline/40"
                  }`}
                />
              </div>
            );
          })}
        </div>

        <input
          id="sensitivity"
          type="range"
          min={SLIDER_MIN}
          max={SLIDER_MAX}
          step={1}
          value={position}
          onChange={(event) =>
            onChange(sliderToPercentile(Number(event.target.value)))
          }
          className="w-full"
        />

        <div className="mt-sm flex justify-between">
          <span className="label">조용히</span>
          <span className="label">자주</span>
        </div>
      </div>

      {/* 요약 */}
      <div className="flex items-start gap-md rounded-xl border border-primary/20 bg-primary/5 p-md">
        <span className="mt-0.5 shrink-0 text-primary">
          <Icon name="chart" size={20} />
        </span>
        <div className="space-y-xs">
          <h4 className="text-title text-primary">이 설정이면</h4>
          {caught === null ? (
            <p className="text-body-sm">가장 큰 급등에만 알림이 옵니다.</p>
          ) : (
            <p className="text-body-sm">
              <b>{FRAME_LABEL[caught]}</b> 차트에서 눈에 띌 규모의 급등부터
              알림이 옵니다.
            </p>
          )}
          <p className="text-body-sm text-on-surface-variant">
            {symbolCount > 1
              ? `코인 ${symbolCount}개 합쳐 ${formatAlertsPerDay(perDay)} 정도 (개당 ${formatAlertsPerDay(perCoin)})`
              : `코인 1개당 ${formatAlertsPerDay(perCoin)} 정도`}
          </p>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-outline">
        눈금은 민감도의 세기를 가늠하기 위한 참고입니다. 알림 기준은 민감도
        하나뿐이며, 봉마다 따로 울리지 않고 채널당 하나로 나갑니다. 수치는
        바이낸스 6종목 백테스트(2026년 4~6월) 평균이라 대형 종목일수록 더 자주
        울립니다.
      </p>
    </section>
  );
}
