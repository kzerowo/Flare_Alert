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

import { Icon } from "./Icon";
import { SensitivitySlider } from "./SensitivitySlider";

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
  const [draft, setDraft] = useState<Channel>(() => initial ?? createChannel());
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
    <div className="panel overflow-hidden rounded-xl">
      <div className="border-b border-white/5 p-lg">
        <h2 className="text-display">
          {initial === undefined ? "채널 만들기" : "채널 편집"}
        </h2>
        <p className="mt-xs text-body-sm text-on-surface-variant">
          감시할 코인을 묶고 민감도를 정하세요.
        </p>
      </div>

      <div className="space-y-xl p-lg">
        {/* 이름 */}
        <section className="space-y-sm">
          <label htmlFor="channel-name" className="label block">
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
            className="w-full rounded-lg border border-white/10 bg-surface px-md py-md text-body transition-all placeholder:text-outline-variant focus:border-primary focus:outline-none"
          />
        </section>

        {/* 코인 */}
        <section className="space-y-md">
          <div className="flex items-end justify-between">
            <span className="label">감시 코인</span>
            <span className="font-mono text-data text-primary">
              {draft.symbols.length}개 선택
            </span>
          </div>

          <div className="relative">
            <span className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant">
              <Icon name="search" size={18} />
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="코인 검색 (BTC, ETH, SOL...)"
              className="w-full rounded-lg border border-white/10 bg-surface py-md pl-xl pr-md text-body transition-all placeholder:text-outline-variant focus:border-primary focus:outline-none"
            />
          </div>

          <div className="flex max-h-56 flex-wrap gap-sm overflow-y-auto">
            {matches.length === 0 ? (
              <p className="text-body-sm text-outline">검색 결과가 없습니다.</p>
            ) : (
              matches.map((symbol) => {
                const name = displaySymbol(symbol);
                const on = selected.has(symbol);
                return (
                  <button
                    key={symbol}
                    type="button"
                    onClick={() => toggleSymbol(symbol)}
                    className={`flex items-center gap-xs rounded-full px-md py-sm transition-all ${
                      on
                        ? "border-2 border-primary bg-card"
                        : "border border-white/10 bg-surface hover:border-primary/50"
                    }`}
                  >
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: SYMBOL_COLOR[name] ?? "#4b5563" }}
                    />
                    <span
                      className={`label ${on ? "text-on-surface" : "text-on-surface-variant"}`}
                    >
                      {name}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <SensitivitySlider
          value={draft.sensitivity}
          onChange={(sensitivity) =>
            setDraft((previous) => ({ ...previous, sensitivity }))
          }
          symbolCount={draft.symbols.length}
        />

        {/* 전달 수단 */}
        <section className="space-y-md">
          <span className="label block">알림 방법</span>

          <div className="grid grid-cols-1 gap-md md:grid-cols-2">
            <label className="flex cursor-pointer items-center gap-md rounded-lg border border-white/10 bg-surface p-md transition-all hover:border-primary/50">
              <input
                type="checkbox"
                checked={draft.delivery.includes("browser")}
                onChange={() => toggleDelivery("browser")}
                className="h-5 w-5 accent-primary-container"
              />
              <span className="flex flex-col">
                <span className="text-body">브라우저</span>
                <span className="text-body-sm text-on-surface-variant">
                  탭이 열려 있는 동안 울립니다
                </span>
              </span>
            </label>

            <label
              className={`flex items-center gap-md rounded-lg border border-white/5 bg-surface p-md ${
                signedIn ? "cursor-pointer hover:border-primary/50" : "cursor-not-allowed opacity-40"
              }`}
            >
              <input
                type="checkbox"
                disabled={!signedIn}
                checked={draft.delivery.includes("telegram")}
                onChange={() => toggleDelivery("telegram")}
                className="h-5 w-5 accent-primary-container"
              />
              <span className="flex flex-col">
                <span className="flex items-center gap-xs">
                  <span className="text-body">텔레그램</span>
                  {signedIn ? null : (
                    <span className="label rounded bg-white/10 px-xs py-[1px] text-[10px]">
                      로그인 필요
                    </span>
                  )}
                </span>
                <span className="text-body-sm text-on-surface-variant">
                  자리를 비워도 폰으로 받습니다
                </span>
              </span>
            </label>
          </div>
        </section>

        {showProblems && problems.length > 0 ? (
          <ul className="space-y-1 rounded-lg border border-danger/30 bg-danger/5 p-md text-body-sm text-danger">
            {problems.map((problem) => (
              <li key={problem}>· {CHANNEL_PROBLEM_MESSAGE[problem]}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* 동작 */}
      <div className="flex items-center justify-end gap-md bg-white/5 p-lg">
        <button
          type="button"
          onClick={onCancel}
          className="label px-xl py-md text-on-surface-variant transition-colors hover:text-on-surface"
        >
          취소
        </button>
        <button
          type="button"
          onClick={submit}
          className="rounded-lg bg-primary-container px-xl py-md font-bold text-on-primary-container transition-all hover:shadow-[0_0_20px_rgba(56,189,248,0.4)] active:scale-95"
        >
          {initial === undefined ? "채널 만들기" : "저장"}
        </button>
      </div>
    </div>
  );
}
