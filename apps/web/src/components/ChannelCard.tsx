"use client";

import {
  FRAME_SCALE_PERCENTILE,
  TIMEFRAMES,
  displaySymbol,
  estimateAlertsPerDay,
  percentileToSlider,
} from "@flare-alert/core";
import type { Channel, Timeframe } from "@flare-alert/core";

import { useT } from "@/lib/i18n";
import { Icon } from "./Icon";

/**
 * 코인 상징색.
 *
 * 시안은 코인 로고 이미지를 외부 CDN에서 불러오지만, 종목이 늘어날 때마다
 * 이미지를 구해야 하고 로드 실패도 처리해야 한다. 잘 알려진 몇 개만
 * 색 점으로 두고 나머지는 기본색을 쓴다.
 */
const SYMBOL_COLOR: Record<string, string> = {
  BTC: "#f7931a",
  ETH: "#627eea",
  SOL: "#14f195",
  XRP: "#23292f",
  BNB: "#f3ba2f",
  DOGE: "#c2a633",
  ADA: "#0033ad",
  LINK: "#2a5ada",
  DOT: "#e6007a",
  AVAX: "#e84142",
};

/** 이 민감도가 잡아내는 가장 작은 규모. 슬라이더와 같은 규칙이다. */
function scaleOf(percentile: number): Timeframe | null {
  const position = percentileToSlider(percentile);
  for (const timeframe of TIMEFRAMES) {
    if (percentileToSlider(FRAME_SCALE_PERCENTILE[timeframe]) <= position) {
      return timeframe;
    }
  }
  return null;
}

interface Props {
  channel: Channel;
  onEdit: () => void;
  onRemove: () => void;
  onToggle: () => void;
}

export function ChannelCard({ channel, onEdit, onRemove, onToggle }: Props) {
  const t = useT();
  const position = percentileToSlider(channel.sensitivity);
  const perDay =
    estimateAlertsPerDay(position) * Math.max(channel.symbols.length, 1);
  const scale = scaleOf(channel.sensitivity);

  return (
    <li
      className={`card flex flex-col overflow-hidden rounded-xl ${
        channel.enabled ? "" : "opacity-60"
      }`}
    >
      {/* 머리 */}
      <div className="flex items-center justify-between bg-white/5 p-4">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={channel.enabled ? "text-primary" : "text-outline"}
            aria-hidden="true"
          >
            <Icon name="activity" size={20} />
          </span>
          <h3 className="truncate text-title font-semibold">{channel.name}</h3>
        </div>
      </div>

      {/* 몸통 */}
      <div className="grid flex-grow grid-cols-1 gap-4 p-4 md:grid-cols-2">
        <div className="space-y-4">
          <div>
            <p className="label mb-1 text-on-surface-variant">{t.card.symbols}</p>
            {channel.symbols.length === 0 ? (
              <p className="text-body-sm text-outline">{t.card.noSymbols}</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {channel.symbols.map((ref) => {
                  const name = displaySymbol(ref.symbol);
                  return (
                    <span
                      key={ref.symbol}
                      className="flex items-center gap-1 rounded border border-white/10 bg-surface-highest px-2 py-1"
                    >
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{
                          backgroundColor: SYMBOL_COLOR[name] ?? "#4b5563",
                        }}
                      />
                      <span className="font-mono text-data">{name}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <div>
              <p className="label text-on-surface-variant">
                {t.card.sensitivity}
              </p>
              <p className="font-mono text-headline text-primary">
                {position}%
              </p>
            </div>
            <div className="text-right">
              <p className="label text-on-surface-variant">{t.card.perDay}</p>
              <p className="font-mono text-headline">
                {perDay < 1 ? perDay.toFixed(1) : Math.round(perDay)}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4 border-t border-white/5 pt-4 md:border-l md:border-t-0 md:pl-4 md:pt-0">
          <div>
            <p className="label mb-1 text-on-surface-variant">{t.card.catches}</p>
            <p className="text-body-sm">
              {scale === null
                ? t.card.catchesLargest
                : t.card.catchesFrom(t.frameScale[scale])}
            </p>
          </div>

          <div>
            <p className="label mb-1 text-on-surface-variant">
              {t.card.delivery}
            </p>
            <div className="flex flex-wrap gap-1">
              {channel.delivery.map((method) => (
                <span
                  key={method}
                  className="label inline-flex items-center gap-1 rounded border border-primary/20 bg-primary/10 px-2 py-1 text-primary"
                >
                  <Icon name={method === "browser" ? "globe" : "send"} size={14} />
                  {method === "browser" ? t.form.browser : t.form.telegram}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 발 */}
      <div className="flex items-center justify-between border-t border-white/5 bg-white/[0.02] p-4">
        <div className="flex gap-4">
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1 text-body-sm text-on-surface-variant transition-colors hover:text-primary"
          >
            <Icon name="edit" size={16} />
            {t.card.edit}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center gap-1 text-body-sm text-on-surface-variant transition-colors hover:text-danger"
          >
            <Icon name="trash" size={16} />
            {t.card.remove}
          </button>
        </div>

        <div className="flex items-center gap-4">
          <span
            className={`label ${channel.enabled ? "text-primary" : "text-outline"}`}
          >
            {channel.enabled ? t.card.watching : t.card.off}
          </span>

          {/* 토글 스위치 */}
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={channel.enabled}
              onChange={onToggle}
              className="peer sr-only"
              aria-label={t.card.toggleLabel(channel.name)}
            />
            <span className="h-5 w-9 rounded-full bg-surface-highest after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-primary-container peer-checked:after:translate-x-full" />
          </label>
        </div>
      </div>
    </li>
  );
}
