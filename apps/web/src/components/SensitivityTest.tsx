"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  MIN_LABELS_FOR_FIT,
  SCALE_TIMEFRAMES,
  displaySymbol,
  fitSensitivity,
} from "@flare-alert/core";
import type { LabeledBar, SensitivityFit, Timeframe } from "@flare-alert/core";

import { formatAlertsPerDay, useT } from "@/lib/i18n";
import { fetchTestCharts } from "@/lib/test-charts";
import type { TestChart } from "@/lib/test-charts";
import { Icon } from "./Icon";
import { VolumeChart } from "./VolumeChart";

/**
 * 민감도 테스트 — 슬라이더 위치를 묻는 대신 보여 주고 찍게 한다.
 *
 * 1~100으로 열어 둔 것은 각자 원하는 자리를 고르라는 뜻이었는데, 처음 온
 * 사람은 자기 자리가 어딘지 모른다. "하루 4.8회"만으로는 그게 자기에게
 * 많은지 적은지 판단할 수 없다.
 *
 * 그래서 실제 과거 거래량 차트를 여러 판 띄우고 "여기서 울렸으면" 싶은
 * 봉을 찍게 한 다음, 그 라벨을 재현하는 자리를 찾아 준다. 3.5배라는
 * 상수를 얻은 절차와 같은 것을, 사용자 각자의 몫으로 돌리는 것이다.
 *
 * 여러 판을 도는 이유는 한 판이 그 시기의 성격에 좌우되기 때문이다.
 * 활발한 시간대만 보면 기준이 높아지고, 죽은 구간만 보면 낮아진다.
 */

const MIN_ROUNDS = 5;
const MAX_ROUNDS = 10;

/** 코인을 아직 고르지 않았을 때 쓸 차트. 가장 거래가 두꺼운 종목이다. */
const FALLBACK_SYMBOL = "BTCUSDT";

type Phase = "pick" | "loading" | "labeling" | "result";

interface Props {
  /** 채널이 감시할 코인. 아직 안 골랐으면 null. */
  symbol: string | null;
  onApply: (level: number) => void;
  onClose: () => void;
}

