# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

_Last updated: 2026-07-27 23:46_

## Project Overview

**Flare Alert** is an adaptive volume-spike alert service for cryptocurrency traders. Users create **channels**; each channel holds a set of coins and one sensitivity value. Unlike traditional alert systems that use fixed multipliers (e.g., "3x average"), thresholds are percentile-based and calibrated per coin, so one sensitivity works across coins of wildly different liquidity within the same channel.

**Core problem solved**: Fixed multipliers rarely fire on quiet coins and constantly on volatile ones, forcing manual per-symbol tuning. Percentile thresholds are derived from each symbol's own score distribution, so a single setting transfers across symbols. This was verified in backtesting (BTC 200.2 / ETH 193.1 / SOL 204.8 alerts per day at the same setting).

**Important correction**: percentiles do *not* make alert frequency predictable. Evaluation runs every second, so "top 5% of seconds" is not "5% of events" — a single event crosses the threshold for hundreds of consecutive seconds. See `docs/algorithm.md` § 백테스트 결과.

## Tech Stack

- **Monorepo**: pnpm workspaces (pnpm 11, Node ≥20)
- **apps/web**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS v4 → Vercel
- **apps/detector**: Node.js (ES modules) + TypeScript → Railway/Fly.io (Tokyo region)
- **apps/backtest**: Offline parameter-tuning tool, never deployed
- **packages/core**: Shared types, constants, and the statistical core

## Directory Structure

```
├── apps/
│   ├── backtest/          # Offline replay harness (not deployed)
│   │   ├── scripts/
│   │   │   ├── fetch-klines.mjs  # Download Binance public dumps
│   │   │   ├── prepare.mjs       # CSV → compact binary
│   │   │   └── lib/zip.mjs       # Minimal ZIP reader (no deps)
│   │   └── src/
│   │       ├── data.ts             # Load/concat prepared series
│   │       ├── replay.ts           # Phase 1: extract threshold crossings
│   │       ├── crossings.ts        # Crossing stream + disk cache
│   │       ├── engine.ts           # Phase 2: sweep settings, single alert per channel
│   │       ├── event-scale.ts      # Measure scale labels and channel rate curve
│   │       └── index.ts            # CLI entry + report
│   ├── detector/          # Real-time detection (continuous process)
│   │   └── src/
│   │       ├── index.ts   # Entry point — pipeline is still TODO
│   │       └── config.ts  # Env var loading and validation
│   └── web/               # Dashboard & settings UI
│       ├── src/app/
│       │   ├── page.tsx            # Landing page (links to /channels/new)
│       │   └── channels/new/       # New channel creation screen
│       └── src/components/
│           └── SensitivitySlider.tsx  # Interactive sensitivity control with frame-standard tick marks
├── packages/
│   └── core/src/
│       ├── types.ts            # Domain types + interfaces (Alert, AlertBuilder)
│       ├── constants.ts        # Confirmed & pending-backtest parameters (FRAME_SCALE_PERCENTILE, CHANNEL_RATE_CURVE)
│       ├── math.ts             # median, MAD, quantile, percentile rank
│       ├── score.ts            # Baseline (median/MAD) + anomaly score S
│       ├── percentile.ts       # Histogram percentile estimator (Fenwick tree)
│       ├── cooldown.ts         # Time-decay cooldown
│       ├── sensitivity.ts      # Slider ↔ percentile conversion, single channel rate curve
│       └── sensitivity.test.ts # Tests for slider/percentile round-trip and scale labels
├── docs/                  # Korean planning docs (algorithm/architecture/
│                          #   research/decisions)
└── data/                  # Backtest data — gitignored, ~1.2GB
```

## Key Concepts

### Detection Pipeline

```
Binance aggTrade WS → 1-second buckets → Per-frame rolling windows
  → Median/MAD baseline + anomaly score S → Percentile conversion
  → Sensitivity threshold → Filters (min turnover, warmup, cooldown)
  → Identify scale (largest frame triggering) → Single alert per channel → Telegram dispatch
```

The statistical middle (score, percentile, cooldown) is **implemented and tested** in `packages/core`. Ingestion (WebSocket, 1-second buckets), the turnover/warmup filters, scale detection, and dispatch are **not implemented** — `apps/detector/src/index.ts` is still a skeleton.

