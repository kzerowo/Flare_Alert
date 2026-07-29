"use client";

import { useMemo, useState } from "react";

import {
  MAX_CHANNEL_NAME_LENGTH,
  POPULAR_BINANCE_SYMBOLS,
  createChannel,
  displaySymbol,
  toBinanceSymbol,
  validateChannel,
} from "@flare-alert/core";
import type { Channel, DeliveryMethod } from "@flare-alert/core";

import { formatProblem, useT } from "@/lib/i18n";
import { CoinIcon } from "./CoinIcon";
import { Icon } from "./Icon";
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
  const t = useT();

  // 기본 이름은 core가 모른다. 언어를 아는 여기서 넣는다.
  // 초기값 계산은 첫 렌더에만 돌아서, 도중에 언어를 바꿔도 이미 입력한
  // 이름을 덮어쓰지 않는다.
  const [draft, setDraft] = useState<Channel>(
    () => initial ?? createChannel({ name: t.form.defaultName }),
  );
  const [query, setQuery] = useState("");
  const [showProblems, setShowProblems] = useState(false);

  const selected = draft.symbol?.symbol ?? null;

  const matches = useMemo(() => {
    const needle = query.trim().toUpperCase();
    if (needle.length === 0) {
      return POPULAR_BINANCE_SYMBOLS;
    }
    return POPULAR_BINANCE_SYMBOLS.filter((s) => s.includes(needle));
  }, [query]);

  const problems = validateChannel(draft);

  /**
   * 채널당 하나만 감시한다. 이미 고른 것을 다시 누르면 해제가 아니라
   * 그대로 둔다 — 저장할 수 없는 빈 상태로 되돌리는 조작을 굳이 만들
   * 이유가 없고, 다른 코인을 누르면 어차피 바뀐다.
   */
  function pickSymbol(symbol: string): void {
    setDraft((previous) => ({ ...previous, symbol: toBinanceSymbol(symbol) }));
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
      <div className="border-b border-white/5 p-6">
        <h2 className="text-display">
          {initial === undefined ? t.form.createTitle : t.form.editTitle}
        </h2>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          {t.form.subtitle}
        </p>
      </div>

      <div className="space-y-12 p-6">
        {/* 이름 */}
        <section className="space-y-2">
          <label htmlFor="channel-name" className="label block text-on-surface-variant">
            {t.form.nameLabel}
          </label>
          <input
            id="channel-name"
            type="text"
            value={draft.name}
            maxLength={MAX_CHANNEL_NAME_LENGTH}
            onChange={(event) =>
              setDraft((previous) => ({ ...previous, name: event.target.value }))
            }
            placeholder={t.form.namePlaceholder}
            className="w-full rounded-lg border border-white/10 bg-surface px-4 py-4 text-body transition-all placeholder:text-outline-variant focus:border-primary focus:outline-none"
          />
        </section>

        {/* 코인 */}
        <section className="space-y-4">
          <div className="flex items-end justify-between">
            <span className="label text-on-surface-variant">
              {t.form.symbolsLabel}
            </span>
            <span className="text-body-sm text-outline">
              {t.form.symbolPickHint}
            </span>
          </div>

          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">
              <Icon name="search" size={18} />
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.form.searchPlaceholder}
              className="w-full rounded-lg border border-white/10 bg-surface py-4 pl-12 pr-4 text-body transition-all placeholder:text-outline-variant focus:border-primary focus:outline-none"
            />
          </div>

          {/*
            라디오 그룹으로 알린다. 생김새는 버튼이지만 "여럿 중 하나"라는
            성질은 스크린 리더에도 전해져야 한다.
          */}
          <div
            role="radiogroup"
            aria-label={t.form.symbolsLabel}
            className="flex max-h-56 flex-wrap gap-2 overflow-y-auto"
          >
            {matches.length === 0 ? (
              <p className="text-body-sm text-outline">{t.form.noMatches}</p>
            ) : (
              matches.map((symbol) => {
                const on = selected === symbol;
                return (
                  <button
                    key={symbol}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => pickSymbol(symbol)}
                    className={`flex items-center gap-1 rounded-full px-4 py-2 transition-all ${
                      on
                        ? "border-2 border-primary bg-card"
                        : "border border-white/10 bg-surface hover:border-primary/50"
                    }`}
                  >
                    <CoinIcon symbol={symbol} size={16} />
                    <span
                      className={`label ${on ? "text-on-surface" : "text-on-surface-variant"}`}
                    >
                      {displaySymbol(symbol)}
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
        />

        {/* 전달 수단 */}
        <section className="space-y-4">
          <span className="label block text-on-surface-variant">
            {t.form.deliveryLabel}
          </span>

          <label className="flex cursor-pointer items-center gap-4 rounded-lg border border-white/10 bg-surface p-4 transition-all hover:border-primary/50">
            <input
              type="checkbox"
              checked={draft.delivery.includes("browser")}
              onChange={() => toggleDelivery("browser")}
              className="h-5 w-5 accent-primary-container"
            />
            <span className="flex flex-col">
              <span className="text-body">{t.form.browser}</span>
              <span className="text-body-sm text-on-surface-variant">
                {t.form.browserHint}
              </span>
            </span>
          </label>
        </section>

        {showProblems && problems.length > 0 ? (
          <ul className="space-y-1 rounded-lg border border-danger/30 bg-danger/5 p-4 text-body-sm text-danger">
            {problems.map((problem) => (
              <li key={problem}>
                ·{" "}
                {formatProblem(t, problem, {
                  maxNameLength: MAX_CHANNEL_NAME_LENGTH,
                })}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* 동작 */}
      <div className="flex items-center justify-end gap-4 bg-white/5 p-6">
        <button
          type="button"
          onClick={onCancel}
          className="label px-12 py-4 text-on-surface-variant transition-colors hover:text-on-surface"
        >
          {t.form.cancel}
        </button>
        <button
          type="button"
          onClick={submit}
          className="rounded-lg bg-primary-container px-12 py-4 font-bold text-on-primary-container transition-all hover:shadow-[0_0_20px_rgba(56,189,248,0.4)] active:scale-95"
        >
          {initial === undefined ? t.form.createTitle : t.form.save}
        </button>
      </div>
    </div>
  );
}
