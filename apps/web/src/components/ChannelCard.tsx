"use client";

import { displaySymbol, sensitivityAt } from "@flare-alert/core";
import type { Channel } from "@flare-alert/core";

import { useT } from "@/lib/i18n";
import { CoinIcon } from "./CoinIcon";
import { Icon } from "./Icon";

interface Props {
  channel: Channel;
  onEdit: () => void;
  onRemove: () => void;
  onToggle: () => void;
  onHistory: () => void;
}

export function ChannelCard({
  channel,
  onEdit,
  onRemove,
  onToggle,
  onHistory,
}: Props) {
  const t = useT();
  const setting = sensitivityAt(channel.sensitivityLevel);
  // 채널당 종목이 하나라 곱할 것이 없다.
  const perDay = setting.alertsPerDay;
  const scale = setting.timeframe;

  return (
    <li
      className={`card flex flex-col overflow-hidden rounded-xl ${
        channel.enabled ? "" : "opacity-60"
      }`}
    >
      {/* 머리. 어느 코인인지가 제일 먼저 보여야 한다. */}
      <div className="flex items-center justify-between gap-2 bg-white/5 p-4">
        <div className="flex min-w-0 items-center gap-2">
          {channel.symbol === null ? (
            <span
              className={channel.enabled ? "text-primary" : "text-outline"}
              aria-hidden="true"
            >
              <Icon name="activity" size={20} />
            </span>
          ) : (
            <CoinIcon symbol={channel.symbol.symbol} size={20} />
          )}
          <h3 className="truncate text-title font-semibold">{channel.name}</h3>
        </div>

        {channel.symbol === null ? null : (
          <span className="shrink-0 font-mono text-data text-on-surface-variant">
            {displaySymbol(channel.symbol.symbol)}
          </span>
        )}
      </div>

      {/* 몸통 */}
      <div className="grid flex-grow grid-cols-1 gap-4 p-4 md:grid-cols-2">
        <div className="space-y-4">
          {/* 감시 종목은 카드 머리에 이미 있다. 여기서 또 보여주지 않는다. */}
          <div className="flex justify-between">
            <div>
              <p className="label text-on-surface-variant">
                {t.card.sensitivity}
              </p>
              <p className="font-mono text-headline text-primary">
                {channel.sensitivityLevel}%
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
              {t.card.catchesFrom(t.frameScale[scale])}
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
                  <Icon name="globe" size={14} />
                  {t.form.browser}
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
            onClick={onHistory}
            className="flex items-center gap-1 text-body-sm text-on-surface-variant transition-colors hover:text-primary"
          >
            <Icon name="bell" size={16} />
            {t.card.history}
          </button>
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