**Alert model** (2026-07-27): Alerts are **per channel**, not per frame. All six frames feed into a single percentile decision (maximum across frames). If it clears the threshold, one alert fires per channel. The scale (largest frame to trigger) is attached to the alert as metadata for labeling ("1-hour-class spike"), not as a dispatch mechanism.

### Timeframes

Six timeframes evaluated in lockstep: `1m`, `5m`, `15m`, `1h`, `4h`, `1d`. Windows are aligned to absolute epoch boundaries so `1d` opens at UTC midnight. Candle close is never awaited — a 4h window that spikes 6 minutes in is judged on 6 minutes of velocity.

### Channel Model

A `Channel` = coins + one sensitivity + delivery methods. Users have many; the same coin may appear in several channels with different sensitivities.

**Critical split**: score S and percentile are *independent of channels* — they are properties of a symbol/timeframe, not of user settings. Cooldown and scale detection are *per channel* (one channel firing must not silence another watching the same coin). So the detector computes the expensive part once per symbol and applies each channel's threshold to the result. State keys are `ChannelSeriesKey`, not `SeriesKey`.

**Alert output**: One alert per channel per symbol per event. The alert object contains:
- `channelId` — which channel detected it
- `scale` — the largest timeframe to trigger (1m–1d), used for display ("1시간봉급 급등")
- `percentile`, `score`, `quoteVolume`, `ratioToMedian` — debugging and display

No `strength` field; the alert happens or it doesn't. Frame counts are not aggregated into a "strength" metric.

`apps/backtest` already has this shape (extract crossings once → sweep configs cheaply).

### Sensitivity Model

**One alert per channel.** Timeframes are NOT an evaluation axis — the only firing criterion is sensitivity. Frames appear solely as reference tick marks on the slider, meaning "at this position, spikes big enough to be visible on that chart start alerting."

`FRAME_SCALE_PERCENTILE` places those marks: 1m at slider 56 (rightmost), 1d at 22 (leftmost). Short bursts only disturb the 1m window → weak signal → need high sensitivity. Large sustained moves disturb every window → strong signal → caught even at low sensitivity.

**A previous version had these markers reversed**, defined as "threshold where frame X alone fires ~1/day". That computes correctly but answers the wrong question. Don't reintroduce it.

An `Alert` carries `scale` (the longest anomalous timeframe) as a descriptive label — "1시간봉급 급등". It describes an alert; it never creates one.

- Meaning: "alert on the top (100 − sensitivity)% of observations"
- **Not an integer.** The useful range is compressed into 99–100, so the UI must handle decimals. Default is `99.887` (15-minute-scale rate, ≈3–4 alerts/day per coin in a channel).
- `SENSITIVITY_MIN` 90, `SENSITIVITY_MAX` 99.99

**Slider conversion** (`packages/core/src/sensitivity.ts`):
- UI displays integer positions 1–100, where rightward motion increases alert frequency
- Internal representation remains percentile; conversion happens only in this module
- Logarithmic axis: tail fraction ranges 0.01%–10% across three orders of magnitude, so linear division would collapse one end
- Default 99.887 maps to slider position 36 (same as 15-minute scale)
- **Alert frequency display** — the UI shows estimated alerts per day using:
  - `estimateAlertsPerDay(sliderPosition)` — interpolates `CHANNEL_RATE_CURVE` to estimate alerts/day per coin
  - Alerts are **per channel**, not split by frame; the curve represents a single channel watching one coin
- **Scale labels** — above the slider at each marker position, showing which event size (1m–1d) that sensitivity would "naturally" catch if isolated:
  - "1분봉급" (right side, high sensitivity): very short spikes need high thresholds to avoid false alarms
  - "1일봉급" (left side, low sensitivity): large, long-lasting events have strong signals and trip at low thresholds
- Exports: `sliderToPercentile()`, `percentileToSlider()`, `estimateAlertsPerDay()`, `SLIDER_MIN`, `SLIDER_MAX`

### Delivery

Per channel, any combination of `browser` and `telegram`.

Browser notifications use the in-page Notification API and only work **while a tab is open** — no service worker, no Web Push. Telegram covers the away-from-desk case. Because a closed tab is normal, `Notifier.send` returns `boolean` rather than throwing: a failed browser delivery is expected, a failed Telegram delivery is a fault.

