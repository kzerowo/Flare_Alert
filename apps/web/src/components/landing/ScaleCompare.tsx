"use client";

import { useT } from "@/lib/i18n";

/*
 * "평소보다 몇 배"가 왜 종목을 가리지 않는지 보여 주는 그림.
 *
 * 두 차트는 같은 배열에 서로 다른 배율만 곱한 것이다. 규모가 100배 차이
 * 나도 평소 대비 비율은 똑같다는 것이 이 절의 주장이라, 그림도 실제로
 * 같은 배열을 쓴다. 두 벌을 따로 지어내면 주장과 그림이 어긋난다.
 */

/** 평범한 봉을 1로 둔 상대 거래대금. 마지막 봉이 급증이다. */
const RELATIVE = [
  0.92, 0.74, 1.08, 0.69, 1.15, 0.81, 0.96, 0.74, 1.04, 0.88, 1.12, 3.71,
];

/** 각 종목의 "평범한 봉 하나" 거래대금(USDT). */
const LARGE_UNIT = 8_500_000;
const SMALL_UNIT = 85_000;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const BASE = median(RELATIVE.slice(0, -1));
const SPIKE = RELATIVE[RELATIVE.length - 1] ?? 0;
const RATIO = SPIKE / BASE;

function money(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${Math.round(value / 1_000)}K`;
  }
  return `$${Math.round(value)}`;
}

function MiniChart({ name, unit }: { name: string; unit: number }) {
  const t = useT();
  const ceiling = Math.max(...RELATIVE) * 1.12;

  return (
    <div className="card rounded-xl p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-title">{name}</span>
        <span className="font-mono text-body-sm text-on-surface-variant">
          {t.landing.ratio.normalLabel} {money(BASE * unit)}
        </span>
      </div>

      <div className="mt-4 flex h-28 items-end gap-1">
        {RELATIVE.map((value, index) => {
          const hot = index === RELATIVE.length - 1;
          return (
            <div
              key={index}
              className={`flex-1 rounded-t-[2px] ${
                hot
                  ? "bg-primary-container shadow-[0_0_16px_rgba(56,189,248,0.5)]"
                  : "bg-outline-variant/60"
              }`}
              style={{ height: `${(value / ceiling) * 100}%` }}
            />
          );
        })}
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className="label text-primary">{t.landing.ratio.spikeLabel}</span>
        <span className="font-mono text-data text-primary">
          {money(SPIKE * unit)}
          <span className="ml-2 text-on-surface-variant">
            {RATIO.toFixed(1)}x
          </span>
        </span>
      </div>
    </div>
  );
}

export function ScaleCompare() {
  const t = useT();

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <MiniChart name={t.landing.ratio.bigName} unit={LARGE_UNIT} />
        <MiniChart name={t.landing.ratio.smallName} unit={SMALL_UNIT} />
      </div>

      <p className="mt-4 text-center">
        <span className="label inline-block rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-primary">
          {t.landing.ratio.verdict}
        </span>
      </p>
    </div>
  );
}
