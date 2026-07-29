"use client";

import { useMemo } from "react";

import {
  SLIDER_MAX,
  SLIDER_MIN,
  estimateAlertsPerDay,
  percentileToSlider,
  ratioToSlider,
  sliderToPercentile,
  sliderToRatio,
} from "@flare-alert/core";

import { formatAlertsPerDay, useT } from "@/lib/i18n";
import { Icon } from "./Icon";

/**
 * 눈금은 판정 배수다.
 *
 * 예전에는 "1분봉급 / 5분봉급 …" 같은 규모 라벨을 달았다. 판정이 여섯
 * 프레임의 백분위 최댓값이던 시절의 이야기인데, 실제로는 늘 가장 요동치는
 * 프레임이 이겨서 라벨이 뜻하는 바와 알림이 맞지 않았다.
 *
 * 지금은 15분 창 하나로 판정하고 슬라이더가 정하는 것은 배수뿐이다.
 * 그러면 눈금도 배수여야 한다 — 사용자가 차트를 보고 직접 확인할 수 있는
 * 유일한 숫자이기도 하다.
 */
const RATIO_MARKS = [8, 6, 4, 3, 2] as const;

function toTrackPercent(position: number): number {
  return ((position - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;
}

/** 배수를 "4배" / "4x"로. 소수점은 필요할 때만 붙인다. */
function formatRatio(ratio: number, suffix: string): string {
  const rounded = Math.round(ratio * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}${suffix}`;
}

interface Props {
  /** 백분위 임계. 슬라이더 위치가 아니라 저장되는 값 그대로다. */
  value: number;
  onChange: (percentile: number) => void;
}

export function SensitivitySlider({ value, onChange }: Props) {
  const t = useT();
  const position = percentileToSlider(value);

  const markers = useMemo(
    () =>
      RATIO_MARKS.map((ratio) => ({
        ratio,
        position: ratioToSlider(ratio),
      })).sort((a, b) => a.position - b.position),
    [],
  );

  // 채널당 종목이 하나라 곱할 것이 없다.
  const perDay = estimateAlertsPerDay(position);
  const ratio = sliderToRatio(position);

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between">
        <label htmlFor="sensitivity" className="label text-on-surface-variant">
          {t.slider.label}
        </label>
        <span className="font-mono text-headline text-primary">
          {formatRatio(ratio, t.slider.ratioSuffix)}
        </span>
      </div>

      <div className="px-2">
        {/* 배수 눈금. 로그 축이라 간격이 고르지 않은 것이 정상이다. */}
        <div className="relative h-8">
          {markers.map((marker) => {
            const active = marker.position <= position;
            return (
              <div
                key={marker.ratio}
                className="absolute flex -translate-x-1/2 flex-col items-center"
                style={{ left: `${toTrackPercent(marker.position)}%` }}
              >
                <span
                  className={`whitespace-nowrap font-mono text-[11px] ${
                    active ? "font-bold text-primary" : "text-outline"
                  }`}
                >
                  {formatRatio(marker.ratio, t.slider.ratioSuffix)}
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

        <div className="mt-2 flex justify-between">
          <span className="label text-on-surface-variant">{t.slider.quiet}</span>
          <span className="label text-on-surface-variant">
            {t.slider.frequent}
          </span>
        </div>
      </div>

      {/* 요약 */}
      <div className="flex items-start gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <span className="mt-0.5 shrink-0 text-primary">
          <Icon name="chart" size={20} />
        </span>
        <div className="space-y-1">
          <h4 className="text-title text-primary">{t.slider.summaryTitle}</h4>
          <p className="text-body-sm">
            {t.slider.catchesRatioBefore}
            <b>{formatRatio(ratio, t.slider.ratioSuffix)}</b>
            {t.slider.catchesRatioAfter}
          </p>
          <p className="text-body-sm text-on-surface-variant">
            {t.slider.ratePerCoin(formatAlertsPerDay(t, perDay))}
          </p>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-outline">
        {t.slider.footnote}
      </p>
    </section>
  );
}
