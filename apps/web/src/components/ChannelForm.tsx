"use client";

import { useMemo, useState } from "react";

import {
  CHANNEL_PROBLEM_MESSAGE,
  MAX_CHANNEL_NAME_LENGTH,
  MAX_SYMBOLS_PER_CHANNEL,
  POPULAR_BINANCE_SYMBOLS,
  createChannel,
  displaySymbol,
  toBinanceSymbol,
  validateChannel,
} from "@flare-alert/core";
import type { Channel, DeliveryMethod } from "@flare-alert/core";

import { SensitivitySlider } from "./SensitivitySlider";

interface Props {
  /**
   * 편집이면 기존 채널, 새로 만들기면 undefined.
   * exactOptionalPropertyTypes가 켜져 있어 undefined를 명시해야 한다.
   */
  initial?: Channel | undefined;
  /** 로그인 여부. 게스트는 텔레그램을 고를 수 없다. */
  signedIn: boolean;
  onSave: (channel: Channel) => void;
  onCancel: () => void;
}

export function ChannelForm({ initial, signedIn, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<Channel>(
    () => initial ?? createChannel(),
  );
  const [query, setQuery] = useState("");
  const [showProblems, setShowProblems] = useState(false);

  const selected = useMemo(
    () => new Set(draft.symbols.map((s) => s.symbol)),
    [draft.symbols],
  );

  const matches = useMemo(() => {
    const needle = query.trim().toUpperCase();
    if (needle.length === 0) {
      return POPULAR_BINANCE_SYMBOLS;
    }
    return POPULAR_BINANCE_SYMBOLS.filter((s) => s.includes(needle));
  }, [query]);

  const problems = validateChannel(draft);

  function toggleSymbol(symbol: string): void {
    setDraft((previous) => {
      if (selected.has(symbol)) {
        return {
          ...previous,
          symbols: previous.symbols.filter((s) => s.symbol !== symbol),
        };
      }
      if (previous.symbols.length >= MAX_SYMBOLS_PER_CHANNEL) {
        return previous;
      }
      return {
        ...previous,
        symbols: [...previous.symbols, toBinanceSymbol(symbol)],
      };
    });
  }

  function toggleDelivery(method: DeliveryMethod): void {
    setDraft((previous) => {
      const has = previous.delivery.includes(method);
      return {
        ...previous,
        delivery: has
          ? previous.delivery.filter((m) => m !== method)
          : [...previous.delivery, method],
      };
    });
  }

  function submit(): void {
    if (problems.length > 0) {
      setShowProblems(true);
      return;
    }
    onSave({ ...draft, name: draft.name.trim() });
  }

  return (
    <div className="space-y-8">
      <div>
        <label htmlFor="channel-name" className="text-sm font-medium">
          채널 이름
        </label>
        <input
          id="channel-name"
          type="text"
          value={draft.name}
          maxLength={MAX_CHANNEL_NAME_LENGTH}
          onChange={(event) =>
            setDraft((previous) => ({ ...previous, name: event.target.value }))
          }
          placeholder="예: 메이저 단타"
          className="mt-2 w-full rounded-lg border border-flare-muted/25 bg-flare-surface px-3 py-2 text-sm outline-none focus:border-flare-accent"
        />
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium">감시할 코인</span>
          <span className="text-xs text-flare-muted">
            {draft.symbols.length} / {MAX_SYMBOLS_PER_CHANNEL}
          </span>
        </div>

        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="코인 검색"
          className="mt-2 w-full rounded-lg border border-flare-muted/25 bg-flare-surface px-3 py-2 text-sm outline-none focus:border-flare-accent"
        />

        <div className="mt-3 flex max-h-52 flex-wrap gap-2 overflow-y-auto rounded-lg border border-flare-muted/15 p-3">
          {matches.length === 0 ? (
            <p className="text-sm text-flare-muted">검색 결과가 없습니다.</p>
          ) : (
            matches.map((symbol) => {
              const on = selected.has(symbol);
              return (
                <button
                  key={symbol}
                  type="button"
                  onClick={() => toggleSymbol(symbol)}
                  className={
                    on
                      ? "rounded-full border border-flare-accent bg-flare-accent/15 px-3 py-1 text-xs text-flare-accent"
                      : "rounded-full border border-flare-muted/30 px-3 py-1 text-xs text-flare-muted hover:border-flare-muted/60"
                  }
                >
                  {displaySymbol(symbol)}
                </button>
              );
            })
          )}
        </div>
      </div>

      <SensitivitySlider
        value={draft.sensitivity}
        onChange={(sensitivity) =>
          setDraft((previous) => ({ ...previous, sensitivity }))
        }
        symbolCount={draft.symbols.length}
      />

      <div>
        <span className="text-sm font-medium">알림 받을 방법</span>

        <div className="mt-3 space-y-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-flare-muted/20 p-3">
            <input
              type="checkbox"
              checked={draft.delivery.includes("browser")}
              onChange={() => toggleDelivery("browser")}
              className="mt-0.5 accent-flare-accent"
            />
            <span className="text-sm">
              브라우저 알림
              <span className="mt-0.5 block text-xs text-flare-muted">
                이 탭이 열려 있는 동안 울립니다. 탭을 닫으면 알림이 오지
                않습니다.
              </span>
            </span>
          </label>

          <label
            className={
              signedIn
                ? "flex cursor-pointer items-start gap-3 rounded-lg border border-flare-muted/20 p-3"
                : "flex items-start gap-3 rounded-lg border border-flare-muted/10 p-3 opacity-50"
            }
          >
            <input
              type="checkbox"
              disabled={!signedIn}
              checked={draft.delivery.includes("telegram")}
              onChange={() => toggleDelivery("telegram")}
              className="mt-0.5 accent-flare-accent"
            />
            <span className="text-sm">
              텔레그램
              <span className="mt-0.5 block text-xs text-flare-muted">
                {signedIn
                  ? "자리를 비워도 폰으로 받습니다."
                  : "로그인하면 쓸 수 있습니다. 계정에 봇을 연결해야 합니다."}
              </span>
            </span>
          </label>
        </div>
      </div>

      {showProblems && problems.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
          {problems.map((problem) => (
            <li key={problem}>· {CHANNEL_PROBLEM_MESSAGE[problem]}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          className="rounded-lg bg-flare-accent px-4 py-2 text-sm font-medium text-flare-bg hover:opacity-90"
        >
          {initial === undefined ? "채널 만들기" : "저장"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-flare-muted/30 px-4 py-2 text-sm text-flare-muted hover:border-flare-muted/60"
        >
          취소
        </button>
      </div>
    </div>
  );
}