export function SensitivityTest({ symbol, onApply, onClose }: Props) {
  const t = useT();

  const [phase, setPhase] = useState<Phase>("pick");
  const [timeframe, setTimeframe] = useState<Timeframe | null>(null);
  const [charts, setCharts] = useState<TestChart[]>([]);
  const [round, setRound] = useState(0);
  const [picks, setPicks] = useState<Set<number>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const testSymbol = symbol ?? FALLBACK_SYMBOL;

  useEffect(() => {
    if (timeframe === null) {
      return;
    }

    const controller = new AbortController();
    setPhase("loading");
    setError(null);

    fetchTestCharts(testSymbol, timeframe, MAX_ROUNDS, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) {
          return;
        }
        if (loaded.length < MIN_ROUNDS) {
          setError(t.test.errorTooFew);
          return;
        }
        setCharts(loaded);
        setPicks(loaded.map(() => new Set<number>()));
        setRound(0);
        setPhase("labeling");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => controller.abort();
  }, [timeframe, testSymbol, t.test.errorTooFew]);

  const toggle = useCallback(
    (index: number) => {
      setPicks((previous) =>
        previous.map((set, i) => {
          if (i !== round) {
            return set;
          }
          const next = new Set(set);
          if (next.has(index)) {
            next.delete(index);
          } else {
            next.add(index);
          }
          return next;
        }),
      );
    },
    [round],
  );

  /** 지금까지 끝낸 판을 전부 모아 채점한다. */
  const fit: SensitivityFit | null = useMemo(() => {
    if (timeframe === null || charts.length === 0) {
      return null;
    }

    const labels: LabeledBar[] = [];
    for (let r = 0; r <= round && r < charts.length; r += 1) {
      const chart = charts[r];
      const marked = picks[r];
      if (chart === undefined || marked === undefined) {
        continue;
      }
      for (const [index, bar] of chart.bars.entries()) {
        labels.push({ ratio: bar.ratio, wanted: marked.has(index) });
      }
    }

    return fitSensitivity(labels, timeframe);
  }, [charts, picks, round, timeframe]);

  const totalPicks = picks.reduce((sum, set) => sum + set.size, 0);
  const chart = charts[round];
  const current = picks[round] ?? new Set<number>();

  const canFinish = round + 1 >= MIN_ROUNDS && totalPicks >= MIN_LABELS_FOR_FIT;
  const isLast = round + 1 >= Math.min(charts.length, MAX_ROUNDS);

  function restart(): void {
    setPhase("pick");
    setTimeframe(null);
    setCharts([]);
    setPicks([]);
    setRound(0);
    setError(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-6">
      <div className="panel my-auto w-full max-w-4xl overflow-hidden rounded-xl">
        <header className="flex items-start justify-between gap-4 border-b border-white/5 p-4 sm:p-6">
          <div>
            <h2 className="text-headline sm:text-display">{t.test.title}</h2>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              {t.test.subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.test.close}
            className="shrink-0 rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-white/5 hover:text-on-surface"
          >
            <Icon name="close" size={20} />
          </button>
        </header>

        {error !== null ? (
          <div className="space-y-4 p-4 sm:p-6">
            <div className="rounded-lg border border-danger/30 bg-danger/5 p-4">
              <p className="text-body text-danger">{t.test.errorTitle}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                {t.test.errorHint}
              </p>
              <p className="mt-2 font-mono text-[11px] text-outline">{error}</p>
            </div>
            <button
              type="button"
              onClick={restart}
              className="rounded-lg bg-primary-container px-6 py-3 font-bold text-on-primary-container"
            >
              {t.test.retry}
            </button>
          </div>
        ) : phase === "pick" ? (
          <div className="space-y-6 p-4 sm:p-6">
            <div>
              <h3 className="text-title">{t.test.pickTitle}</h3>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                {t.test.pickHint}
              </p>
            </div>

            <div
              role="radiogroup"
              aria-label={t.test.pickTitle}
              className="flex flex-wrap gap-2"
            >
              {/* 짧은 봉부터 놓는다. 사용자가 차트를 떠올리는 순서다. */}
              {[...SCALE_TIMEFRAMES].reverse().map((frame) => (
                <button
                  key={frame}
                  type="button"
                  role="radio"
                  aria-checked={timeframe === frame}
                  onClick={() => setTimeframe(frame)}
                  className="rounded-lg border border-white/10 bg-surface px-6 py-4 font-mono text-body transition-all hover:border-primary/50"
                >
                  {t.frameScale[frame]}
                </button>
              ))}
            </div>

            <p className="text-[11px] leading-relaxed text-outline">
              {t.test.pickFootnote(displaySymbol(testSymbol))}
            </p>
          </div>
        ) : phase === "loading" ? (
          <div className="flex flex-col items-center gap-4 p-16 sm:p-24">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-outline-variant border-t-primary" />
            <p className="text-body-sm text-on-surface-variant">
              {t.test.loading}
            </p>
          </div>
        ) : phase === "labeling" && chart !== undefined ? (
          <div className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-title">{t.test.instruction}</h3>
                <p className="mt-1 text-body-sm text-on-surface-variant">
                  {t.test.instructionHint}
                </p>
              </div>
              <span className="font-mono text-body-sm text-outline">
                {displaySymbol(chart.symbol)} · {chart.timeframe}
              </span>
            </div>

            {/* 진행 표시. 몇 판을 더 돌아야 하는지 계속 보이게 한다. */}
            <div className="flex items-center gap-2">
              {charts.slice(0, MAX_ROUNDS).map((each, index) => (
                <span
                  key={each.bars[0]?.openTime ?? index}
                  className={`h-1 flex-1 rounded-full ${
                    index < round
                      ? "bg-primary"
                      : index === round
                        ? "bg-primary/50"
                        : "bg-outline-variant/40"
                  }`}
                />
              ))}
            </div>

            <div className="rounded-xl border border-white/5 bg-surface p-2 sm:p-4">
              <VolumeChart
                bars={chart.bars}
                selected={current}
                onToggle={toggle}
                label={t.test.chartLabel}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <span className="text-body-sm text-on-surface-variant">
                {t.test.progress(round + 1, Math.min(charts.length, MAX_ROUNDS))}
                {" · "}
                {t.test.selectedCount(current.size)}
              </span>

              <div className="flex items-center gap-2">
                {canFinish ? (
                  <button
                    type="button"
                    onClick={() => setPhase("result")}
                    className="label rounded-lg border border-primary/40 px-6 py-3 text-primary transition-colors hover:bg-primary/10"
                  >
                    {t.test.finish}
                  </button>
                ) : null}
                {isLast ? (
                  <button
                    type="button"
                    disabled={totalPicks < MIN_LABELS_FOR_FIT}
                    onClick={() => setPhase("result")}
                    className="rounded-lg bg-primary-container px-6 py-3 font-bold text-on-primary-container transition-all active:scale-95 disabled:opacity-40"
                  >
                    {totalPicks < MIN_LABELS_FOR_FIT
                      ? t.test.needMore(MIN_LABELS_FOR_FIT - totalPicks)
                      : t.test.finish}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRound((r) => r + 1)}
                    className="rounded-lg bg-primary-container px-6 py-3 font-bold text-on-primary-container transition-all active:scale-95"
                  >
                    {t.test.next}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : phase === "result" && fit !== null ? (
          <div className="space-y-6 p-4 sm:p-6">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-6">
              <p className="label text-on-surface-variant">
                {t.test.resultTitle}
              </p>
              <p className="mt-2 font-mono text-display text-primary">
                {fit.level}%
              </p>
              <p className="mt-2 text-body">
                {t.slider.catchesScale(t.frameScale[fit.timeframe])}
              </p>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                {t.slider.ratePerCoin(formatAlertsPerDay(t, fit.alertsPerDay))}
              </p>
            </div>

            {/* 채점 결과를 숨기지 않는다. 추천이 얼마나 맞는지 사용자가 본다. */}
            <dl className="grid grid-cols-3 gap-2 sm:gap-4">
              <div className="rounded-lg border border-white/5 bg-surface p-3 sm:p-4">
                <dt className="label text-on-surface-variant">
                  {t.test.scoreCaught}
                </dt>
                <dd className="mt-1 font-mono text-title sm:text-headline">
                  {fit.caught}/{fit.wanted}
                </dd>
              </div>
              <div className="rounded-lg border border-white/5 bg-surface p-3 sm:p-4">
                <dt className="label text-on-surface-variant">
                  {t.test.scoreExtra}
                </dt>
                <dd className="mt-1 font-mono text-title sm:text-headline">
                  {fit.extra}
                </dd>
              </div>
              <div className="rounded-lg border border-white/5 bg-surface p-3 sm:p-4">
                <dt className="label text-on-surface-variant">
                  {t.test.scoreRounds}
                </dt>
                <dd className="mt-1 font-mono text-title sm:text-headline">
                  {round + 1}
                </dd>
              </div>
            </dl>

            {fit.clamped !== null ? (
              <p className="rounded-lg border border-warm/30 bg-warm/5 p-4 text-body-sm text-warm">
                {fit.clamped === "loud"
                  ? t.test.clampedLoud(t.frameScale[fit.timeframe])
                  : t.test.clampedQuiet(t.frameScale[fit.timeframe])}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-4">
              <button
                type="button"
                onClick={restart}
                className="label px-6 py-3 text-on-surface-variant transition-colors hover:text-on-surface"
              >
                {t.test.restart}
              </button>
              <button
                type="button"
                onClick={() => onApply(fit.level)}
                className="rounded-lg bg-primary-container px-12 py-4 font-bold text-on-primary-container transition-all hover:shadow-[0_0_20px_rgba(56,189,248,0.4)] active:scale-95"
              >
                {t.test.apply}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-4 sm:p-6">
            <p className="text-body-sm text-on-surface-variant">
              {t.test.needLabels(MIN_LABELS_FOR_FIT)}
            </p>
            <button
              type="button"
              onClick={restart}
              className="rounded-lg bg-primary-container px-6 py-3 font-bold text-on-primary-container"
            >
              {t.test.restart}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
