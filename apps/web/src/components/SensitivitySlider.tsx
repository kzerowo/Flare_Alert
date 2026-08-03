"use client";

import {
  SENSITIVITY_LEVEL_MAX,
  SENSITIVITY_LEVEL_MIN,
  SENSITIVITY_SCALES,
  levelForScale,
  sensitivityAt,
} from "@flare-alert/core";

import { formatAlertsPerDay, useT } from "@/lib/i18n";
import { Icon } from "./Icon";

/**
 * 슬라이더는 1~100이고, 정하는 것은 알림 빈도다.
 *
 * 배수를 눈금으로 삼던 때가 있었다. 그때는 판정 창이 15분에 고정되어
 * 있어서 움직일 것이 배수밖에 없었는데, 그 고정이 바로 사용자가 기각한
 * 지점이다 — 유동성 판별 기준이 특정 봉이어서는 안 된다는 것.
 *
 * 다음에는 눈금이 봉 이름 다섯 개였다. 그건 너무 성겼다 — 15분봉(하루
 * 4.2회)에서 5분봉(하루 10회)으로 한 칸에 2.4배가 뛰어서, 그 사이를
 * 원하는 사용자가 갈 자리가 없었다.
 *
 * 지금은 100칸이다. 봉 길이는 여전히 다섯 개 중 하나로 붙지만(집계기가
 * 종목당 여섯 프레임만 계산한다), 구간 안에서 배수가 연속으로 움직인다.
 * 봉 이름은 눈금 자리에 남아 "여기쯤이면 이 봉급"을 알려 준다.
 *
 * 화면의 "하루 몇 회"는 지어낸 숫자가 아니다. 봉마다 배수를 촘촘히 훑어
 * 실측한 곡선(SCALE_RATE_CURVES)에서 읽는다.
 */

/** 슬라이더 위치를 트랙 위 백분율로. */
function toTrackPercent(level: number): number {
  return (
    ((level - SENSITIVITY_LEVEL_MIN) /
      (SENSITIVITY_LEVEL_MAX - SENSITIVITY_LEVEL_MIN)) *
    100
  );
}

/** 배수를 "3.6배" / "3.6x"로. 소수점은 필요할 때만 붙인다. */
function formatRatio(ratio: number, suffix: string): string {
  const rounded = Math.round(ratio * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}${suffix}`;
}

interface Props {
  /** 채널의 민감도 위치(1~100). 저장되는 값 그대로다. */
  value: number;
  onChange: (level: number) => void;
}

export function SensitivitySlider({ value, onChange }: Props) {
  const t = useT();
  const current = sensitivityAt(value);

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
        {/* 봉 눈금. 각 구간의 오른쪽 끝이 실측 앵커 자리다. */}
        <div className="relative h-8">
          {SENSITIVITY_SCALES.map((scale) => {
            const anchor = levelForScale(scale.timeframe);
            const active = value >= anchor;
            return (
              <div
                key={scale.timeframe}
                className="absolute flex -translate-x-1/2 flex-col items-center"
                style={{ left: `${toTrackPercent(anchor)}%` }}
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
          min={SENSITIVITY_LEVEL_MIN}
          max={SENSITIVITY_LEVEL_MAX}
          step={1}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
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
            {t.slider.ratePerCoin(formatAlertsPerDay(t, current.alertsPerDay))}
          </p>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-outline">
        {t.slider.footnote}
      </p>
    </section>
  );
}
