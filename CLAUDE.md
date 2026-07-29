# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

_Last updated: 2026-07-29 18:13_

## Project Overview

**Flare Alert** is an adaptive volume-spike alert service for cryptocurrency traders. Users create **channels**; each channel watches one coin at one sensitivity level. Unlike traditional alert systems that use fixed multipliers (e.g., "3x average"), thresholds are percentile-based and calibrated per coin, so the same sensitivity setting translates cleanly across coins of wildly different liquidity. Users create multiple channels to watch different coins or the same coin at different sensitivities.

**Core problem solved**: Fixed multipliers rarely fire on quiet coins and constantly on volatile ones, forcing manual per-symbol tuning. Percentile thresholds are derived from each symbol's own score distribution, so a single setting transfers across symbols. This was verified in backtesting (BTC 200.2 / ETH 193.1 / SOL 204.8 alerts per day at the same setting).

**Important correction**: percentiles do *not* make alert frequency predictable. Evaluation runs every second, so "top 5% of seconds" is not "5% of events" — a single event crosses the threshold for hundreds of consecutive seconds. See `docs/algorithm.md` § 백테스트 결과.

## Tech Stack

- **Monorepo**: pnpm workspaces (pnpm 11, Node ≥20)
- **apps/web**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS v4 → Vercel
- **apps/detector**: Node.js (ES modules) + TypeScript → Railway/Fly.io (Tokyo region)
- **apps/backtest**: Offline parameter-tuning tool, never deployed
- **packages/core**: Shared types, constants, and the statistical core

## Design System (2026-07-29)

