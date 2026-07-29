"use client";

import { useEffect, useMemo, useState } from "react";

import { displaySymbol } from "@flare-alert/core";

import { useAlerts } from "@/lib/alerts";
import type { AlertRecord } from "@/lib/alerts";
import { useChannels } from "@/lib/channel-store";
import { useI18n, useT } from "@/lib/i18n";
import { LOCALE_TAG } from "@/lib/locale";
import { CoinIcon } from "./CoinIcon";
import { Icon } from "./Icon";

/**
 * 얼마나 지났는지.
 *
 * 절대 시각만 보여 주면 "방금인가 어제인가"를 매번 계산해야 한다.
 * 하루가 넘어가면 상대 표기가 오히려 불편해지므로 날짜로 바꾼다.
 */
function relativeTime(
  t: ReturnType<typeof useT>,
  firedAtMs: number,
  nowMs: number,
): string {
  const seconds = Math.max(0, Math.floor((nowMs - firedAtMs) / 1000));

  if (seconds < 60) {
    return t.alerts.justNow;
  }
  if (seconds < 3600) {
    return t.alerts.minutesAgo(Math.floor(seconds / 60));
  }
  if (seconds < 86_400) {
    return t.alerts.hoursAgo(Math.floor(seconds / 3600));
  }
  return t.alerts.daysAgo(Math.floor(seconds / 86_400));
}

/**
 * 가격 표기.
 *
 * 종목마다 자릿수가 크게 다르다. BTC는 6만이고 SHIB는 0.00002라
 * 고정 소수점으로는 한쪽이 반드시 망가진다.
 */
function formatPrice(price: number, tag: string): string {
  const digits = price >= 100 ? 2 : price >= 1 ? 4 : 8;
  return price.toLocaleString(tag, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * 절대 시각 (시:분:초).
 *
 * 상대 시각만으로는 차트와 대조할 수가 없다. "5분 전"을 보고 매번
 * 지금이 몇 시인지 계산해야 하는데, 알림을 확인하는 이유가 바로
 * 그 시점의 차트를 보려는 것이다.
 */
function formatClock(firedAtMs: number, tag: string): string {
  return new Date(firedAtMs).toLocaleTimeString(tag, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatVolume(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${Math.round(value / 1000)}K`;
  }
  return Math.round(value).toString();
}

function AlertItem({
  alert,
  channelName,
  nowMs,
  onRemove,
}: {
  alert: AlertRecord;
  channelName: string | null;
  nowMs: number;
  onRemove: () => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const tag = LOCALE_TAG[locale];

  const fired = new Date(alert.firedAtMs);

  return (
    <li className="card group flex items-center gap-4 rounded-xl p-4">
      <CoinIcon symbol={alert.symbol} size={28} />

      <div className="min-w-0 flex-grow">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-title font-semibold">
            {displaySymbol(alert.symbol)}
          </span>
          <span className="label rounded border border-primary/20 bg-primary/10 px-2 py-[2px] text-primary">
            {t.frameScale[alert.scale]}
          </span>
          <span className="text-body-sm text-on-surface-variant">
            {t.alerts.ratio(alert.ratioToMedian.toFixed(1))}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-on-surface-variant">
          <span
            className="flex items-baseline gap-2"
            title={fired.toLocaleString(tag)}
          >
            <span className="font-mono">
              {formatClock(alert.firedAtMs, tag)}
            </span>
            <span>{relativeTime(t, alert.firedAtMs, nowMs)}</span>
          </span>
          <span className="font-mono">
            {formatPrice(alert.price, tag)}
          </span>
          <span className="font-mono">
            {t.alerts.volume(formatVolume(alert.quoteVolume))}
          </span>
        </div>

        {channelName === null ? null : (
          <p className="mt-1 truncate text-body-sm text-outline">
            {channelName}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label={t.alerts.remove}
        // 기록은 자주 지우는 것이 아니라 평소에는 숨겨 둔다.
        // 키보드 사용자를 위해 포커스가 오면 다시 보이게 한다.
        className="shrink-0 text-outline opacity-0 transition-all hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Icon name="close" size={16} />
      </button>
    </li>
  );
}

export function AlertHistory({
  signedIn,
  channelId,
}: {
  signedIn: boolean;
  /** 지정하면 그 채널의 알림만 본다. 채널 카드에서 들어온 경우. */
  channelId?: string | undefined;
}) {
  const t = useT();
  const { alerts, loaded, failed, remove } = useAlerts();
  const { channels } = useChannels();

  const channelNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const channel of channels) {
      map.set(channel.id, channel.name);
    }
    return map;
  }, [channels]);

  const visible = useMemo(
    () =>
      channelId === undefined
        ? alerts
        : alerts.filter((alert) => alert.channelId === channelId),
    [alerts, channelId],
  );

  // 상대 시각을 계속 다시 그리지 않는다. 1분마다면 "3분 전"이 늦어도
  // 1분 안에 "4분 전"이 되므로 충분하다.
  const nowMs = useNow(60_000);

  if (!signedIn) {
    return (
      <EmptyState
        icon="lock"
        title={t.alerts.guestTitle}
        body={t.alerts.guestBody}
      />
    );
  }

  if (failed) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-body-sm text-danger">
        {t.alerts.loadFailed}
      </div>
    );
  }

  if (!loaded) {
    return null;
  }

  if (visible.length === 0) {
    return (
      <EmptyState
        icon="bell"
        title={t.alerts.emptyTitle}
        body={
          channelId === undefined
            ? t.alerts.emptyBody
            : t.alerts.emptyChannelBody
        }
      />
    );
  }

  return (
    <ul className="space-y-2">
      {visible.map((alert) => (
        <AlertItem
          key={alert.id}
          alert={alert}
          // 채널 이름은 목록 전체를 볼 때만 붙인다. 한 채널만 보고 있으면
          // 모든 줄에 같은 이름이 반복되어 읽는 데 방해만 된다.
          channelName={
            channelId === undefined
              ? (channelNames.get(alert.channelId) ?? null)
              : null
          }
          nowMs={nowMs}
          onRemove={() => void remove(alert.id)}
        />
      ))}
    </ul>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: "bell" | "lock";
  title: string;
  body: string;
}) {
  return (
    <div className="card mx-auto flex max-w-md flex-col items-center rounded-xl border-dashed p-12 text-center">
      <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-high text-primary">
        <Icon name={icon} size={32} />
      </span>
      <h3 className="text-title">{title}</h3>
      <p className="mt-1 text-body-sm text-on-surface-variant">{body}</p>
    </div>
  );
}

/** 일정 간격으로만 다시 그리는 현재 시각. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
