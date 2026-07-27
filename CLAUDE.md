# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

_Last updated: 2026-07-27 22:40_

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
│   │       ├── engine.ts           # Phase 2: cooldown/merge parameter sweep (with frame isolation)
│   │       ├── frame-standards.ts  # Binary search for per-frame alert calibration
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
│       ├── types.ts            # Domain types + interfaces
│       ├── constants.ts        # Confirmed & pending-backtest parameters (includes FRAME_STANDARD_PERCENTILE)
│       ├── math.ts             # median, MAD, quantile, percentile rank
│       ├── score.ts            # Baseline (median/MAD) + score S
│       ├── percentile.ts       # Histogram percentile estimator (Fenwick tree)
│       ├── cooldown.ts         # Time-decay cooldown
│       ├── sensitivity.ts      # Slider ↔ percentile conversion (log-axis, 1–100 ↔ 90–99.99)
│       └── sensitivity.test.ts # Tests for slider/percentile round-trip and frame standards
├── docs/                  # Korean planning docs (algorithm/architecture/
│                          #   research/decisions)
└── data/                  # Backtest data — gitignored, ~1.2GB
```

## Key Concepts

### Detection Pipeline

```
Binance aggTrade WS → 1-second buckets → Per-frame rolling windows
  → Median/MAD baseline + anomaly score S → Percentile conversion
  → Sensitivity threshold → Filters (min turnover, warmup, cooldown, frame merge)
  → Telegram dispatch