**Design tokens** (`apps/web/src/app/globals.css` @theme):
- **Colors** (Material 3 semantics): 6-layer backgrounds (sunken → surface → surface-low → card → surface-high → surface-highest); primary (#8ed5ff) for text/icons on dark backgrounds; primary-container (#38bdf8) for filled button backgrounds; state colors (danger, warm); outline shades for borders and dividers
  - **Button text on primary-container**: Raised contrast from #004965 (4.6:1) to #002030 (7.8:1) to meet legibility needs for 12px uppercase labels (2026-07-29)
- **Spacing**: 5 scales (4px, 8px, 16px, 24px, 48px) in multiples of 4; **no named --spacing-* tokens** — conflicts with Tailwind v4's `max-w-*`, `w-*`, `h-*` resolution order. Use numeric scale directly: `xs=1`, `sm=2`, `md=4`, `lg=6`, `xl=12` (Tailwind default units).
- **Typography**: 7 text styles (display, headline, title, body, body-sm, data, label) with paired line-height and letter-spacing
- **Corners**: lg 0.5rem, xl 0.75rem
- **Fonts**: Inter (variable) via `next/font` for UI text; JetBrains Mono (variable) for numerics (sensitivity, alert counts) to prevent layout shift when values change

**Label styling** (`.label` CSS component, 2026-07-29 refactor):
- Moved from global scope into `@layer components` to respect Tailwind v4 layer ordering (components layer > utilities layer)
- No longer defines color — allows `text-*` utility classes to apply when needed (previously conflicted)
- Used on 14+ label elements throughout UI with explicit `text-on-surface-variant` where gray is expected
  - `AuthDialog` (2 form labels)
  - `ChannelCard` (5 section headers)
  - `ChannelForm` (4 labels)
  - `SensitivitySlider` (3 labels)

**Icons** (`apps/web/src/components/Icon.tsx`):
- 14 inline SVG icons (plus, edit, trash, close, search, info, activity, chart, globe, send, mail, lock, arrow-right, bell)
- No external font dependency; avoids loading delay and "more_vert" text flashing before font loads
- Colors and weight follow `currentColor`

**Cursor** (`globals.css` `@layer base`, 2026-07-29): browsers default `button` to `cursor: default`, so hover felt dead. One base-layer rule gives `pointer` to enabled buttons/`[role=button]`/`summary`/checkbox labels and `not-allowed` to disabled ones. It sits in `@layer base` so per-element `cursor-*` utilities still win.

## Localization (2026-07-29)

Korean and English. `packages/core` is language-neutral — it returns numbers and discriminated unions, never sentences.

- **`apps/web/src/lib/locale.ts`** — `Locale`, `LOCALES`, `LOCALE_COOKIE`, `parseLocale`, `LOCALE_NAME`, `LOCALE_TAG`. **No `"use client"`.** Kept separate from the dictionary because `i18n.tsx` is a client module, and every export of a client module is unusable from a server component. `layout.tsx` reads the cookie on the server and needs `parseLocale` there.
- **`apps/web/src/lib/i18n.tsx`** — dictionaries + `LocaleProvider` + `useT()`. `ko` is the source of truth; `en` is typed as `typeof ko`, so a phrase added only to Korean fails the build. Values that interpolate are functions, not templates — English pluralizes and Korean does not.
- Components read `const t = useT()` and access fields directly (`t.form.cancel`). No string-key lookup, so typos are compile errors.
- **Locale lives in a cookie**, not `localStorage`. The server must see it or the first paint renders Korean and then flips. `layout.tsx` and `generateMetadata()` both read it, which makes `/` a dynamic route — fine, the page is fully interactive anyway.

Language-dependent formatting that used to live in core:
- `describeAlertRate(perDay)` (core) returns `{kind: "never" | "everyNDays" | "perDay", ...}`; `formatAlertsPerDay(t, perDay)` (web) turns it into words. The thresholds (0.15 / 0.67 / 10) are language-independent logic and stay tested in core.
- `validateChannel()` (core) returns `ChannelProblem[]`; `formatProblem(t, problem, limits)` (web) renders it. The detector will need these same problems in the *recipient's* language for Telegram, so core must not pick one.
- `createChannel()` no longer defaults `name` to `"새 채널"` — it returns `""` and the form supplies `t.form.defaultName`.

## Directory Structure

## Coin Selection (2026-07-29)

`POPULAR_BINANCE_SYMBOLS` in `packages/core/src/channel.ts` lists exactly 13 symbols in descending market-cap order:

```
BTC, ETH, BNB, XRP, SOL, TRX, DOGE, XLM, ZEC, WBTC, WBETH, LINK, ADA
```

**All are actively traded** on Binance USDT (status TRADING) as of 2026-07-29. (XMR was delisted; HYPE, BREAK, etc. are not listed.) **Coin icons** live in `apps/web/public/coins/` as lowercase SVG files (e.g., `btc.svg`); missing icons fall back to a color dot.

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
│   │       ├── index.ts            # Service: boot, 1s clock, alert output, /health
│   │       ├── config.ts           # Env var loading and validation
│   │       ├── binance.ts          # REST (klines) + WS (aggTrade, auto-reconnect)
│   │       ├── aggregator.ts       # 1-second buckets → rolling windows
│   │       ├── detect.ts           # Baseline → score S → percentile → filters
│   │       ├── channel-runtime.ts  # Per-channel threshold, cooldown, merge, scale
│   │       ├── backfill.ts         # Cold-start priming from historical klines
│   │       ├── verify.ts           # Replay recent days through the live pipeline
│   │       └── aggregator.test.ts  # 11 tests incl. minute/second equivalence
│   └── web/               # Dashboard & settings UI
│       ├── src/app/
│       │   ├── layout.tsx          # Reads locale cookie on the server, wraps LocaleProvider
│       │   └── page.tsx            # AuthProvider > ChannelStoreProvider > MainApp
│       ├── src/middleware.ts       # Supabase session refresh (only place cookies can be written)
│       ├── public/coins/
│       │   └── *.svg                      # Coin icons for top 13 Binance symbols (btc, eth, bnb, xrp, sol, trx, doge, xlm, zec, wbtc, wbeth, link, ada)
│       ├── src/components/
│       │   ├── MainApp.tsx                # App root: nav, hero, channel grid, error banner
│       │   ├── ChannelCard.tsx            # Display channel with edit/delete/toggle actions (now shows single coin in header)
│       │   ├── ChannelForm.tsx            # Create/edit channel UI with coin selection + sensitivity slider (single-coin radio group)
│       │   ├── CoinIcon.tsx               # Coin symbol → SVG icon or fallback color dot (2026-07-29)
│       │   ├── AuthDialog.tsx             # Login/signup against Supabase Auth
│       │   ├── SensitivitySlider.tsx      # Interactive sensitivity control with frame-standard tick marks
│       │   ├── LanguageToggle.tsx         # ko/en segmented control
│       │   └── Icon.tsx                   # Inline SVG icons (14 icons, no external font dependency)
│       └── src/lib/
│           ├── locale.ts                  # Locale primitives — NO "use client" (server reads these)
│           ├── i18n.tsx                   # Dictionaries + LocaleProvider + useT()
│           ├── auth.tsx                   # AuthProvider over Supabase Auth
│           ├── channel-store.tsx          # Guest (sessionStorage) / member (Supabase) dual mode
│           └── supabase/
│               ├── config.ts              # Env vars; isSupabaseConfigured()
│               ├── client.ts              # Cached browser client (null when unconfigured)
│               ├── server.ts              # Server-component client (read-only cookies)
│               ├── types.ts               # Database types — `type`, not `interface` (see below)
│               └── channels.ts            # Channel read/write against Supabase
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
├── supabase/
│   └── migrations/
│       └── 0001_init.sql  # profiles / channels / channel_symbols + RLS
├── docs/                  # Korean planning docs (algorithm/architecture/
│                          #   research/decisions/deploy)
├── data/                  # Backtest data — gitignored, ~1.2GB
└── apps/web/vercel.json   # Vercel build config: monorepo build (core first, then web)
```

## Storage (Supabase, 2026-07-29)

Schema in `supabase/migrations/0001_init.sql`. Three tables, RLS on all of them.

**`channel_symbols` is a separate table, not an array column on `channels`.** The detector's per-second question is "which channels watch BTCUSDT" — a reverse lookup. An array or jsonb column can't be indexed for that, so every tick would scan all channels. The child table carries `(exchange, symbol)` index for exactly this path.

**`sensitivity` stores the percentile, never the slider position.** The slider is a log-axis presentation; storing positions would silently change every user's setting if the axis is ever retuned.

**RLS is the only defense.** The web queries Supabase directly from the browser with the anon key — a public value. No API-route layer sits in between because there's nothing for it to protect that RLS doesn't. The detector uses `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS; that key must never get a `NEXT_PUBLIC_` prefix.

**Missing env vars are not an error.** `isSupabaseConfigured()` returns false, clients return `null`, and the app runs guest-only. A fresh checkout works without a Supabase project.

**`apps/web/src/lib/supabase/types.ts` uses `type`, not `interface`.** supabase-js requires each table to satisfy `Record<string, unknown>`; interfaces don't get implicit index signatures, so the whole schema silently degrades to `never` and errors surface as the misleading `Property 'id' does not exist on type 'never'`.

Guest→member transition migrates sessionStorage channels into the account once, then clears sessionStorage. Writes are optimistic: local state updates first, the row write follows, and a failure rolls the state back and raises a `StoreProblem`.

**Guest data migration** (2026-07-29): Before this change, channels had a `symbols` array. Browser sessionStorage from older versions may carry this shape. `normalizeChannel()` in `channel-store.tsx` detects it, takes the first symbol, and discards the rest. Guest data is session-scoped anyway, so no persistent migration was worth the code.

See `docs/deploy.md` for the Vercel + Supabase setup procedure.

## Key Concepts

### Detection Pipeline

```
Binance aggTrade WS → 1-second buckets → Per-frame rolling windows
  → Median/MAD baseline + anomaly score S → Percentile conversion
  → Sensitivity threshold → Filters (min turnover, warmup, cooldown)
  → Identify scale (largest frame triggering) → Single alert per channel → Telegram dispatch
```

**The whole pipeline runs end-to-end as of 2026-07-29** — everything except dispatch. `pnpm --filter @flare-alert/detector start` connects to Binance, primes itself from history, and prints alerts to the console.

| Stage | Where | State |
|---|---|---|
| aggTrade ingestion, reconnect, gap repair | `binance.ts`, `backfill.ts` | ✅ |
| 1s buckets → per-frame rolling windows | `aggregator.ts` | ✅ tested |
| Median/MAD baseline → score S | `detect.ts` (via core) | ✅ |
| Percentile conversion | `detect.ts` (via core) | ✅ |
| Warmup + min-turnover filters | `aggregator.ts`, `detect.ts` | ✅ |
| Threshold, cooldown, merge, scale | `channel-runtime.ts` | ✅ |
| Channels loaded from Supabase | — | ❌ synthetic channel per symbol |
| Telegram / browser dispatch | — | ❌ console only |

**Cold start is the hard part, and `backfill.ts` is where it's solved.** A fresh process has no past, but the 1d frame needs 14 completed daily windows for a baseline, and the percentile needs enough samples to even *resolve* the threshold — below ~2,930 samples no observation can reach percentile 99.9659, so the detector would sit silent rather than alert. Startup replays `BACKFILL_DAYS` (20) of 1-minute klines to fill both. Takes ~3s per symbol.

**The 1m frame is deliberately excluded from backfill priming.** Replaying at 1-minute granularity only ever evaluates the 1m window at elapsed=60s (complete windows). Live, that frame is judged at elapsed 10–60s, and partial windows have far more velocity variance. Priming from complete windows alone yields a distribution that is too narrow, which inflates live percentiles and over-alerts. Longer frames don't have this problem — for the 1h frame, minute-granularity sampling is a uniform 1-in-60 subsample of the same elapsed range, so the shape is preserved. The 1m frame instead warms up live (~1 hour).

### Verifying the detector against the backtest

`pnpm --filter @flare-alert/detector verify` replays recent days through the *live* pipeline classes (not the backtest's own code) and prints every alert. Env: `VERIFY_DAYS`, `VERIFY_SENSITIVITY`, `DETECTOR_SYMBOLS`.

First run, 2026-07-29, BTC/ETH/SOL over 5 days:

| Slider | Backtest (1s replay) | Detector (1m replay) | Ratio |
|---|---|---|---|
| 26 (default) | 2.2 /day/coin | 0.67 /day/coin | 0.30 |
| 72 | 24.4 /day/coin | 7.80 /day/coin | 0.32 |

**The constant ratio is the result that matters.** Alert rate changed 30× between the two rows while the ratio held at ~0.31. A miscalibrated threshold would drift with sensitivity; a flat offset means the detector applies the same threshold the backtest measured, and the shortfall is the replay's sampling — 1/60 as many evaluation points, plus the 1m frame excluded (visible as an empty 1m bucket in the scale distribution). **Treat verify counts as a floor, not a prediction.** Confirming the absolute rate needs a real-time run over days.

Qualitatively the alerts look right: S values of 30–160, volume 8–64× the median, and the 2026-07-26 22:00–22:02 cluster fired on BTC, ETH, and SOL within two minutes of each other — a market-wide event, correctly caught on three independently-calibrated symbols.

**Alert model** (2026-07-27, clarified 2026-07-29): Alerts are **per channel**, not per frame. All six frames feed into a single percentile decision (maximum across frames). If it clears the threshold, one alert fires per channel. The scale (largest frame to trigger) is attached to the alert as metadata for labeling ("1-hour-class spike"), not as a dispatch mechanism. **Since each channel watches exactly one coin (2026-07-29), every alert unambiguously names its trigger coin.**

### Timeframes

Six timeframes evaluated in lockstep: `1m`, `5m`, `15m`, `1h`, `4h`, `1d`. Windows are aligned to absolute epoch boundaries so `1d` opens at UTC midnight. Candle close is never awaited — a 4h window that spikes 6 minutes in is judged on 6 minutes of velocity.

### Channel Model

A `Channel` = **one coin** + one sensitivity + delivery methods (updated 2026-07-29). Users have many channels; the same coin may appear in several channels with different sensitivities.

**Why one coin per channel?** Previously, channels could hold multiple coins. But when a channel watching BTC and ETH fires, the UI showed both coin names and alert counts, making it unclear *which coin caused the spike*. Restructuring to 1-channel-1-coin makes the trigger coin always obvious in the card header.

**Critical split**: score S and percentile are *independent of channels* — they are properties of a symbol/timeframe, not of user settings. Cooldown and scale detection are *per channel* (one channel firing must not silence another watching the same coin). So the detector computes the expensive part once per symbol and applies each channel's threshold to the result. State keys are `ChannelSeriesKey`, not `SeriesKey`.

**Alert output**: One alert per channel per symbol per event. The alert object contains:
- `channelId` — which channel detected it
- `scale` — the largest timeframe to trigger (1m–1d), used for display ("1시간봉급 급등")
- `percentile`, `score`, `quoteVolume`, `ratioToMedian` — debugging and display

No `strength` field; the alert happens or it doesn't. Frame counts are not aggregated into a "strength" metric.

`apps/backtest` already has this shape (extract crossings once → sweep configs cheaply).

### Sensitivity Model

**One alert per channel.** Timeframes are NOT an evaluation axis — the only firing criterion is sensitivity. Frames appear solely as reference tick marks on the slider, meaning "at this position, spikes of that size fire as often as they actually occur."

`FRAME_SCALE_PERCENTILE` places those marks: 1m at slider 72 (rightmost, ~16.6 alerts/day) because 1m-or-larger events occur ~16.2 times per day; 1d at slider 1 (leftmost, ~0.6 alerts/day) because only ~0.3 such events occur daily. Each mark is the position where channel alerts precisely match the *frequency* of events in that scale class.

**Mechanism**: Event scale is defined as the longest timeframe whose signal crossed anomaly threshold during a merge window. Backtest counts how often each scale occurs, then binary-searches the slider to find the position where channel alerts match that frequency. This ensures the UI tick mark at 1m position will actually generate ~16.2 alerts per day when at 1m position, validating the label.

**Historical note**: An earlier approach measured the *percentile (median signal)* of events within each scale class, yielding only ~9.4 daily alerts at the 1m position, mismatched to observed 15–20 range. The current method directly optimizes event frequency instead.

An `Alert` carries `scale` (the longest anomalous timeframe) as a descriptive label — "1시간봉급 급등". It describes an alert; it never creates one.

- Meaning: "alert on the top (100 − sensitivity)% of observations"
- **Not an integer.** The useful range is compressed into 99–100, so the UI must handle decimals. Default is `99.887` (15-minute-scale rate, ≈3–4 alerts/day per coin in a channel).
- `SENSITIVITY_MIN` 90, `SENSITIVITY_MAX` 99.995 (raised so the quiet end can reach day-scale event rates)

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
| `SENSITIVITY_DEFAULT` | 99.9659 | Slider 26 (1-hour scale). Set by **alert-quality measurement** (2026-07-29), not frequency alone — see § Alert Quality. Default was 99.8743 (slider 43, 15-min scale), but quality measurement showed slider 26 is the loosest setting that clears the 2x lift bar. |
| `SENSITIVITY_MAX` | 99.995 | Left bound; lower samples (60 per key) approach statistical noise limits; tuned to reach ~0.64 alerts/day |
| `FRAME_SCALE_PERCENTILE` | per-frame constants | Percentile at which that event frequency would naturally fire at its labeled slider position |
| `CHANNEL_RATE_CURVE` | single array | Alert frequency (per coin, per channel) at each slider position; measured 2026-04-01 to 2026-06-30 |

**Event Scale Labeling & Alert Frequency** (`packages/core/src/constants.ts`):

The backtest revealed that event size (1m spike vs. 1d spike) and event strength are independent. A sensitivity set for large events (low percentile) will catch all the small events too. So instead of per-frame alert budgets, the UI labels each slider position with the *smallest event size* it would typically catch in isolation.

**Scale marker definition** (recalibrated 2026-07-28): "At this slider position, the channel will fire as often as events of that scale-or-larger actually occur." The 1-minute marker fires ~16.6 times per day because minute-scale-or-larger events occur about 16.2 times per day. Measurement counts actual event frequency (how many times that scale class or larger occurred) and uses binary search to find the slider position where channel alerts match that frequency.

Prior method (discarded): measured the *median* of per-frame signals, which by definition caught only ~50% of events of that scale. This produced only 9.4 daily alerts at the 1m position, well below the sensed 15–20 range.

Backtest measured two things:

1. **Frame Scale Percentile** (`FRAME_SCALE_PERCENTILE`) — the percentile at which each timeframe's events (counted by frequency, not signal strength) would be caught at a specific slider position. A threshold placed so that "1-minute-scale-or-larger events per day" match "alerts per day" at that slider:

| Frame | Events/day | Slider Position | Alerts/day |
|---|---|---|---|
| 1m | 16.2 | 72 | 16.6 |
| 5m | 7.2 | 56 | 7.6 |
| 15m | 3.7 | 43 | 3.8 |
| 1h | 1.5 | 26 | 1.5 |
| 4h | 0.7 | 8 | 0.7 |
| 1d | 0.3 | 1 | 0.6 |

The event threshold (percentile 98) is *not* derived from data—it is a tuning knob set to match observed chart behavior: "1-minute spikes should fire 15–20 times per day." Lowering from 99 to 98 shifted 1m from 12.6 to 16.2 alerts, into target range.

These serve as UI tick marks. Users see "1분봉급 / 5분봉급 / 15분봉급 / 1시간봉급 / 4시간봉급 / 1일봉급" at these positions, indicating event size, not dictating frame-specific behavior.

2. **Channel Rate Curve** (`CHANNEL_RATE_CURVE`) — alert frequency per coin at each slider position (5–100 in 5-step increments). Single curve because alerts are per-channel, not per-frame. Measured on 6 symbols (BTC, ETH, SOL, ANKR, ONE, SHIB) from 2026-04-01 to 2026-06-30. Used by the web UI to show estimated alert rate at the current slider position.

The curve values are interpolated linearly by `estimateAlertsPerDay(sliderPosition)` when rendering the slider preview.

Labels merge if tick positions differ by ≤4. The file `apps/backtest/src/event-scale.ts` measures both the scale markers and the channel rate curve via `measureScaleMarkers()` (which counts events per frame) and `measureChannelCurve()` (which simulates channel alerts at each slider position).

Confirmed by recalibration (2026-07-28):
- **`FRAME_SCALE_PERCENTILE`** — All six timeframes now placed by event frequency, not signal percentile.
- **`SENSITIVITY_MAX`** — Raised from 99.99 to 99.995 to accommodate day-scale events at the left edge.
- **`SENSITIVITY_DEFAULT`** — was 99.8743 here; superseded 2026-07-29 by the quality measurement (now 99.9659). See § Alert Quality.

Still carrying `TODO(backtest)` in `constants.ts`: `LOOKBACK_WINDOW_COUNT`, `MIN_ELAPSED_SECONDS`, `MIN_QUOTE_VOLUME`, `COOLDOWN_DECAY_CURVE`, `COOLDOWN_TAIL_TIGHTENING`, `PERCENTILE_HISTORY_DAYS`, `MIN_PERCENTILE_SAMPLES`, `MAD_FLOOR_RATIO`.

`MIN_QUOTE_VOLUME` is the most urgent — it single-handedly determines small-cap behavior (2M rejections on ANKR/ONE vs 19 on BTC) and was set without evidence.

## Common Development Commands

```bash
pnpm install
cp .env.example .env        # then fill TELEGRAM_BOT_TOKEN

pnpm dev:web                # builds core, then next dev on :3000
pnpm dev:detector           # builds core, then runs detector (live Binance)

pnpm test                   # 83 tests (72 core + 11 detector)
pnpm typecheck              # all 4 workspaces
pnpm build                  # topological build
pnpm clean
```

### Running the detector

```bash
pnpm --filter @flare-alert/detector build
pnpm --filter @flare-alert/detector start    # live; ~9s boot, then prints alerts
pnpm --filter @flare-alert/detector verify   # replay recent days, print every alert

curl localhost:8080/health   # warmup state + percentile sample counts per frame
```

`/health` returns 503 until backfill finishes, then 200 with per-symbol warmup and sample counts — use it to tell "quiet market" apart from "frame not awake yet". Neither command needs an API key or a `.env`; Binance's public endpoints need no auth.

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

- `TELEGRAM_BOT_TOKEN` — **temporarily optional** (2026-07-29). It was required, but dispatch isn't built yet and requiring it blocked verification runs. The detector warns and prints alerts to the console instead. Restore the hard requirement when the Telegram notifier lands.
- `DETECTOR_SYMBOLS` — detector only; comma-separated (`BTCUSDT,ETHUSDT`). Defaults to BTC/ETH/SOL. Stands in until channels are read from Supabase; each symbol costs ~29 REST requests and ~3s at boot.
- `BINANCE_WS_URL` — defaults to `wss://stream.binance.com:9443/ws`
- `PORT` — health-check HTTP port (default 8080)
- `LOG_LEVEL` — `debug` | `info` | `warn` | `error`
- `NEXT_PUBLIC_APP_URL` — web only, browser-exposed
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — web; **absence is handled**, the app falls back to guest-only
- `SUPABASE_SERVICE_ROLE_KEY` — detector only; bypasses RLS, never `NEXT_PUBLIC_`

Next.js reads `apps/web/.env.local`, not the root `.env`. The Supabase pair has to go in the former for `pnpm dev:web` to enable accounts.

There is no Binance API key (public dumps and public WS need none).

## Testing

`packages/core` has 72 tests (`node:test`, no framework dependency) covering math primitives, baseline/score edge cases, percentile accuracy against exact sorted ranks, day-based sample eviction, cooldown behavior, slider↔percentile round-trips, scale markers, and alert-rate description thresholds.

`apps/detector` has 11 tests covering window alignment to absolute epoch boundaries, elapsed-time gating, velocity computation, the late/early trade buffer, and — most importantly — that minute-granularity backfill and second-granularity live stepping produce identical windows. That last one is what lets cold-start priming share the live code path.

Not yet covered: dispatch (unimplemented), frame merging (lives in backtest), and the web app.

**Typecheck does not catch server/client boundary violations.** Calling a `"use client"` export from a server component compiles fine and fails at request time with a 500. After touching `layout.tsx` or anything it imports, actually load the page (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`).

## Alert Quality (measured 2026-07-29)

The first evidence that alerts mean anything. Everything before this only counted *how often* alerts fire.

**Method** (`apps/backtest/src/quality.ts`, added 2026-07-29): for each alert at second `t`, measure the maximum absolute price excursion over the next 1/5/15/60 minutes, and compare against 20,000 random seconds from the *same symbol and period*. Baseline ('lift' denominator) is computed once per symbol using its full price history and cached to avoid redundant computation.

**Absolute movement, not return.** Volume spikes have no direction — they fire on crashes too. Averaging signed returns cancels to ~0 and yields the same number whether the algorithm works or not. Measurement uses `Math.abs(price/base - 1)` to compare alert movements against random baseline movements.

**Random sampling is seeded for reproducibility** — rebuilds produce identical results, so improved measurements can be distinguished from variation in random draws.

**Result: the signal is real, and it responds monotonically to the threshold** (majors, 1-minute horizon):

| Slider | Alerts/day | Lift vs random |
|---|---|---|
| 72 | 24.4 | 1.37x |
| 43 | 5.5 | 1.78x |
| 26 | 2.2 | **2.29x** ← new default |
| 8 | 1.0 | 2.55x |
| 1 | 0.8 | 2.88x |

A noise-picking algorithm would sit flat near 1.0x at every threshold. It doesn't — so tightening buys real quality. **`SENSITIVITY_DEFAULT` moved from 99.8743 (slider 43) to 99.9659 (slider 26)**, the loosest point clearing the pre-registered 2x lift bar. This directly addresses the discovery that frequency and quality diverged: frequency peaked at slider 43, but quality peaks at slider 26.

**Three findings that constrain the product:**

1. **Direction is a coin flip** — 43–55% up across every symbol and horizon. This is a "something is happening" alert, never a "buy" signal. **UI copy saying 급등 (surge) is wrong** and still needs fixing.
2. **The signal is short-lived.** Lift decays monotonically with horizon; BTC at the old default was 1.06x at 60 minutes — indistinguishable from noise. Volume spikes predict immediate movement, not trends.
3. **Median moves are small relative to fees.** BTC alerts moved 0.06% (median, 1 min) at the old default — under a round-trip taker fee. Value lives in the tail (31–42% of alerts land in the top decile of random moves), and in volatile alts where absolute moves are 0.5–2%.

**Known confound, not yet controlled:** alerts cluster in active trading hours while the random baseline samples uniformly, including quiet hours. Part of the measured lift may be time-of-day rather than signal. **True lift is probably lower than the table above.** Fixing this means drawing baseline samples matched to the alert's hour-of-day.

**Small caps are unmeasurable right now** — ANKR and ONE produced 22 and 20 alerts in 61 days. `MIN_QUOTE_VOLUME` is silencing them, so their apparently high lift (3–4x) rests on no sample.

**Implementation notes** (`apps/backtest/src/quality.ts`, `apps/backtest/src/index.ts` new `alertQuality` function):
- `buildBaseline()` — compute min/max/median prices for each horizon on a per-symbol basis; called once and cached
- `measureQuality()` — for a given crossing stream and symbol prices, extract alerts and measure lift/hit rate/directional bias
- Random horizons (1/5/15/60 seconds) use seeded PRNG for reproducibility
- Results printed as `lift | hit% | up%` for each horizon, breaking down by symbol as aggregates for majors

## Known Gaps & Next Steps

1. **Alert quality — ✅ measured** (see above). New `quality.ts` backend supports any horizon and any symbol; currently reporting 1/5/15/60-second lift. Still open: the time-of-day confound, quality confirmation on 2–3 additional symbols, and hit-rate targets (10%+ above-random clicks would justify a product callout).
2. **`MIN_QUOTE_VOLUME` has no evidential basis** yet dominates small-cap results.
3. **Detector pipeline** — ✅ runs end-to-end against live Binance (2026-07-29): ingestion, aggregation, scoring, percentile, filters, cooldown/merge, scale, `/health`. Alerts print to console. Still TODO: (a) load real channels from Supabase instead of one synthetic channel per symbol, (b) Telegram + browser dispatch, (c) `TELEGRAM_BOT_TOKEN` was made optional to unblock verification — make it required again once dispatch lands, (d) confirm the alert rate with a multi-day real-time run (see § Verifying the detector).
4. **Storage** — ✅ schema, auth, and channel persistence done (see § Storage). Still missing: alert-history table (no producer yet), Telegram linking flow, password reset.
5. **Web UI — Main page** (merged landing + channel creation):
   - ✅ `MainApp` — guest/member split driven by real auth state
   - ✅ `ChannelCard` — edit/delete/toggle channel actions; displays single coin in header with icon (2026-07-29)
   - ✅ `ChannelForm` — create/edit UI with single-coin radio selection + `SensitivitySlider`; coin picker uses icons (2026-07-29)
   - ✅ `CoinIcon` — renders SVG coin icon if available, falls back to color dot (2026-07-29)
   - ✅ `AuthDialog` — functional email/password against Supabase Auth
   - ✅ Browser notification permission request (shown when channel list non-empty)
   - ✅ Korean/English toggle
   - TODO: alert history view; coin list is 13 Binance top symbols (was 32) rather than fetched live
6. **Deployment** — `vercel.json` is in place; connecting the Vercel project and filling env vars is a manual account step (`docs/deploy.md`). The detector still has no host.
7. **Backtest tools**:
   - ✅ `apps/backtest/src/event-scale.ts`: Measures event-scale percentiles and channel rate curve (replaces `frame-standards.ts`)
   - ✅ `FRAME_SCALE_PERCENTILE` and `CHANNEL_RATE_CURVE` published in constants
8. **Alert quality measurement** (2026-07-29):
   - ✅ `apps/backtest/src/quality.ts`: New module measuring lift/hit-rate/direction for any horizon and symbol
   - ✅ `apps/backtest/src/index.ts` new `alertQuality()` function: CLI entry point for quality reports
   - ✅ `SENSITIVITY_DEFAULT` updated from 99.8743 (slider 43) → 99.9659 (slider 26) based on 2x lift bar
