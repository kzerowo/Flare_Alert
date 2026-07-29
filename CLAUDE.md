# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

_Last updated: 2026-07-30 01:11_

## Project Overview

**Flare Alert** is an adaptive volume-spike alert service for cryptocurrency traders. Users create **channels**; each channel watches one coin at one sensitivity level. Thresholds are percentile-based and calibrated per coin (from each symbol's own score distribution), so a single sensitivity setting transfers across coins of wildly different liquidity, instead of a fixed multiplier that needs per-symbol tuning.

**Percentiles do not make alert frequency predictable.** Evaluation runs every second, so "top 5% of seconds" is not "5% of events" — a single event crosses the threshold for hundreds of consecutive seconds. See `docs/algorithm.md` § 백테스트 결과.

Distribution is via **native mobile apps** (App Store/Play Store) once the web app is complete — not Telegram. Web Push (RFC 8291 + VAPID) is the current delivery mechanism; mobile push comes later.

## Tech Stack

- **Monorepo**: pnpm workspaces (pnpm 11, Node ≥20)
- **apps/web**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS v4 → Vercel
- **apps/detector**: Node.js (ES modules) + TypeScript → Oracle Cloud free tier (planned)
- **apps/backtest**: Offline parameter-tuning tool, never deployed
- **packages/core**: Shared types, constants, and the statistical core

## Design System

**Design tokens** (`apps/web/src/app/globals.css` @theme):
- **Colors** (Material 3 semantics): 6-layer dark backgrounds (sunken `#020304` → surface `#030405` → surface-low `#090b0d` → card `#07090d` → surface-high `#121517` → surface-highest `#1a1d20`), deliberately dark for a crypto-trading-platform mood; primary `#8ed5ff` for text/icons on dark; primary-container `#38bdf8` for filled buttons (button text `#002030`, 7.8:1 contrast); state colors (danger, warm); outline shades for borders/dividers
- **Spacing**: 5 scales (4/8/16/24/48px). **No named `--spacing-*` tokens** — conflicts with Tailwind v4's `max-w-*`/`w-*`/`h-*` resolution. Use the numeric scale directly: `xs=1, sm=2, md=4, lg=6, xl=12`.
- **Typography**: 7 text styles (display, headline, title, body, body-sm, data, label) with paired line-height/letter-spacing
- **Corners**: lg 0.5rem, xl 0.75rem
- **Fonts**: Inter (variable) for UI text; JetBrains Mono (variable) for numerics, to prevent layout shift when values change

**`.label` component**: lives in `@layer components` (Tailwind v4 layer ordering) and defines no color, so `text-*` utilities apply cleanly.

**Icons** (`apps/web/src/components/Icon.tsx`): 14 inline SVGs, no external font dependency, follow `currentColor`.

**Cursor** (`globals.css` `@layer base`): one rule gives `pointer` to enabled buttons/`[role=button]`/`summary`/checkbox labels, `not-allowed` to disabled ones — browsers default `button` to `cursor: default`.

## Localization

Korean and English. `packages/core` is language-neutral — returns numbers and discriminated unions, never sentences.

- **`apps/web/src/lib/locale.ts`** — `Locale`, `LOCALES`, `LOCALE_COOKIE`, `parseLocale`, `LOCALE_NAME`, `LOCALE_TAG`. **No `"use client"`** — `layout.tsx` (a server component) needs `parseLocale`, and every export of a client module is unusable from a server component.
- **`apps/web/src/lib/i18n.tsx`** — dictionaries + `LocaleProvider` + `useT()`. `ko` is the source of truth; `en` is typed as `typeof ko`, so a Korean-only addition fails the build. Interpolated values are functions, not templates.
  - User-visible text uses "크립토"/"Crypto", not "코인"/"coin". Internal names (`CoinIcon`, `symbolsLabel`) are unaffected.
  - Footer disclaimer: "An alert only tells you liquidity gathered. It does not tell you whether the price will rise or fall — trading decisions are your own."
- Components read `const t = useT()` and access fields directly — no string-key lookup, so typos are compile errors.
- **Locale lives in a cookie**, not `localStorage` — the server must see it on first paint. `layout.tsx` and `generateMetadata()` both read it, making `/` a dynamic route.

Language-dependent formatting lives in `web`, not `core`:
- `describeAlertRate(perDay)` (core) → discriminated union; `formatAlertsPerDay(t, perDay)` (web) → words.
- `validateChannel()` (core) → `ChannelProblem[]`; `formatProblem(t, problem, limits)` (web) → rendered text.
- `createChannel()` returns `name: ""`; the form supplies `t.form.defaultName`.

## Asset Selection

`POPULAR_BINANCE_SYMBOLS` in `packages/core/src/channel.ts` lists 13 symbols, descending market-cap order:

```
BTC, ETH, BNB, XRP, SOL, TRX, DOGE, XLM, ZEC, WBTC, WBETH, LINK, ADA
```

All actively traded on Binance USDT. Coin icons live in `apps/web/public/coins/` as lowercase SVGs (e.g. `btc.svg`); missing icons fall back to a color dot.

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
│   │       ├── crossings.ts        # Crossing stream + disk cache (incl. quoteVolumes)
│   │       ├── engine.ts           # Phase 2: sweep settings, single alert per channel
│   │       ├── event-scale.ts      # Measure scale labels and channel rate curve
│   │       ├── quality.ts          # Alert quality measurement (lift, hit-rate, direction)
│   │       ├── hour-matched.ts     # Hour-of-day confound correction
│   │       ├── turnover.ts         # Quote volume floor measurement
│   │       ├── label-fit.ts        # Score against the user's own criterion (recall/precision/latency)
│   │       └── index.ts            # CLI entry + report
│   ├── detector/          # Real-time detection (continuous process)
│   │   └── src/
│   │       ├── index.ts            # Entry: boot, logger setup, health endpoint, graceful shutdown
│   │       ├── service.ts          # DetectorService: main loop, channel sync (1m), alert dispatch
│   │       ├── store.ts            # Runtime channel state: load from Supabase, hot-add new symbols
│   │       ├── push.ts             # Pusher: Web Push RFC 8291 encryption + dispatch, dead-sub cleanup
│   │       ├── config.ts           # Env var loading and validation (incl. VAPID keys)
│   │       ├── vapid-keys.ts       # VAPID key loading from env or disk fallback
│   │       ├── binance.ts          # REST (klines) + WS (aggTrade, auto-reconnect)
│   │       ├── aggregator.ts       # 1-second buckets → rolling windows
│   │       ├── detect.ts           # Baseline → score S → percentile → filters
│   │       ├── channel-runtime.ts  # Per-channel threshold, cooldown, merge, scale
│   │       ├── backfill.ts         # Cold-start priming from historical klines
│   │       ├── verify.ts           # Replay recent days through the live pipeline
│   │       └── aggregator.test.ts  # 11 tests incl. minute/second equivalence
│   └── web/               # Dashboard & settings UI
│       ├── public/
│       │   ├── sw.js                # Service worker: register, cache, receive push messages
│       │   └── coins/*.svg          # Coin icons for the 13 Binance symbols
│       ├── src/app/
│       │   ├── layout.tsx          # Reads locale cookie on the server, wraps LocaleProvider
│       │   └── page.tsx            # AuthProvider > ChannelStoreProvider > AlertStoreProvider > MainApp
│       ├── src/middleware.ts       # Supabase session refresh (only place cookies can be written)
│       ├── src/components/
│       │   ├── MainApp.tsx                # App root: nav, hero, tabbed channels/alerts view, error banner
│       │   ├── AlertHistory.tsx           # Alert history display with channel filtering and deletion
│       │   ├── ChannelCard.tsx            # Edit/delete/toggle actions; history button
│       │   ├── ChannelForm.tsx            # Create/edit UI: single-coin radio group + sensitivity slider
│       │   ├── CoinIcon.tsx               # Coin symbol → SVG icon or fallback color dot
│       │   ├── AuthDialog.tsx             # Login/signup against Supabase Auth, incl. forgot-password
│       │   ├── ResetPasswordDialog.tsx    # Password reset via PASSWORD_RECOVERY event
│       │   ├── SensitivitySlider.tsx      # Interactive sensitivity control with frame-standard tick marks
│       │   ├── LanguageToggle.tsx         # ko/en segmented control
│       │   └── Icon.tsx                   # Inline SVG icons
│       └── src/lib/
│           ├── locale.ts                  # Locale primitives — NO "use client" (server reads these)
│           ├── i18n.tsx                   # Dictionaries + LocaleProvider + useT()
│           ├── auth.tsx                   # AuthProvider over Supabase Auth, incl. password reset
│           ├── alerts.tsx                 # AlertStoreProvider: fetch + Realtime subscription
│           ├── channel-store.tsx          # Guest (sessionStorage) / member (Supabase) dual mode
│           ├── push.ts                    # Web Push subscription: request permission, subscribe, persist
│           └── supabase/
│               ├── config.ts              # Env vars; isSupabaseConfigured(); VAPID_PUBLIC_KEY
│               ├── client.ts              # Cached browser client (null when unconfigured)
│               ├── server.ts              # Server-component client (read-only cookies)
│               ├── types.ts               # Database types — `type`, not `interface`
│               └── channels.ts            # Channel read/write against Supabase
├── packages/
│   └── core/src/
│       ├── types.ts            # Domain types + interfaces (Alert, AlertBuilder)
│       ├── constants.ts        # Confirmed & pending-backtest parameters
│       ├── math.ts             # median, MAD, quantile, percentile rank
│       ├── score.ts            # Baseline (median/MAD) + anomaly score S
│       ├── percentile.ts       # Histogram percentile estimator (Fenwick tree)
│       ├── cooldown.ts         # Time-decay cooldown
│       ├── sensitivity.ts      # Slider ↔ percentile conversion, channel rate curve
│       └── sensitivity.test.ts
├── supabase/migrations/
│   ├── 0001_init.sql            # profiles / channels / channel_symbols + RLS
│   └── 0002_alerts_and_push.sql # push_subscriptions / alerts tables + RLS, drops Telegram
├── apps/detector/deploy/        # systemd unit + setup.sh for Oracle Cloud deployment
├── docs/                        # Korean planning docs (algorithm/architecture/research/decisions/deploy)
├── data/                        # Backtest data — gitignored, ~1.2GB
└── apps/web/vercel.json         # Vercel build config: monorepo build (core first, then web)
```

## Storage (Supabase)

Five tables: profiles, channels, channel_symbols, push_subscriptions, alerts; RLS on all of them.

**`channel_symbols` is a separate table, not an array column on `channels`.** The detector's per-second question is "which channels watch BTCUSDT" — a reverse lookup an array/jsonb column can't index. The child table carries an `(exchange, symbol)` index for exactly this path.

**`sensitivity` stores the percentile, never the slider position** — the slider is a log-axis presentation; storing positions would silently change every user's setting if the axis is retuned.

**`push_subscriptions`**: one row per browser that opted in. Columns: `endpoint` (PK), `user_id`, `p256dh`, `auth` (base64url), `label` (e.g. "Chrome / Windows (localhost:3000)" — includes origin because browsers treat different ports as different sites, so subscribing from two ports/origins creates two rows and duplicate notifications), `created_at`, `last_success_at`. Dead subscriptions (404/410) are deleted on first failure.

**`alerts`**: immutable event log. `id`, `user_id` (duplicated from the channel — Realtime filters on one column only), `channel_id`, `symbol`, `scale`, `price`, `ratio_to_median`, `quote_volume`, `percentile`, `score`, `fired_at`. Broadcast on Realtime for the web UI. DB failure does not block push dispatch — best-effort logging.

**RLS is the only defense.** The web queries Supabase directly with the anon key (public); no API-route layer sits in between. The detector uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) — **must never carry a `NEXT_PUBLIC_` prefix, and must never be placed in `.env.example` or any git-tracked file, only `.env`.**

**Missing env vars are not an error** — `isSupabaseConfigured()` returns false, clients return `null`, app runs guest-only.

**`apps/web/src/lib/supabase/types.ts` uses `type`, not `interface`** — supabase-js requires each table to satisfy `Record<string, unknown>`; interfaces lack implicit index signatures and silently degrade the schema to `never`.

Guest→member transition migrates sessionStorage channels into the account once, then clears sessionStorage. Writes are optimistic (local state first, row write follows, failure rolls back + raises `StoreProblem`). Old sessionStorage may carry a `symbols` array shape; `normalizeChannel()` takes the first symbol and discards the rest.

See `docs/deploy.md` for Vercel + Supabase setup, and Oracle Cloud detector deployment.

## Key Concepts

### Detection Pipeline

```
Binance aggTrade WS → 1-second buckets → Per-frame TRAILING windows
  → Median baseline (aligned completed windows) → ratio = velocity / median
  → 15m frame only, ratio ≥ channel threshold → min-turnover + warmup filters
  → Event-gap merge (one alert per event) → Web Push dispatch
```

**Windows are trailing, not boundary-aligned partials.** The judged value is always "the last W seconds," so it is never extrapolated. The old design divided an aligned window's accumulated volume by elapsed minutes starting at `MIN_ELAPSED_SECONDS` — 10s for the 1m frame — which multiplied a 10-second sample by 6 and compared it against a distribution of completed windows. Measured on live alerts, that inflated the reported ratio ~4× at elapsed 10s (1.2× at 48s), so alerts fired where the chart showed nothing. `MIN_ELAPSED_SECONDS` is now unused by the detection path.

**Only the 15m frame decides.** The other five are still computed, but only to label an alert's scale (the longest frame that also cleared the same ratio).

**The threshold is a ratio, not a percentile.** "Turnover over the last 15 minutes is ≥ N× the median of the previous 32 such windows." This is the number the user can verify against a chart. `channels.sensitivity` still stores a percentile; `channelRatio()` converts percentile → slider → ratio at runtime. **Transitional** — retuning the ratio axis silently changes stored settings, so the schema should eventually store the ratio directly.

Runs end-to-end: connects to Binance, primes from history, reads channels from Supabase, dispatches to subscribed browsers via Web Push, logs to DB, exposes `/health`.

**Cold start** (`backfill.ts`): a fresh process has no past, but the 1d frame needs 14 completed daily windows and the percentile needs ~2,930 samples before it can even resolve percentile 99.9659. Startup replays `BACKFILL_DAYS` (20) of 1-minute klines (~3s/symbol) to fill both.

**The 1m frame is excluded from backfill priming.** Minute-granularity replay only ever evaluates the 1m window at elapsed=60s (complete windows), but live it's judged at elapsed 10–60s where partial windows have much more velocity variance. Priming from complete windows alone yields a too-narrow distribution → inflated live percentiles → over-alerting. Longer frames don't have this problem (minute sampling is a uniform 1-in-60 subsample of their elapsed range). The 1m frame instead warms up live (~1 hour).

**Verification** (`pnpm --filter @flare-alert/detector verify`): replays recent days through the live pipeline classes (not the backtest's own code). Found a constant ~0.31 ratio between live-replay-at-1-minute-granularity and the 1-second backtest across a 30× range of sensitivities — a flat offset (not drift) means the threshold logic is correct and the gap is sampling granularity (1/60 as many evaluation points, plus 1m frame excluded), not a bug. **Treat verify counts as a floor, not a prediction** — confirming the absolute rate needs a real-time multi-day run.

**Alert model**: one alert per channel per event. The 15m frame's ratio is the only firing criterion. Scale is attached as display metadata only. Since each channel watches exactly one coin, every alert unambiguously names its trigger coin.

**No cooldown.** `TimeDecayCooldown` tightened a percentile's tail fraction and cannot be carried over to a ratio; the event-gap merge already guarantees one alert per event. The class still exists in `core` (and the backtest's percentile path uses it) but the product path does not.

### Timeframes

Six timeframes in lockstep: `1m`, `5m`, `15m`, `1h`, `4h`, `1d`. Windows align to absolute epoch boundaries (`1d` opens at UTC midnight). Candle close is never awaited.

### Channel Model

A `Channel` = **one coin** + one sensitivity + delivery methods. Users have many channels; the same coin may appear in several with different sensitivities. (Previously multi-coin per channel — reverted because a firing channel watching two coins couldn't show which one spiked.)

**Critical split**: score S and percentile are properties of a symbol/timeframe, independent of channels. Cooldown and scale detection are per channel (one channel firing must not silence another watching the same coin). The detector computes the expensive part once per symbol and applies each channel's threshold to the result. State keys are `ChannelSeriesKey`, not `SeriesKey`.

**Alert output** carries `channelId`, `scale` (display label), `percentile`, `score`, `quoteVolume`, `ratioToMedian`. No `strength` field — the alert happens or it doesn't.

### Sensitivity Model

The slider sets a **ratio**, not a percentile. Meaning: "alert when the last 15 minutes of turnover reaches N× the median of the previous 32 fifteen-minute windows."

- `RATIO_AT_SLIDER_MIN` 10 (slider 1, quiet) → `RATIO_AT_SLIDER_MAX` 1.5 (slider 100, frequent); logarithmic axis, since 1.5→2 matters and 9→10 does not.
- `RATIO_DEFAULT` 4 sits at slider 49. Chosen from the user's own chart labels — see § Label-Based Measurement.
- Slider tick marks are ratios (8/6/4/3/2), not frame names. Frame labels were removed: they claimed "at this position you catch 1분봉급 spikes," which stopped being true once detection became a single 15m window.
- `estimateAlertsPerDay(sliderPosition)` interpolates `CHANNEL_RATE_CURVE`, remeasured under the ratio rule. The curve flattens above slider ~85 (≈11/day): below ~2× the signal sits above threshold almost continuously, so event-gap merging absorbs the extra crossings.
- Exports: `sliderToRatio()`, `ratioToSlider()`, `sliderToPercentile()`, `percentileToSlider()`, `estimateAlertsPerDay()`, `SLIDER_MIN`, `SLIDER_MAX`

`FRAME_SCALE_PERCENTILE` still exists but no longer drives anything.

### Delivery

Per channel: `browser` (legacy Notification API, tab must be open — being phased out) and Web Push.

**Web Push** (`apps/web/public/sw.js` + `apps/detector/src/push.ts`): works even when no tab is open (browser must still be running). RFC 8291 encryption (ECDH P-256 + HKDF + AES128GCM) via the `web-push` library. Subscriptions in Supabase `push_subscriptions`; dead subscriptions (404/410) auto-deleted. TTL 600s (events are time-sensitive).

### Alert History

Two tabs: **Channels** and **History**. Key behaviors:

1. Switching to the alerts tab marks all unseen alerts as seen, clearing the badge.
2. `AlertStoreProvider` fetches up to 50 newest alerts on mount, then subscribes to Realtime `INSERT` filtered by `user_id` at the Supabase level (not just RLS). New alerts prepend.
3. A `seenIds` Set dedupes when the initial query and Realtime subscription overlap.
4. Unseen count increments per Realtime INSERT, resets when the alerts tab opens; shown as a badge.
5. History can be scoped to one channel via each `ChannelCard`'s history button; channel names are then omitted from rows (all identical). Falls back to "all" if the channel is deleted.
6. Each alert shows absolute time (HH:MM:SS, static) and relative time (updates every 60s).
7. Price precision adapts to magnitude: ≥100 → 2 decimals, ≥1 → 4 decimals, <1 → 8 decimals.
8. Deletion is optimistic — UI removes immediately, then sends DELETE; failure doesn't restore the row.
9. Empty states differ for guest (accounts required), load failure, and genuinely-empty (full list vs. single channel).

Realtime (tab open) and Web Push (tab closed) are complementary, not duplicative — Realtime subscription ends when the tab isn't open, which is exactly when push takes over.

### Score Semantics

`computeScore` returns `number | null`. `null` means MAD is 0 — the symbol traded at a constant (usually zero) rate across the lookback, so no meaningful score exists. Callers must not coerce this to a large number, or dead altcoins would dominate every alert list. Common: 1m frames on ANKR/ONE return null 65–74% of the time.

## Parameters

| Constant | Value | Note |
|---|---|---|
| `DETECTION_TIMEFRAME` | `15m` | The only frame that fires alerts. Beat the 6-frame max on the user's labels (64%/74% vs. 39%/28%). |
| `RATIO_DEFAULT` | 4 | Slider 49. ~4 alerts/day on majors. |
| `SENSITIVITY_DEFAULT` | 99.8007 | The percentile that maps to slider 49 → 4×. Storage is still percentile-shaped; see § Detection Pipeline. |
| `RATIO_AT_SLIDER_MIN` / `_MAX` | 10 / 1.5 | Slider ends, log axis |
| `EVENT_GAP_SECONDS` | 300 | Silence below threshold that ends an event |
| `CHANNEL_RATE_CURVE` | 20 values | Alerts/day per slider step; 6 symbols, 2026-04-01 to 2026-06-30, remeasured under the ratio rule |
| `LOOKBACK_WINDOW_COUNT["15m"]` | 32 | The 8 hours the median baseline is drawn from |

Ratio ↔ rate on BTC (61 days): 3× → 7.1/day, **4× → 3.9/day**, 5× → 2.4/day, 6× → 1.5/day. Small caps run 2–3× higher at the same setting (ANKR 10/day, ONE 12/day at 4×) because their own label-event rate is 8–10/day.

Still `TODO(backtest)` in `constants.ts`: `LOOKBACK_WINDOW_COUNT`, `MIN_QUOTE_VOLUME`, `PERCENTILE_HISTORY_DAYS`, `MIN_PERCENTILE_SAMPLES`, `MAD_FLOOR_RATIO`. `MIN_ELAPSED_SECONDS` and the `COOLDOWN_*` constants are now dead for the detection path — kept only for the backtest's percentile comparison path.

## Common Development Commands

```bash
pnpm install
cp .env.example .env

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
pnpm --filter @flare-alert/detector keys     # generate a VAPID key pair

curl localhost:8080/health   # warmup state + percentile sample counts per frame
```

`/health` returns 503 until backfill finishes, then 200 with per-symbol warmup and sample counts. Neither command needs an API key or `.env` — Binance's public endpoints need no auth.

### Backtesting

```bash
pnpm --filter @flare-alert/backtest fetch         # ~670MB of Binance dumps
pnpm --filter @flare-alert/backtest prepare:data  # → 360MB binary
pnpm --filter @flare-alert/backtest build
pnpm --filter @flare-alert/backtest start         # extract + sweep
```

Crossing extraction takes ~1 minute/symbol, cached to `data/crossings/`. Subsequent runs sweep parameters in seconds. Bump `MAGIC` in `crossings.ts` if the cache format changes (currently `FLARE-CROSSINGS-3`).

### Notes

- `packages/core` is consumed via its built `dist/`, not source. Rebuild after changing exports.
- Tests run from `dist/` via `node --test "dist/**/*.test.js"` — a bare directory won't discover them.
- The `pnpm` PowerShell wrapper writes a NativeCommandError banner to stderr on Windows even on success. Judge by exit code.

## Architecture Decisions

See `docs/decisions.md` (Korean) for full rationale.

1. Median/MAD instead of mean/stddev — a single spike drags a mean-based baseline up and mutes alerts for hours
2. Percentile instead of multiplier — cross-symbol portability
3. aggTrade + 1s buckets instead of klines — kline streams delay detection by up to 60s
4. Time-decay cooldown instead of "must exceed last alert" — the latter never resets after a big spike
5. Channel-based sensitivity instead of per-symbol or account-wide
6. Single alert per channel — max percentile across all six frames in parallel; scale attached for display only
7. Cooldown multiplies the allowed tail fraction rather than adding to the percentile — adding overflows the 100 ceiling at high sensitivity
8. Frame scale labels instead of per-frame alert rates
9. Fixed-bin histogram on an asinh axis with a Fenwick tree, not full sample retention
10. Channel model: channel-scoped cooldown/scale detection, symbol-scoped score/percentile
11. Web Push + in-page Notification API simultaneously per channel — covers both idle and away-from-tab cases
12. Frames are reference labels on the sensitivity slider, not an evaluation axis

## Environment Variables

- `DETECTOR_SYMBOLS` — detector only; comma-separated (`BTCUSDT,ETHUSDT`). Defaults to BTC/ETH/SOL. Stands in for standalone mode; each symbol costs ~29 REST requests and ~3s at boot.
- `BINANCE_WS_URL` — defaults to `wss://stream.binance.com:9443/ws`
- `PORT` — health-check HTTP port (default 8080)
- `LOG_LEVEL` — `debug` | `info` | `warn` | `error`
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — detector; generate via `pnpm --filter @flare-alert/detector keys`
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — detector only; bypasses RLS, **never `NEXT_PUBLIC_`, never in `.env.example`**
- `NEXT_PUBLIC_APP_URL` — web only, browser-exposed
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — web; absence handled, falls back to guest-only
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — web; needed for push subscription to work

Next.js reads `apps/web/.env.local`, not the root `.env`. There is no Binance API key (public dumps and public WS need none).

**Secrets belong only in `.env` (gitignored), never `.env.example` (git-tracked).** Scan every staged diff for secret patterns (`eyJhbGci`, `service_role`, `VAPID_PRIVATE_KEY=`, etc.) before committing.

## Testing

`packages/core`: 72 tests (`node:test`) — math primitives, baseline/score edge cases, percentile accuracy vs. exact sorted ranks, day-based sample eviction, cooldown behavior, slider↔percentile round-trips, scale markers, alert-rate description thresholds.

`apps/detector`: 11 tests — window alignment to absolute epoch boundaries, elapsed-time gating, velocity computation, late/early trade buffer, and (most importantly) that minute-granularity backfill and second-granularity live stepping produce identical windows — this is what lets cold-start priming share the live code path.

Not yet covered: frame merging (lives in backtest), the web app.

**Typecheck does not catch server/client boundary violations.** Calling a `"use client"` export from a server component compiles fine and fails at request time with a 500. After touching `layout.tsx` or anything it imports, load the page (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`).

## Turnover Floor (`MIN_QUOTE_VOLUME`) — measured, unresolved

`MIN_QUOTE_VOLUME` (50,000 USDT) silently determines small-cap behavior and was never validated. Extraction now emits all alerts regardless of volume (`EXTRACT_MIN_QUOTE_VOLUME = 0`); `CrossingStream` carries `quoteVolume` per crossing; `turnover.ts` measures lift (post-alert price movement vs. random-time same-symbol baseline) across log-spaced buckets (0–1K, 1K–5K, 5K–20K, 20K–50K, 50K–200K, 200K–1M, 1M–5M, 5M+), at both 1-minute and 5-minute horizons (5-minute needed because small-cap 1-minute baseline movement is exactly 0 — a random minute usually has no trades — making lift undefined at 1 minute).

**Majors, 1-minute horizon, slider 26** — lift rises monotonically with turnover:

| Window turnover | Alerts | Lift |
|---|---|---|
| 20K–50K | 21 | 0.21x |
| 50K–200K | 60 | 1.18x |
| 200K–1M | 110 | 1.74x |
| 1M–5M | 193 | 2.20x |
| 5M+ | 173 | 3.17x |

This holds within-symbol too (e.g. LINK 0.21x→3.34x, BTC 1.17x→2.74x across its buckets), so it isn't just "big coins move more." **The current 50K floor is too low for majors** — it admits the near-noise 50K–200K band.

**Small caps (ANKR/ONE), 5-minute horizon**: below ~5K turnover, lift is ≈1.0x (noise) on every symbol measured — the floor is evidence-backed at the bottom end. Above 20K the small-cap buckets hold only 2–7 alerts each, too thin to place an exact boundary; don't read the 5-minute aggregate row as a trend (it's skewed by single outliers).

**What looked like a per-symbol quality difference (LINK 1.29x vs. ETH 2.90x) turned out to be turnover composition, not a symbol effect** — within a matched turnover bucket LINK is never the worst symbol; it just has 90% of its alerts in low-turnover buckets (vs. 0% for BTC) where every symbol is weak.

**Not yet decided** — a single absolute floor does two unrelated jobs ("is this tradeable" vs. "is this signal real") and can't satisfy both:
- Raise toward 200K — best average quality, effectively drops small caps from the product
- Scale the floor to each symbol's own typical turnover — fits the existing percentile philosophy, needs its own measurement
- Keep it low and surface turnover in the UI — pushes the judgment to the user

`MIN_QUOTE_VOLUME` remains **50,000** pending this product decision. This is a decision for the user to make, not to be chosen unilaterally.

## Alert Quality (measured)

**Method** (`apps/backtest/src/quality.ts`): for each alert, measure max absolute price excursion over the next 1/5/15/60 minutes vs. 20,000 random seconds from the same symbol/period. Uses `Math.abs(price/base - 1)` (unsigned) because volume spikes have no direction — signed returns cancel to ~0 regardless of whether the algorithm works. Random sampling is seeded for reproducibility.

**Result — signal responds monotonically to threshold** (majors, 1-minute horizon):

| Slider | Alerts/day | Lift vs random |
|---|---|---|
| 72 | 24.4 | 1.37x |
| 43 | 5.5 | 1.78x |
| 26 | 2.2 | 2.29x ← default |
| 8 | 1.0 | 2.55x |
| 1 | 0.8 | 2.88x |

**Constraints this puts on the product:**
1. **Direction is a coin flip** (43–55% up across symbols/horizons) — this is a "something is happening" alert, never a "buy" signal.
2. **Signal is short-lived** — lift decays monotonically with horizon (BTC ~1.06x at 60 min, indistinguishable from noise).
3. **Median moves are small relative to fees** — BTC median 1-min move was 0.06%, under a round-trip taker fee. Value lives in the tail (31–42% of alerts land in the top decile of random moves) and in volatile alts (0.5–2% moves).

**Hour-of-day confound** (`hour-matched.ts`): alerts cluster in active trading hours; the original baseline sampled uniformly across 24h. Rebuilding the baseline per UTC hour and comparing each alert only to its own hour:

| Horizon | Uniform | Hour-matched | Change |
|---|---|---|---|
| 1 min | 2.30x | 2.08x | −9% |
| 5 min | 1.66x | 1.66x | 0% |
| 15 min | 1.44x | 1.48x | +3% |
| 60 min | 1.39x | 1.28x | −8% |

The confound is real but small (≤9%). **`SENSITIVITY_DEFAULT` (slider 26) survives the pre-registered 2x bar at 2.08x, but with little margin** — loosening further would drop below 2x.

Known limitation: does not control for weekday/weekend or scheduled events (FOMC, etc.) — hour-of-day is the largest systematic bias identified so far.

## Label-Based Measurement — the detection rule is misaligned

Every measurement before this used a yardstick the algorithm invented for itself (lift vs. random, alerts/day). On 2026-07-30 the user marked a BTC 15-minute chart with "this much volume should alert." Converting the marks to numbers gives the first external criterion:

> **15m bar quote volume ≥ 4× the median of the previous 32 bars** — which occurs 4.17×/day, matching the ~4.2/day the user actually marked.

`apps/backtest/src/label-fit.ts` scores any config against this: recall (labeled events caught), precision (alerts landing on labeled events), and latency (seconds from event start to first alert — recall alone can't see lateness, which was the user's actual complaint).

**This is what drove the rewrite.** BTC, 61 days:

| Config | Alerts/day | Recall | Precision |
|---|---|---|---|
| Old: percentile, 6-frame max, slider 26 | 2.7 | 25% | 44% |
| Old: percentile, 6-frame max, slider 43 | 6.7 | 39% | 28% |
| **New: trailing 15m window, ratio 4×** | **3.9** | **64%** | **74%** |
| User's criterion implemented directly (ceiling) | 6.7 | 98% | 66% |

Fewer alerts, 1.6× the recall, 2.6× the precision. The ceiling row shares the label's window length and statistic so it flatters itself — but that is the point: the criterion is trivially computable, and the old pipeline was not computing it.

Ratio choice on BTC: 3× → 63%/40%, **4× → 64%/74%**, 5× → 48%/93%, 6× → 29%/92%. Below 4× precision collapses; above it recall does.

**Open: latency.** Median time from event start to first alert is ~460s (7.7 min) — a 15-minute trailing window cannot fill faster. The 5m frame reacts in ~120s but lands at 26% precision. The user's stated want ("it should have fired at 21:14") is faster than this.

At an identical 6.7 alerts/day, directly computing "trailing 15-minute volume ÷ median of the last 32 such windows" gets **98% recall vs. 39%**. Holds on every symbol (recall 97–99%, precision 66–77%). The comparison flatters the reference — it shares the label's window length and statistic — but that is the point: the criterion is trivially computable and the elaborate pipeline is not computing it.

**Multi-frame max was actively harmful.** Isolating single frames on BTC at ~4 alerts/day (percentile rule, pre-rewrite):

| Frame | Alerts/day | Recall | Precision |
|---|---|---|---|
| 1m (slider 26) | 2.0 | 17% | 38% |
| 5m (slider 56) | 3.8 | 30% | 37% |
| **15m (slider 72)** | **4.0** | **36%** | **41%** |
| 1h (slider 72) | 1.2 | 19% | 63% |

The 15m frame **alone** beats the 6-frame max (which gets 32%/34% at that rate). Taking the max across frames at one percentile lets the noisiest frame win — in production all 10 live alerts had scale 1m or 5m, never longer.

**Root cause, now fixed: partial-window velocity.** Windows were judged on `quoteVolume / (elapsed/60)` from `MIN_ELAPSED_SECONDS` onward — 10s for 1m, 60s for 15m. Extrapolating 10 seconds to a minute (×6) produces far more variance than the completed-window baseline it was compared against. Measured on live alerts: at elapsed 10s the reported ratio was ~4× the completed candle's true ratio; at 48s, 1.2×. `aggregator.test.ts` has a regression test pinning this ("짧은 버스트를 창 전체로 외삽하지 않는다").

## Event-Based Merge (fixed 2026-07-30)

`EVENT_GAP_SECONDS` (was `FRAME_MERGE_WINDOW_SECONDS`, 900 → 300). The old rule muted for N seconds after the last **alert**; the new rule ends an event when the signal has been below threshold for N seconds, keying off the last **crossing**. One alert per event.

The old rule let a small alert bury a larger event: on 2026-07-29 a 3.2× alert at 21:01:24 threw a 900s throttle, suppressed the genuinely larger 21:14 event, and released at 21:16:24 — exactly 900s later. `event-scale.ts`'s `collectEvents` already used the correct sliding-gap grouping; only the alert path diverged.

**Aggregate effect is negligible** (BTC recall 25%→25% at slider 26). It fixes a real timing pathology but is not what is wrong with the detector. `engine.ts` keeps a `legacyThrottle` flag purely for this before/after comparison.

## Ratio-Based Testing (2026-07-30)

The label-based measurement discovered that the user's actual criterion is ratio-based: "alert when volume ≥ 4× the median of trailing windows." The percentile-based pipeline doesn't compute this directly. Added backtest instrumentation to evaluate ratio-based thresholds alongside percentiles:

- **`engine.ts` `ratioThreshold` mode**: runs the same evaluation logic but compares `volume / medianVolume` against `ratioThreshold` instead of percentile against sensitivity. Disables cooldown (per-event merging already deduplicates). Tracks both `bestValue` (winning ratio) and `bestPercentile` (for comparison).
- **`replay.ts` + `aggregator.ts`**: emit `ratios` array (volume relative to baseline) parallel to percentiles. Baseline uses boundary-aligned windows (epoch-aligned, no lookback offset) for stability; evaluation uses trailing windows (last 60s, etc.) for responsiveness.
- **Methodology**: run both modes at identical rates (e.g., "~6.7 alerts/day") and compare recall/precision against the user's manually-labeled criterion.

Expected outcome: if ratio mode outperforms percentile, the detector's core logic may pivot from percentile-based to ratio-based thresholds, with a simpler channel model (just "multiply by N" instead of "percentile slider").

## Known Gaps & Next Steps

1. **Alert quality** — ✅ measured, hour-of-day confound controlled (2.08x corrected). Open: confirmation on 2–3 more symbols; hit-rate targets for a product callout.
2. **`MIN_QUOTE_VOLUME`** — ✅ measurement infrastructure + two rounds of data (see § Turnover Floor). Open: the product decision on where/how to set the floor.
3. **Detector pipeline** — ✅ complete end-to-end. Open: confirm alert rate with a multi-day real-time run; measure user retention/engagement.
4. **Ratio vs. percentile** — 🔄 backtest instrumentation in place (2026-07-30); ready for comparative evaluation.
5. **Storage** — ✅ schema, auth, channel persistence, push subscriptions, alert logging, password reset. Open: alert retention policy (table grows unbounded).
6. **Web UI** — ✅ MainApp, ChannelCard, ChannelForm, CoinIcon, AuthDialog + password reset, Web Push subscription, service worker, ko/en toggle, alert history view (all complete).
7. **Deployment** — Vercel connected and building. `apps/detector/deploy/` (systemd unit + `setup.sh`) ready for Oracle Cloud; needs the user to provision a VM and run it. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` still needs to be added to Vercel's env vars for push to work on the deployed site.
8. **Backtest tools** — ✅ `event-scale.ts` (scale markers + channel rate curve), `quality.ts`, `hour-matched.ts`, `turnover.ts`, `label-fit.ts` (label-based scoring) all in place.

Deferred until the web app is complete: mobile app development (React Native/Expo, iOS + Android).