### Score Semantics

`computeScore` returns `number | null`. `null` means MAD is 0 — the symbol traded at a constant (usually zero) rate across the whole lookback, so no meaningful score exists. Callers must not coerce this to a large number; dead altcoins would otherwise dominate the top of every alert list. This is common: 1m frames on ANKR/ONE return null 65–74% of the time.

## Parameters

Confirmed by the first backtest (2026-07-27):

| Constant | Value | Note |
|---|---|---|
| `SENSITIVITY_DEFAULT` | 99.887 | Aligned to 15-minute scale; maps to slider position 36 |
| `FRAME_SCALE_PERCENTILE` | per-frame constants | Percentile at which that event size would "naturally" reach ~1 alert/day if isolated |
| `CHANNEL_RATE_CURVE` | single array | Alert frequency (per coin, per channel) at each slider position |

**Event Scale Labeling & Alert Frequency** (`packages/core/src/constants.ts`):

The backtest revealed that event size (1m spike vs. 1d spike) and event strength are independent. A sensitivity set for large events (low percentile) will catch all the small events too. So instead of per-frame alert budgets, the UI labels each slider position with the *smallest event size* it would typically catch in isolation.

Backtest measured two things:

1. **Frame Scale Percentile** (`FRAME_SCALE_PERCENTILE`) — the percentile at which each timeframe, isolated, crosses its own baseline at ~1 alert/day:

| Frame | Percentile | Slider Position | Meaning |
|---|---|---|---|
| 1m | 99.541 | ~8 | Very aggressive; catches minute-scale volatility |
| 5m | 99.807 | ~24 | Aggressive; 5-minute impulses |
| 15m | 99.887 | ~36 | Moderate; default setting |
| 1h | 99.938 | ~52 | Relaxed; hour-scale moves |
| 4h | 99.952 | ~62 | Very relaxed; 4-hour trends |
| 1d | 99.957 | ~66 | Daily close moves only |

These serve as UI tick marks. Users see "1분봉급 / 5분봉급 / 15분봉급 / 1시간봉급 / 4시간봉급 / 1일봉급" at these positions, indicating event size, not dictating frame-specific behavior.

2. **Channel Rate Curve** (`CHANNEL_RATE_CURVE`) — alert frequency per coin at each slider position (5–100 in 5-step increments). Single curve because alerts are per-channel, not per-frame. Measured on 6 symbols (BTC, ETH, SOL, ANKR, ONE, SHIB) from 2026-04-01 to 2026-06-30. Used by the web UI to show estimated alert rate at the current slider position.

The curve values are interpolated linearly by `estimateAlertsPerDay(sliderPosition)` when rendering the slider preview.

Labels merge if tick positions differ by ≤4. The file `apps/backtest/src/event-scale.ts` (replacing `frame-standards.ts`) measures both the scale markers and the channel rate curve.

Still carrying `TODO(backtest)` in `constants.ts`: `LOOKBACK_WINDOW_COUNT`, `MIN_ELAPSED_SECONDS`, `MIN_QUOTE_VOLUME`, `COOLDOWN_DECAY_CURVE`, `COOLDOWN_TAIL_TIGHTENING`, `PERCENTILE_HISTORY_DAYS`, `MIN_PERCENTILE_SAMPLES`, `MAD_FLOOR_RATIO`.

`MIN_QUOTE_VOLUME` is the most urgent — it single-handedly determines small-cap behavior (2M rejections on ANKR/ONE vs 19 on BTC) and was set without evidence.

## Common Development Commands

```bash
pnpm install
cp .env.example .env        # then fill TELEGRAM_BOT_TOKEN

pnpm dev:web                # builds core, then next dev on :3000
pnpm dev:detector           # builds core, then runs detector

pnpm test                   # 53 tests in packages/core
pnpm typecheck              # all 4 workspaces
pnpm build                  # topological build
pnpm clean
```

### Backtesting

```bash
pnpm --filter @flare-alert/backtest fetch         # ~670MB of Binance dumps
pnpm --filter @flare-alert/backtest prepare:data  # → 360MB binary
pnpm --filter @flare-alert/backtest build
pnpm --filter @flare-alert/backtest start         # extract + sweep
```

