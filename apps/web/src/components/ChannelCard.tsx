"use client";

import {
  FRAME_SCALE_PERCENTILE,
  TIMEFRAMES,
  displaySymbol,
  estimateAlertsPerDay,
  formatAlertsPerDay,
  percentileToSlider,
} from "@flare-alert/core";
import type { Channel, Timeframe } from "@flare-alert/core";

const FRAME_LABEL: Record<Timeframe, string> = {
  "1m": "1분봉급",
  "5m": "5분봉급",
  "15m": "15분봉급",
  "1h": "1시간봉급",
  "4h": "4시간봉급",
  "1d": "1일봉급",
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
  const position = percentileToSlider(channel.sensitivity);
  const perDay =
    estimateAlertsPerDay(position) * Math.max(channel.symbols.length, 1);
  const scale = scaleOf(channel.sensitivity);

  return (
    <li
      className={
        channel.enabled
          ? "rounded-xl border border-flare-muted/20 bg-flare-surface p-4"
          : "rounded-xl border border-flare-muted/10 bg-flare-surface/50 p-4 opacity-60"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{channel.name}</h3>
          <p className="mt-1 truncate text-sm text-flare-muted">
            {channel.symbols.length === 0
              ? "코인 없음"
              : channel.symbols.map((s) => displaySymbol(s.symbol)).join(", ")}
          </p>
        </div>

        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-flare-muted">
          <input
            type="checkbox"
            checked={channel.enabled}
            onChange={onToggle}
            className="accent-flare-accent"
          />
          {channel.enabled ? "켜짐" : "꺼짐"}
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-flare-muted">
        <span className="text-flare-accent">민감도 {position}%</span>
        {scale === null ? null : <span>{FRAME_LABEL[scale]} 이상</span>}
        <span>약 {formatAlertsPerDay(perDay)}</span>
        <span>
          {channel.delivery
            .map((m) => (m === "browser" ? "브라우저" : "텔레그램"))
            .join(" + ")}
        </span>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border border-flare-muted/30 px-3 py-1.5 text-xs text-flare-muted hover:border-flare-muted/60"
        >
          편집
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-lg border border-flare-muted/20 px-3 py-1.5 text-xs text-flare-muted hover:border-red-500/50 hover:text-red-400"
        >
          삭제
        </button>
      </div>
    </li>
  );
}
