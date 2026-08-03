"use client";

import {
  SCALE_MAX,
  SCALE_MIN,
  SENSITIVITY_SCALES,
  scaleAt,
  scaleIndexOf,
} from "@flare-alert/core";
import type { Timeframe } from "@flare-alert/core";

import { formatAlertsPerDay, useT } from "@/lib/i18n";
import { Icon } from "./Icon";

/**
 * 슬라이더가 정하는 것은 봉 길이다.
 *
 * 배수를 눈금으로 삼던 때가 있었다. 그때는 판정 창이 15분에 고정되어
 * 있어서 움직일 것이 배수밖에 없었는데, 그 고정이 바로 사용자가 기각한
 * 지점이다 — 유동성 판별 기준이 특정 봉이어서는 안 된다는 것.
 *
 * 이제 눈금은 봉 이름이고 배수는 그 자리에 딸려 오는 값이다. 배수를 아예
 * 숨기지는 않는다. 사용자가 차트를 보고 직접 확인할 수 있는 유일한
 * 숫자이기 때문에, 부차적으로 같이 보여 준다.
 *
 * 위치가 다섯 개뿐인 이유: 값이 전부 실측이다. 사이를 보간해서 100단계로
 * 만들면 화면에 적히는 "하루 몇 회"가 근거 없는 숫자가 된다. 그리고 다섯
 * 위치의 빈도가 0.3 / 1 / 4.2 / 10 / 30회로 충분히 벌어져 있어서, 한 칸이
 * 실제로 의미 있는 차이를 만든다.
 */
function toTrackPercent(index: number): number {
  if (SCALE_MAX === SCALE_MIN) {
    return 0;
  }
  return ((index - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
}

/** 배수를 "3.6배" / "3.6x"로. 소수점은 필요할 때만 붙인다. */
function formatRatio(ratio: number, suffix: string): string {
  const rounded = Math.round(ratio * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}${suffix}`;
}

interface Props {
  /** 채널이 판정에 쓰는 봉 길이. 저장되는 값 그대로다. */
  value: Timeframe;
  onChange: (scale: Timeframe) => void;
}

export function SensitivitySlider({ value, onChange }: Props) {
  const t = useT();
  const index = scaleIndexOf(value);
  const current = scaleAt(index);

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between">
        <label htmlFor="sensitivity" className="label text-on-surface-variant">
          {t.slider.label}
        </label>
        <span className="font-mono text-headline text-primary">
          {t.frameScale[current.timeframe]}
        </span>
      </div>

      <div className="px-2">
        {/* 봉 눈금. 위치가 곧 값이라 간격이 고르다. */}
        <div className="relative h-8">
          {SENSITIVITY_SCALES.map((scale, i) => {
            const active = i <= index;
            return (
              <div
                key={scale.timeframe}
                className="absolute flex -translate-x-1/2 flex-col items-center"
                style={{ left: `${toTrackPercent(i)}%` }}
              >
                <span
                  className={`whitespace-nowrap font-mono text-[11px] ${
                    active ? "font-bold text-primary" : "text-outline"
                  }`}
                >
                  {scale.timeframe}
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
          min={SCALE_MIN}
          max={SCALE_MAX}
          step={1}
          value={index}
          onChange={(event) =>
            onChange(scaleAt(Number(event.target.value)).timeframe)
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
            {t.slider.catchesScale(
              t.frameScale[current.timeframe],
              formatRatio(current.ratio, t.slider.ratioSuffix),
            )}
          </p>
          <p className="text-body-sm text-on-surface-variant">
            {t.slider.ratePerCoin(
              formatAlertsPerDay(t, current.alertsPerDay),
            )}
          </p>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-outline">
        {t.slider.footnote}
      </p>
    </section>
  );
}