Crossing extraction takes ~1 minute per symbol and is cached to `data/crossings/`. Subsequent runs sweep parameters in seconds. Bump `MAGIC` in `crossings.ts` if the cache format changes.

### Notes

- `packages/core` is consumed via its built `dist/`, not source. Rebuild it after changing exports.
- Tests are colocated as `*.test.ts` and run from `dist/` via `node --test "dist/**/*.test.js"`. Passing a bare directory to `node --test` does not discover them.
- The `pnpm` PowerShell wrapper writes a NativeCommandError banner to stderr on Windows even when commands succeed. Judge by exit code, not that output.

## Architecture Decisions

See `docs/decisions.md` (Korean) for full rationale. Twelve decisions recorded, including:

1. Median/MAD instead of mean/stddev — a single spike drags a mean-based baseline up and mutes alerts for hours
2. Percentile instead of multiplier — cross-symbol portability (frequency predictability was retracted after backtesting)
3. aggTrade + 1s buckets instead of klines — kline streams delay detection by up to 60s
4. Time-decay cooldown instead of "must exceed last alert" — the latter never resets after a big spike
5. Channel-based sensitivity instead of per-symbol or account-wide — allows targeting different use cases (quiet majors vs aggressive altcoin hunting) without manual per-symbol tuning
6. Single alert per channel (2026-07-27 update) — rather than merging alerts across multiple frames, take the maximum percentile across all six frames in parallel. If it exceeds the threshold, one alert fires. The scale (largest triggering frame) is attached for display, not used for dispatch logic.
7. Cooldown multiplies the allowed tail fraction rather than adding to the percentile — adding overflows the 100 ceiling at high sensitivity and becomes a total mute
8. Frame scale labels instead of per-frame alert rates — the UI shows which event size "naturally" catches at each slider position (determined by isolated binary search), but all frames feed into one alert decision
9. Fixed-bin histogram on an asinh axis with a Fenwick tree, not full sample retention
10. Channel model with **channel-scoped** cooldown/scale detection but **symbol-scoped** score/percentile — expensive computation per symbol, threshold application per channel
11. Browser notifications (Notification API while tab is open) + Telegram simultaneously per channel — covers both idle and away-from-desk cases
12. Frames are reference labels on the sensitivity slider, not an evaluation axis — judgment uses only the maximum percentile across all six frames; scale (the largest triggering frame) is attached for display only

## Environment Variables

From `.env.example`:

- `TELEGRAM_BOT_TOKEN` — required; detector refuses to boot without it
- `BINANCE_WS_URL` — defaults to `wss://stream.binance.com:9443/ws`
- `PORT` — health-check HTTP port (default 8080)
- `LOG_LEVEL` — `debug` | `info` | `warn` | `error`
- `NEXT_PUBLIC_APP_URL` — web only, browser-exposed

There is no database or Binance API key yet; storage is undecided.

## Testing

`packages/core` has 53 tests (`node:test`, no framework dependency) covering math primitives, baseline/score edge cases, percentile accuracy against exact sorted ranks, day-based sample eviction, and cooldown behavior.

Not yet covered: the detector pipeline (unimplemented), frame merging (lives in backtest), and the web app.

## Known Gaps & Next Steps

1. **Alert quality is unmeasured.** The backtest only counted how often alerts fire, never whether price actually moved afterward. Price data is already in the same dumps.
2. **`MIN_QUOTE_VOLUME` has no evidential basis** yet dominates small-cap results.
3. **Detector pipeline** — WebSocket, 1s aggregation, filter chain, Telegram dispatch.
4. **Storage schema** — user config, alert history, percentile distribution persistence.
5. **Web UI — Channel creation** (`/channels/new`):
   - `SensitivitySlider` ✅ complete — shows frame-scale reference marks + real-time estimated alerts/day
   - TODO: coin selection, delivery method (browser/Telegram), save
6. **Backtest tools**:
   - ✅ `apps/backtest/src/event-scale.ts`: Measures event-scale percentiles and channel rate curve (replaces `frame-standards.ts`)
   - ✅ `FRAME_SCALE_PERCENTILE` and `CHANNEL_RATE_CURVE` published in constants