```

The statistical middle (score, percentile, cooldown) is **implemented and tested** in `packages/core`. Ingestion (WebSocket, 1-second buckets), the turnover/warmup filters, frame merging, and dispatch are **not implemented** — `apps/detector/src/index.ts` is still a skeleton.

Note: frame merging exists only inside `apps/backtest/src/engine.ts`. It must be promoted to `packages/core` when the detector is built.

### Timeframes

Six timeframes evaluated in lockstep: `1m`, `5m`, `15m`, `1h`, `4h`, `1d`. Windows are aligned to absolute epoch boundaries so `1d` opens at UTC midnight. Candle close is never awaited — a 4h window that spikes 6 minutes in is judged on 6 minutes of velocity.

### Channel Model

A `Channel` = coins + one sensitivity + timeframes + delivery methods. Users have many; the same coin may appear in several channels with different sensitivities.

**Critical split**: score S and percentile are *independent of channels* — they are properties of a symbol/timeframe, not of user settings. Cooldown and frame merging are *per channel* (one channel firing must not silence another watching the same coin). So the detector computes the expensive part once per symbol and applies each channel's threshold to the result. State keys are `ChannelSeriesKey`, not `SeriesKey`.

`apps/backtest` already has this shape (extract crossings once → sweep configs cheaply).

### Sensitivity Model

- Meaning: "alert on the top (100 − sensitivity)% of observations"
- **Not an integer.** The useful range is compressed into 99–100, so the UI must handle decimals. Default is `99.9` (≈4–6 alerts/day on majors).
- `SENSITIVITY_MIN` 90, `SENSITIVITY_MAX` 99.99

**Slider conversion** (`packages/core/src/sensitivity.ts`):
- UI displays integer positions 1–100, where rightward motion increases alert frequency
- Internal representation remains percentile; conversion happens only in this module
- Logarithmic axis: tail fraction ranges 0.01%–10% across three orders of magnitude, so linear division would collapse one end
- Default 99.9 maps to slider position 34
- Exports: `sliderToPercentile()`, `percentileToSlider()`, `formatTail()`, `SLIDER_MIN`, `SLIDER_MAX`

### Delivery

Per channel, any combination of `browser` and `telegram`.

Browser notifications use the in-page Notification API and only work **while a tab is open** — no service worker, no Web Push. Telegram covers the away-from-desk case. Because a closed tab is normal, `Notifier.send` returns `boolean` rather than throwing: a failed browser delivery is expected, a failed Telegram delivery is a fault.

### Score Semantics

`computeScore` returns `number | null`. `null` means MAD is 0 — the symbol traded at a constant (usually zero) rate across the whole lookback, so no meaningful score exists. Callers must not coerce this to a large number; dead altcoins would otherwise dominate the top of every alert list. This is common: 1m frames on ANKR/ONE return null 65–74% of the time.

## Parameters

Confirmed by the first backtest (2026-07-27):

| Constant | Value | Note |
|---|---|---|
| `FRAME_MERGE_WINDOW_SECONDS` | 900 | The only effective frequency lever (60s→1800s changes alert count 5–9x) |
| `COOLDOWN_DURATION_SECONDS` | 3x initial guess | Weak lever — 1x→10x moves alert count only ~10% |
| `SENSITIVITY_DEFAULT` | 99.9 | Maps to slider position 34 |
| `FRAME_STANDARD_PERCENTILE` | per-frame constants | "One-frame-only" alert rate = 1/day, measured via binary search on isolated frames |

**Frame Standards** (`packages/core/src/constants.ts`):
Frame alert frequencies diverge dramatically at the same sensitivity. A single sensitivity cannot satisfy all frames simultaneously — 1-minute candles fire ~30x more often than 1-day candles. To guide users, backtest measured the percentile threshold that yields ~1 alert/day per symbol when *only that frame is active*:

| Frame | Percentile | Slider Position | 
|---|---|---|
| 1m | 99.96 | 21 |
| 5m | 99.88 | 37 |
| 15m | 99.71 | 49 |
| 1h | 98.89 | 68 |
| 4h | 98.14 | 76 |
| 1d | 98.02 | 77 |

These are reference marks only; enabling multiple frames simultaneously will not produce 1 alert/day on each. Used by the web UI (`SensitivitySlider`) to display frame-specific tick marks; labels merge if positions differ by ≤2.

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

See `docs/decisions.md` (Korean) for full rationale. Eleven decisions recorded, including:

1. Median/MAD instead of mean/stddev — a single spike drags a mean-based baseline up and mutes alerts for hours
2. Percentile instead of multiplier — cross-symbol portability (frequency predictability was retracted after backtesting)
3. aggTrade + 1s buckets instead of klines — kline streams delay detection by up to 60s
4. Time-decay cooldown instead of "must exceed last alert" — the latter never resets after a big spike
5. Channel-based sensitivity instead of per-symbol or account-wide — allows targeting different use cases (quiet majors vs aggressive altcoin hunting) without manual per-symbol tuning
7. Cooldown multiplies the allowed tail fraction rather than adding to the percentile — adding overflows the 100 ceiling at high sensitivity and becomes a total mute
8. Frame merge absorbs into an already-sent alert rather than delaying dispatch — delaying would negate the reason for using aggTrade
9. Fixed-bin histogram on an asinh axis with a Fenwick tree, not full sample retention
10. Channel model with **channel-scoped** cooldown/merge but **symbol-scoped** score/percentile — expensive computation per symbol, threshold application per channel
11. Browser notifications (Notification API while tab is open) + Telegram simultaneously per channel — covers both idle and away-from-desk cases

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
4. **Frame merging is not in core** — currently only in the backtest engine (`apps/backtest/src/engine.ts`).
5. **Storage schema** — user config, alert history, percentile distribution persistence.
6. **Web UI — Channel creation** (`/channels/new`):
   - Skeleton in place with `SensitivitySlider` component showing frame standards as visual tick marks
   - TODO: coin selection, frame selection, delivery method (browser/Telegram), save
7. **Backtest tools**:
   - `apps/backtest/src/frame-standards.ts`: Binary search to measure frame-specific alert rates, feeding `FRAME_STANDARD_PERCENTILE`
   - `engine.ts` extended with `onlyFrame` parameter to isolate individual frames during measurement
8. **Frame imbalance** — 1m produces ~80% of large-cap alerts while 1d produces ~50% of small-cap alerts. Whether frames need separate alert budgets is undecided.
9. **Multi-frame calibration** — supporting per-frame overrides (TimeframeOverrides) so users can dial in each frame independently despite frame-to-frame frequency disparity.
