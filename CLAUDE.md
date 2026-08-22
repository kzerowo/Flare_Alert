# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

_Last updated: 2026-08-22 23:14_

## Project Overview

**Flare Alert** is an adaptive volume-spike alert service for cryptocurrency traders. Users create **channels**; each channel watches one coin at one sensitivity level. A channel fires when trailing turnover reaches N× the median of recent comparable windows — a ratio, not a percentile, because that is the number a user can verify against a chart.

**The market is Binance USD-M perpetual futures, not spot.** This is load-bearing, not a detail — see § Futures, Not Spot. Every measured constant in this repo is futures-derived; spot numbers are not comparable and none survive.

**The sensitivity slider is a continuous 1–100 axis that sets alert frequency.** See § Continuous Sensitivity. The bar length snaps to one of five values (the aggregator only computes six fixed frames per symbol); the ratio moves continuously within each band. A timeframe is never an evaluation axis chosen by the algorithm — it follows from where the user put the slider. `docs/algorithm.md` predates the ratio rewrite entirely and describes a percentile pipeline that no longer exists — do not treat it as current.

**Percentiles never made alert frequency predictable.** Evaluation runs every second, so "top 5% of seconds" is not "5% of events" — a single event crosses the threshold for hundreds of consecutive seconds. This is why the percentile axis was abandoned.

Distribution is via **native mobile apps** (App Store/Play Store) once the web app is complete — not Telegram. Web Push (RFC 8291 + VAPID) is the current delivery mechanism; mobile push comes later.

## Tech Stack

- **Monorepo**: pnpm workspaces (pnpm 11, Node ≥22.9 — `--env-file-if-exists` for environment loading)
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
│   │   │   ├── fetch-futures.mjs   # Download futures daily aggTrades (CURRENT)
│   │   │   ├── prepare-futures.mjs # aggTrades → 1s buckets → compact binary (CURRENT)
│   │   │   ├── label-bars.mjs      # Expand any timeframe's bars for user labelling
│   │   │   ├── fetch-klines.mjs  # DEAD: spot 1s dumps
│   │   │   ├── prepare.mjs       # DEAD: spot 1s CSV → compact binary
│   │   │   ├── label-window.mjs  # Expand a user-labeled hour minute-by-minute (REST)
│   │   │   ├── minute-rate.mjs   # Alerts/day at the 1m scale over N days (REST)
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
│       │   ├── page.tsx            # Service introduction landing page
│       │   ├── app/
│       │   │   └── page.tsx        # Main app: AuthProvider > ChannelStoreProvider > AlertStoreProvider > MainApp
│       │   └── admin/
│       │       └── page.tsx        # Admin panel (placeholder)
│       ├── src/middleware.ts       # Supabase session refresh (only place cookies can be written)
│       ├── src/components/
│       │   ├── landing/
│       │   │   ├── Landing.tsx            # `/` page body: hero, why, how, slider, pricing, FAQ
│       │   │   ├── LiveTape.tsx           # Scripted animated turnover tape + alert card
│       │   │   ├── ScaleCompare.tsx       # One bar array at two scales — why a ratio travels
│       │   │   └── AuthForward.tsx        # Forwards Supabase auth callbacks from `/` to `/app`
│       │   ├── MainApp.tsx                # App root: nav, hero, tabbed channels/alerts view, error banner
│       │   ├── AlertHistory.tsx           # Alert history display with channel filtering and deletion
│       │   ├── ChannelCard.tsx            # Edit/delete/toggle actions; history button
│       │   ├── ChannelForm.tsx            # Create/edit UI: single-coin radio group + sensitivity slider
│       │   ├── CoinIcon.tsx               # Coin symbol → SVG icon or fallback color dot
│       │   ├── AuthDialog.tsx             # Login/signup against Supabase Auth, incl. forgot-password; Google sign-in
│       │   ├── ResetPasswordDialog.tsx    # Password reset via PASSWORD_RECOVERY event
│       │   ├── MyPageDialog.tsx           # Account settings and account deletion
│       │   ├── SensitivitySlider.tsx      # Interactive sensitivity control with frame-standard tick marks
│       │   ├── SensitivityTest.tsx        # Label real charts to find your own sensitivity level
│       │   ├── VolumeChart.tsx            # Clickable turnover bars (volume only, linear, no baseline)
│       │   ├── LanguageToggle.tsx         # ko/en segmented control
│       │   ├── Icon.tsx                   # Inline SVG icons
│       │   └── landing/
│       │       ├── Landing.tsx            # Service introduction page: hero, feature showcase, pricing, FAQ
│       │       ├── AuthForward.tsx        # Authentication callback forwarding: Supabase auth results → /app
│       │       ├── LiveTape.tsx           # Landing hero demo component: simulated real-time ticker with animated alerts
│       │       └── ScaleCompare.tsx       # Scale comparison visualization: large vs. small coin transaction volumes at different scales
│       └── src/lib/
│           ├── locale.ts                  # Locale primitives — NO "use client" (server reads these)
│           ├── i18n.tsx                   # Dictionaries + LocaleProvider + useT()
│           ├── auth.tsx                   # AuthProvider over Supabase Auth, incl. password reset
│           ├── alerts.tsx                 # AlertStoreProvider: fetch + Realtime subscription
│           ├── channel-store.tsx          # Guest (sessionStorage) / member (Supabase) dual mode
│           ├── push.ts                    # Web Push subscription: request permission, subscribe, persist
│           ├── test-charts.ts             # Sensitivity test: random non-overlapping futures windows via REST
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
│       ├── sensitivity-test.ts # Chart labels → threshold ratio (F1) → slider level
│       └── sensitivity.test.ts
├── supabase/migrations/
│   ├── 0001_init.sql            # profiles / channels / channel_symbols + RLS
│   ├── 0002_alerts_and_push.sql # push_subscriptions / alerts tables + RLS, drops Telegram
│   ├── 0003_channel_scale.sql   # channels.sensitivity (percentile) → channels.scale (bar length)
│   ├── 0004_channel_sensitivity_level.sql  # channels.scale → channels.sensitivity_level (1~100)
│   └── 0005_delete_own_account.sql  # Adds account deletion RPC; deletion cascades to channels/alerts/subscriptions
├── apps/detector/deploy/        # systemd unit + setup.sh for Oracle Cloud deployment
├── docs/                        # Korean planning docs (algorithm/architecture/research/decisions/deploy)
├── data/                        # Backtest data — gitignored, ~3.4GB
│   ├── futures-aggtrades/       # Raw daily aggTrades zips (3.2GB)
│   ├── prepared/                # Per-second binaries + manifest (182MB)
│   ├── crossings/               # Extraction cache — DELETE when data source changes
│   └── labels/                  # User chart labels (keep; hand-made, not regenerable)
└── apps/web/vercel.json         # Vercel build config: monorepo build (core first, then web)
```

## Plans & Admin (implemented 2026-08-16)

**Free = 3 channels, Pro = unlimited, admin = always Pro.** Price is provisionally $4/mo; billing is not built.

`profiles` carries three new columns (`0006`): `plan` (`free`/`pro`), `role` (`user`/`admin`), `plan_expires_at` (nullable). **`plan` and `role` are separate axes on purpose** — an admin is someone who operates the service, not someone who paid. Folding them into one column would count admins as paying users the moment billing lands.

`packages/core/src/plan.ts` is the source of truth for three rules, and `0006`'s `effective_plan()` / `channel_limit_for()` are the SQL translation of the same rules:

1. `role = 'admin'` → always Pro.
2. `plan = 'pro'` with `plan_expires_at` in the past → Free.
3. Free → `FREE_CHANNEL_LIMIT` (3). Pro → `null`, meaning unlimited.

Unlimited is `null`, never a large number — the UI has to render "unlimited" differently from "999", and a sentinel number erases that distinction.

**The limit is enforced by a DB trigger, not by the UI.** The web queries Supabase directly with the public anon key, so hiding the button is not a defense — a free user can insert 100 rows from devtools. `channels_enforce_limit` (BEFORE INSERT) raises `channel_limit_reached`, and `channel-store.tsx` matches on that string to show the right message. The client-side check exists only so the user learns about the limit before filling in a form.

**A user updating their own `profiles` row was a one-line privilege escalation.** `0001`'s "본인 프로필만 다룬다" policy is `for all`, so `update profiles set plan='pro', role='admin' where id=auth.uid()` would have worked. `profiles_guard_privileges` (BEFORE UPDATE) blocks changes to those three columns; `locale` stays user-editable. **The guard keys off `auth.uid()`, not `current_user`** — the function is SECURITY DEFINER, so `current_user` always reads as the owner and a `current_user`-based check would silently never fire. `auth.uid()` comes from the request JWT and is unaffected, which also makes the SQL editor and service_role (future billing webhook) pass through as intended.

**Admin access is RPC-only** — `admin_list_users`, `admin_set_plan`, `admin_stats`, each gated by `is_admin()` inside. No blanket "admins can read everything" RLS policy exists, because that is hard to walk back. Emails live in `auth.users`, which cannot carry policies, so a SECURITY DEFINER function was required for listing regardless.

**Downgrade does not delete channels.** The trigger only guards inserts, so a demoted Pro user would otherwise keep all their channels running. `admin_set_plan` keeps the oldest N (by `created_at`) and sets `enabled = false` on the rest; the detector reads `enabled = true` only. Re-upgrading does *not* re-enable them — there is no way to tell a system-disabled channel from one the user switched off, and wrongly switching one back on is worse.

**Guests are treated as Free.** They have no profile row, so `DEFAULT_MEMBERSHIP` applies. This matters at the guest→member migration: without it, a guest could build ten channels and have seven rejected by the trigger on first login. The migration loop now stops at the first limit rejection, keeps what fit, clears sessionStorage anyway (otherwise every refresh replays the same rejection), and raises `StoreProblem: "limit"`.

**Roles cannot be changed from the UI.** Promoting an admin is rare and hard to reverse (an admin can demote themselves and leave nobody with access), so it is a SQL-editor operation. `0006` bootstraps the first admin by email at the bottom of the file — the chicken-and-egg case, since `admin_set_plan` requires an existing admin.

`ProfileProvider` sits between `AuthProvider` and `ChannelStoreProvider` (the store needs the limit, which comes from the plan). It assumes Free while loading and on read failure — the opposite default would briefly open the create button and then have the DB reject the result.

**Not applied to the live database yet.** `0006` must be run in the Supabase SQL editor before the plan columns resolve. Until then `ProfileProvider` fails its read, falls back to Free, and every account is limited to 3 channels.

## Storage (Supabase)

Five tables: profiles, channels, channel_symbols, push_subscriptions, alerts; RLS on all of them.

**`channel_symbols` is a separate table, not an array column on `channels`.** The detector's per-second question is "which channels watch BTCUSDT" — a reverse lookup an array/jsonb column can't index. The child table carries an `(exchange, symbol)` index for exactly this path.

**`channels.sensitivity_level` (int 1–100) is the single stored sensitivity value.** Both detection inputs — window length and ratio — derive from it via `sensitivityAt()`. Storing the window separately would let the two drift, and a drifted pair makes the "alerts/day" on screen a lie.

Three generations of this column now exist. `0003` moved percentile → `scale`; `0004` moves `scale` → `sensitivity_level`. Each migration leaves its predecessor in place (nullable) rather than dropping it, because during a rolling deploy old code still writes it. Delete them in a later migration once nothing reads them. The web write path still fills `scale` alongside `sensitivity_level` for the same reason.

Three read paths must stay in agreement on the fallback chain `sensitivity_level` → `levelForScale(scale)` → `levelForScale(percentileToScale(sensitivity))` → `DEFAULT_SENSITIVITY_LEVEL`: `detector/store.ts`, `web/lib/supabase/channels.ts`, and `web/lib/channel-store.tsx` (guest sessionStorage, which can hold pre-migration shapes indefinitely).

**The band anchors are hardcoded in `0004` and in `levelForScale()`.** A test pins them together; changing one side alone silently moves every stored user setting.

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
  → the CHANNEL'S OWN frame, ratio ≥ that frame's ratio → min-turnover + warmup
  → Event-gap merge (one alert per event) → Web Push dispatch
```

**Windows are trailing, not boundary-aligned partials.** The judged value is always "the last W seconds," so it is never extrapolated. The old design divided an aligned window's accumulated volume by elapsed minutes starting at `MIN_ELAPSED_SECONDS` — 10s for the 1m frame — which multiplied a 10-second sample by 6 and compared it against a distribution of completed windows. Measured on live alerts, that inflated the reported ratio ~4× at elapsed 10s (1.2× at 48s), so alerts fired where the chart showed nothing. `MIN_ELAPSED_SECONDS` is now unused by the detection path.

**Each channel decides on its own frame** — `channel.scale`, set by the user's slider. All six frames are still computed per symbol (that work is channel-independent), and `decide()` picks its slice by the channel's scale. The remaining frames only label the alert's scale: the longest frame that also cleared the same ratio, floored at the channel's own frame.

**The threshold is a ratio, not a percentile.** "Turnover over the last W is ≥ N× the median of the previous 32 such windows," where W is the channel's frame and N comes from `SENSITIVITY_SCALES`. This is the number the user can verify against a chart. `channels.scale` stores W directly — no runtime reinterpretation.

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

**The slider is 1–100 and sets alert frequency. Bar length snaps; the ratio moves continuously.**

`SENSITIVITY_SCALES` in `constants.ts` holds the five measured **anchors**, which now sit at the right edge of each 20-wide band:

**The rule is one number: 3.5×, with 1m as the sole exception.**

| Level | Bar | Ratio | Alerts/day |
|---|---|---|---|
| 20 | 4h | 3.5× | 0.28 |
| 40 | 1h | 3.5× | 1.2 |
| **60 (default)** | **15m** | **3.5×** | **4.8** |
| 80 | 5m | 3.5× | 14 |
| 100 | 1m | 5.0× | 50 |

3.5× is the value that catches **100% of the user's own futures 5m labels** (14 marks over 2026-08-02~03). It is the only futures-validated number, so every other bar simply reuses it.

That works because a constant ratio spreads the rates by ~4× per step on its own (0.28 → 1.19 → 4.84 → 14.06). There was never evidence for per-bar ratios; the measurement says they aren't needed. 1m is the exception only because 3.5× there yields 82/day, collapsing the spacing — 5.0× restores the ~3.5× step.

**Dead: choosing target rates first and back-solving the ratio.** The old ladder (0.3/1/4.2/10/30) was round numbers with no backing, and it disagreed with the user's own labelled 5m rate (14/day). Ratio is now the evidence; rate is the consequence.

Measured on **futures**, 3 majors, 2026-05-01~07-31 minus 30 warmup days = 62 measured days. Both earlier rows — spot (3.0/3.4/3.6/4.5/8.4) and the first futures pass (3.4/3.8/3.9/4.6/7.1) — are dead.

Bands: `1–20 → 4h`, `21–40 → 1h`, `41–60 → 15m`, `61–80 → 5m`, `81–100 → 1m`.

- **The anchor ratio is the floor for each bar, never a midpoint.** Within a band the ratio only rises above the anchor as you go quieter. Going *looser* than an anchor would leave the measured region (the crossing cache retains ratio ≥ 3 only), so the axis never does it.
- **`alertsPerDay` is read from a measured curve, not a formula.** `SCALE_RATE_CURVES` holds a dense ratio → alerts/day sweep per bar, produced by `pnpm --filter @flare-alert/backtest start dense`. Log-log interpolated. Majors only (BTC/ETH/SOL); small caps run 2–3× higher.
- **Rate is continuous and monotone across all 100 positions**, including at band boundaries where the bar switches — a band's left edge is defined by inverting *its own* curve at the previous anchor's curve-evaluated rate, not at the rounded table value. Pinning it to the rounded value made rate step *backwards* at 21/41/81. Tests cover this.
- Exports: `sensitivityAt()`, `levelForScale()`, `SENSITIVITY_LEVEL_MIN`/`_MAX`, `DEFAULT_SENSITIVITY_LEVEL`, `SENSITIVITY_RATE_FLOOR`.
- The five-stop API (`scaleAt`, `scaleIndexOf`, `scaleRatio`, `scaleAlertsPerDay`, `SCALE_MIN`/`SCALE_MAX`) still exists and still backs `levelForScale`/migration. The older percentile/ratio slider (`sliderToRatio`, `percentileToSlider`, `CHANNEL_RATE_CURVE`, `RATIO_DEFAULT`, `FRAME_SCALE_PERCENTILE`, `DETECTION_TIMEFRAME`) remains `@deprecated` — the backtest's comparison path and `percentileToScale()` need it.

**Why the bar can't also be continuous**: `aggregator.ts` builds exactly the six `TIMEFRAMES` per symbol and `decide()` selects its slice by exact timeframe match. That per-symbol sharing is the "expensive part computed once" split (decisions.md 10). Arbitrary window lengths would need per-channel windows and baselines. This was a deliberate product call (2026-08-03), not an oversight.

**`percentileToScale()` is the migration bridge** and must stay in lockstep with `supabase/migrations/0003_channel_scale.sql`, which hardcodes the same four percentile boundaries (99.9785 / 99.9002 / 99.5360 / 97.8454). A test pins them together; changing one side alone silently moves every stored user setting.

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
6. Each alert shows absolute date+time (YYYY-MM-DD HH:MM:SS, static) and relative time (updates every 60s). The date uses a fixed manual format, not `toLocaleDateString` — locale date formats vary too much in width for the numeric-font no-layout-shift goal.
7. Price precision adapts to magnitude: ≥100 → 2 decimals, ≥1 → 4 decimals, <1 → 8 decimals.
8. Deletion is optimistic — UI removes immediately, then sends DELETE; failure doesn't restore the row.
9. Empty states differ for guest (accounts required), load failure, and genuinely-empty (full list vs. single channel).

Realtime (tab open) and Web Push (tab closed) are complementary, not duplicative — Realtime subscription ends when the tab isn't open, which is exactly when push takes over.

### Score Semantics

`computeScore` returns `number | null`. `null` means MAD is 0 — the symbol traded at a constant (usually zero) rate across the lookback, so no meaningful score exists. Callers must not coerce this to a large number, or dead altcoins would dominate every alert list. Common: 1m frames on ANKR/ONE return null 65–74% of the time.

## Parameters

| Constant | Value | Note |
|---|---|---|
| `SENSITIVITY_SCALES` | 5 rows | Measured anchors, one per bar. Now the right edge of each slider band; see § Sensitivity Model |
| `SCALE_RATE_CURVES` | 5 curves | Dense ratio → alerts/day sweep per bar. What the slider reads to show a frequency |
| `DEFAULT_SENSITIVITY_LEVEL` | `60` | 15m, 3.6×, ~4.2 alerts/day on majors — the point the user's own chart labels landed on |
| `SENSITIVITY_RATE_FLOOR` | 0.15 | Quiet end of the slider. Below this `describeAlertRate` reads "거의 없음", which looks broken |
| `DEFAULT_SCALE` | `15m` | Still used by `percentileToScale` fallbacks |
| `SCALE_TIMEFRAMES` | 5 frames | `1d` deliberately absent; see § The 1d scale does not exist |
| `EVENT_GAP_SECONDS` | 300 | Silence below threshold that ends an event |
| `LOOKBACK_WINDOW_COUNT[tf]` | 60/48/32/24/18/14 | Windows the median baseline is drawn from, per frame |

Deprecated but still exported (backtest comparison + migration only): `DETECTION_TIMEFRAME`, `RATIO_DEFAULT`, `RATIO_AT_SLIDER_MIN`/`_MAX`, `CHANNEL_RATE_CURVE`, `FRAME_SCALE_PERCENTILE`, `SENSITIVITY_DEFAULT`.

Still `TODO(backtest)` in `constants.ts`: `LOOKBACK_WINDOW_COUNT`, `MIN_QUOTE_VOLUME`, `PERCENTILE_HISTORY_DAYS`, `MIN_PERCENTILE_SAMPLES`, `MAD_FLOOR_RATIO`. `MIN_ELAPSED_SECONDS` and the `COOLDOWN_*` constants are now dead for the detection path — kept only for the backtest's percentile comparison path.

## Common Development Commands

```bash
pnpm install
cp .env.example .env

pnpm dev:web                # builds core, then next dev on :3010 (pinned — see apps/web/package.json)
pnpm dev:detector           # builds core, then runs detector (live Binance)

pnpm test                   # 144 tests (133 core + 11 detector)
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

`/health` returns 503 until backfill finishes, then 200 with per-symbol warmup and sample counts.

**Detection works without any credentials — delivery does not.** Binance's public endpoints need no auth, so the detector boots and detects happily with an empty environment. But with no `SUPABASE_*` it runs in standalone mode (ignores every user channel, watches `DETECTOR_SYMBOLS` instead), and with no `VAPID_*` it prints alerts to the console instead of pushing them. Both states are survivable by design, and both mean **no user ever receives anything.**

This was a production issue: `start` was `node dist/index.js` with no `--env-file`, so `pnpm start` silently ran fully unconfigured while `.env` sat right there populated. Every script that needs the environment now passes `--env-file-if-exists=../../.env` (Node ≥22.9; systemd supplies its own env via `EnvironmentFile=` and invokes `node` directly, so it is unaffected). Boot also prints an unmissable banner when both Supabase and VAPID are absent — this combination means alerts never reach users, and the warning prevents mistaking the normal-looking log for proper operation. If alerts are not arriving, read the first five lines of the boot log before anything else.

### Backtesting

```bash
# Futures aggTrades (current). Complete months only — see § Futures, Not Spot.
node scripts/fetch-futures.mjs --symbols BTCUSDT,ETHUSDT,SOLUSDT --from 2026-05-01 --to 2026-07-31
node --max-old-space-size=4096 scripts/prepare-futures.mjs   # → data/prepared, 182MB

pnpm --filter @flare-alert/backtest build
pnpm --filter @flare-alert/backtest start         # extract + sweep
```

`fetch-klines.mjs` / `prepare.mjs` are the **spot 1s-kline** path and are dead — kept only as reference for the binary format.

**Deleting `data/crossings/` is mandatory whenever the underlying data changes** (market, symbols, or date range). `MAGIC` only guards the cache *format*, so a data-source change is silently reused otherwise — which would quietly reproduce spot-era numbers.

Crossing extraction takes ~1 minute/symbol, cached to `data/crossings/`. Subsequent runs sweep parameters in seconds. Bump `MAGIC` in `crossings.ts` if the cache format changes (currently `FLARE-CROSSINGS-4`).

`start` takes an optional stage so you don't re-run everything: `scale` (window × ratio → alerts/day), `curve`, `label`, `quality`, `turnover`, `hour`. Default `all`.

**The crossing cache only retains `ratio ≥ 3` (or `percentile ≥ 89`).** Sweeping below 3× reads as artificially quiet; lower `EXTRACT_MIN_RATIO` in `index.ts` and bump `MAGIC` first.

```bash
# Recent data via public REST — data/prepared is monthly dumps and lags the current month.
node scripts/label-window.mjs --start "2026-07-30 13:29 KST" --before 5 --after 72
node scripts/minute-rate.mjs --days 14
```

`label-window.mjs` expands one hour minute-by-minute with both candidate baselines side by side, for matching against a screenshot the user marked up. `minute-rate.mjs` counts alerts/day at the 1m scale over N days. Neither needs an API key; both write nothing except `data/labels/`.

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
- `BINANCE_WS_URL` — defaults to `wss://fstream.binance.com/market/ws` (**USD-M futures**, not spot). **The `/market` segment is load-bearing** — the legacy `/ws` path was retired 2026-04-23 and now fails silently: it accepts the connection, acknowledges `SUBSCRIBE` with `{"result":null}`, lists the subscription back, and never pushes a trade. See § Silent Stream Death.
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

`packages/core`: 133 tests (`node:test`) — math primitives, baseline/score edge cases, percentile accuracy vs. exact sorted ranks, day-based sample eviction, cooldown behavior, slider↔percentile round-trips, scale markers, alert-rate description thresholds, the five-stop scale axis (monotone rate/ratio, `1d` excluded, index↔bar round-trip, percentile→scale boundaries pinned against migration 0003), and the continuous 1–100 axis (anchors reproduced exactly at 20/40/60/80/100, rate monotone across all 100 positions **including band boundaries**, ratio monotone within a band, ratio stays inside the measured curve range, band anchors pinned against migration 0004, and curve↔table agreement), and the sensitivity test's label fitting (15 tests — baseline warmup gap, median-not-mean, band coverage, in-band results at both extremes, misclick rejection among a realistic 90-bar background, threshold landing between the two label groups, clamp direction at each band end, and result numbers matching what the slider shows at that level), and the plan axis (21 tests — admin outranks a stored `free`, expiry boundary treated as expired, unlimited stays `null` rather than a sentinel number, an already-over-limit count still refuses, and unknown plan/role strings degrading to free/user).

`apps/detector`: 11 tests — window alignment to absolute epoch boundaries, elapsed-time gating, velocity computation, late/early trade buffer, and (most importantly) that minute-granularity backfill and second-granularity live stepping produce identical windows — this is what lets cold-start priming share the live code path.

Not yet covered: frame merging (lives in backtest), the web app.

**Typecheck does not catch server/client boundary violations.** Calling a `"use client"` export from a server component compiles fine and fails at request time with a 500. After touching `layout.tsx` or anything it imports, load the page (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3010`).

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

## Scale-Driven Sensitivity (implemented 2026-08-03)

**The user rejected the fixed 15m detection window.** Their stated requirement, verbatim:

1. The liquidity criterion must not be "the 15-minute bar."
2. Timeframes must never be the evaluation axis — they are only a reference label saying "at this slider position, this is the bar length you're effectively watching."
3. Storage cost is acceptable; a very quiet sensitivity legitimately needs more history.

So the slider must move the **window length**, and the ratio follows from it. This inverts the current code, where the window is pinned at 15m and only the ratio moves.

### The evidence that led here was contaminated

The measurement that justified `DETECTION_TIMEFRAME = "15m"` (frame isolation: "15m alone beats the 6-frame max") was run **while the partial-window extrapolation bug was still live** — `git show 60a2fc8` removes `MIN_ELAPSED_SECONDS` and narrows to a single frame in the *same commit*. The 1m/5m frames were inflated ~4× at the time they were scored, which is exactly why the noisiest frame always won. **That verdict has never been re-tested under trailing windows.** Do not cite it as settled.

### Measured: scale × ratio → alerts/day

`pnpm --filter @flare-alert/backtest start scale`. Majors (BTC/ETH/SOL), 61 days, event gap = window length.

At a **fixed** 4×:

| Window | 1m | 5m | 15m | 1h | 4h | 1d |
|---|---|---|---|---|---|---|
| Alerts/day | 87 | 12 | 3.5 | 0.8 | 0.12 | **0.00** |

A fixed ratio does not work across scales. Inverting for a sane rate at each scale gives the **slider path**:

| Slider | Window | Ratio | Alerts/day |
|---|---|---|---|
| most sensitive | 1m | **8.4×** | 30 |
| | 5m | 4.5× | 10 |
| default | 15m | 3.6× | 4.2 |
| | 1h | 3.4× | 1 |
| quietest | 4h | 3.0× | 0.3 |

**The ratio is nearly constant (4.5×→3.0×) from 5m out to 4h.** Only the 1m end needs a distinctly higher bar, because short bars are intrinsically spikier. So "is R fixed or does it vary?" resolves to: *effectively fixed at ~3–4×, with 1m as the single exception.*

### The 1d scale does not exist

At **every** ratio down to 1.1×, a 1-day trailing window on majors produces ≈0 alerts (61 days, three symbols, not one occurrence at 3×). Aggregating a full day averages any spike away. **The slider's quiet end stops at 4h.** Remove `1d` from the scale options; `FRAME_SCALE_PERCENTILE["1d"]` ("slider 1, 0.6/day") is a percentile-era number that does not survive.

### The 1m end, confirmed twice independently

The user labeled a BTC 1-minute chart, **2026-07-30 13:29–14:41 KST** (first mark 13:29 KST = 04:29 UTC), instructed to mark "bars that stand out against the recent average," explicitly ignoring weekend/dead-hour absolute levels.

`node scripts/label-window.mjs --start "2026-07-30 13:29 KST" --before 5 --after 72` expands that hour minute-by-minute. 13:29 lands at rank 2 of the window (32.3× the 60-minute median), confirming the alignment.

Nine minutes stand out clearly: **13:24, 13:29, 13:38, 13:39, 13:44, 14:09, 14:14, 14:19, 14:25** (13:24 is likely off the left edge of the screenshot). Those are ≥8.3× the 60-minute median.

Naively extrapolating 9 marks / 72 min gives ~190/day, which contradicted the user's own "dozens per day." The user immediately flagged why: that was a deliberately *active* hour. Measuring 14 real days settles it (`node scripts/minute-rate.mjs --days 14`):

| Threshold | median-60 baseline | MA-20 baseline |
|---|---|---|
| 4× | 63.3/day | 40.6/day |
| **8×** | **28.7/day** | 14.9/day |
| 10× | 22.1/day | 11.1/day |

**median-60 at ~8.3× → 27.5 alerts/day.** This matches (a) the user's verbal "하루 몇십번", (b) the user's actual chart marks, and (c) the independent April–June backtest that put 1m@8.4× at 30/day. Three routes, one answer. `RATIO_AT_1M ≈ 8.4` is the best-supported constant in the project right now.

### Open: which baseline — rolling median or moving average?

The user described marking against "the recent average volume," which is the chart's volume MA (a fast, 20-period line), not the algorithm's 60-minute median (a slow, flat line). These diverge when volume ramps gradually: the median says "already 4× above normal," the MA says "neighbours are high too, nothing stands out."

**In the labeled hour the distinction did not matter** — both baselines select the same top 9 minutes, only reordered. But over 14 days they diverge sharply in rate (8.3× median = 27.5/day; 2.65× MA = 69.3/day).

**The decisive experiment is a label from a QUIET hour** — a weekend or dead session, which the user already planned as their second and third labeling passes. If the user marks bars there that median-60 misses (because everything is small in absolute terms) but MA-20 catches, the baseline must change. One active hour cannot separate them.

### Implementation (2026-08-03)

✅ Completed:

1. `packages/core/constants.ts`: `SENSITIVITY_SCALES` table replaces `DETECTION_TIMEFRAME`. Slider → `SensitivityScale` (timeframe/ratio/alertsPerDay) pair; `1d` removed.
2. `packages/core/sensitivity.ts`: `scaleAt()`, `scaleIndexOf()`, `scaleRatio()`, `scaleAlertsPerDay()`, `isScaleTimeframe()`, `percentileToScale()` (migration path), `SCALE_MIN`/`SCALE_MAX`.
3. `apps/detector/src/channel-runtime.ts`: reads `channel.scale` instead of `DETECTION_TIMEFRAME`; `decide()` picks its slice by scale; `widestScale()` is floored at the channel's own frame.
4. `packages/core/src/types.ts`: `Channel.scale: Timeframe` (new), `Channel.sensitivity` deprecated and optional.
5. `supabase/migrations/0003_channel_scale.sql`: migrates `channels.sensitivity` → `channels.scale` using the same percentile-band → timeframe mapping as `percentileToScale()`.
6. `SensitivitySlider.tsx`: five stops labelled by bar; the ratio is shown as supporting detail, not the control. `ChannelCard` and the `catchesFrom` strings follow.
7. Three independent read paths all fall back `scale` → `percentileToScale(sensitivity)` → `DEFAULT_SCALE`, so pre-0003 rows and stale guest sessionStorage keep working: `detector/store.ts`, `web/lib/supabase/channels.ts`, `web/lib/channel-store.tsx` (`normalizeChannel`).

8. **Event gap is now the channel's own bar length** (`channelEventGapSeconds`), not a flat 300s. A flat gap means different things per bar — 5 minutes of quiet does not end a 4h event, and 300s merges five separate 1m spikes. It also has to match how `alertsPerDay` was measured, or the number on screen is a lie.

**Verified**: replaying all five rows against the 61-day majors cache with the shipped rule reproduces the table within ±3% (4h 0.30, 1h 1.03, 15m 4.13, 5m 10.14, 1m 29.87). The rates shown in the UI are what the detector actually does.

Open (next):
- Quiet-hour label to settle median-vs-MA baseline (§ above). This is the only thing still unresolved in the sensitivity design.
- `alertsPerDay` is majors-only. Small caps run 2–3× higher and the UI does not say so.

## Futures, Not Spot (switched 2026-08-04)

**The detector watches Binance USD-M perpetual futures.** Spot was wrong and produced a year of uninterpretable measurements.

### How it was found

The user labeled two full days of 5-minute BTC charts (2026-08-02 and 08-03, 11:00–23:00 KST, 14 marked bars). Scored against **spot** data, no baseline could reproduce those marks — catching all 14 required descending to rank 63 of 144 bars (≈128 alerts/day, 11% precision). Every candidate failed: median 48/24/20/16/12/10/6 and mean at the same lookbacks.

The decisive counterexample was **2026-08-03 16:05**: on spot it was the day's largest bar (24.5M, 9.98× — rank 1 under *every* baseline), and the user had not marked it. On futures the same bar is 32.2M but **rank 42, ratio 1.29×** — utterly ordinary. The user was right and the data was wrong.

Switching data source alone, with the *existing* baseline (median-48), put all 14 labels inside the top 18 (≈36/day). 3.5× better, no algorithm change.

**A trap this created**: an earlier pass over the same labels concluded that a moving average beat the median and that this reversed decisions.md #1. That conclusion was an artifact of the wrong market — on futures, **median-48 is the best performer** and decisions.md #1 stands. Do not re-derive baseline conclusions from spot data.

### What changed

- `binance.ts`: REST `fapi.binance.com/fapi/v1`, `exchangeInfo` filtered to `contractType: PERPETUAL` (excludes quarterlies).
- `config.ts` / `.env` / `.env.example`: `wss://fstream.binance.com/market/ws`. (Originally written as `/ws`, which was already retired — see § Silent Stream Death.)
- `label-window.mjs`, `label-bars.mjs`, `minute-rate.mjs`: futures REST.
- aggTrade message shape is identical across both markets (`e/s/p/q/T`), so parsing is untouched.

### Backtest data: aggTrades, not 1s klines

**Futures has no 1-second kline dumps.** The finest kline is 1m — 60× too coarse for a rule evaluated every second. The replacement is **daily aggTrades**, which is *higher* resolution than the spot 1s klines it replaces (per-trade), and is the same data the live detector consumes.

Daily files average ~7MB/symbol; monthly files are ~668MB, so daily is both cheaper and resumable. 3 majors × 92 days ≈ 3.2GB raw → 182MB prepared.

`prepare-futures.mjs` buckets trades into per-second bins, emitting the **same binary format** as the old `prepare.mjs`, so `data.ts` and `replay.ts` are unchanged. It **refuses incomplete months** — a half-filled month leaves the remaining days at zero volume, which drags the median baseline down and silently inflates every ratio.

Parsing was validated against Binance's own 5m klines: totals matched to the **exact unit**, and the 7 bars (of 288) that differed were pure boundary assignment, compensating with their neighbours to a net of exactly 0.00.

### Open after the futures switch

1. ✅ **Resolved 2026-08-04** — the 5m anchor was stricter than the user's labels (64% recall at 4.6×). Fixed by dropping every anchor to the label-validated 3.5×, which restores **100% recall** and, as a bonus, replaced the unfounded target-rate ladder with a single rule. See § Sensitivity Model.

2. **`rejectedTurnover` is ~26% of frame-evaluations live, and it cannot be real.** Futures BTC never approaches `MIN_QUOTE_VOLUME` (50,000) — the smallest 1-minute window measured is 213,774, and futures crossing extraction reported **0 turnover cuts across 5.6M crossings**. Something else is incrementing that counter. Spot showed 0.5%.

3. **`evaluate()` runs once per channel, not once per symbol** ([service.ts:402-408](apps/detector/src/service.ts#L402-L408)). Five channels on BTCUSDT recompute all six frames five times per second (~30 frame-evals/sec observed). This contradicts decisions.md #10 ("compute the expensive part once per symbol") and also multiplies percentile-estimator samples. Wasteful rather than wrong for ratio-based firing, but it should be hoisted per symbol.

4. **All pre-2026-08-04 quality measurements are spot-derived** — alert quality/lift, hour-of-day confound, turnover floor buckets, label-fit recall/precision. Their *methods* stand; their *numbers* do not. Re-run before citing.

## Silent Stream Death (found and fixed 2026-08-06)

**The futures switch shipped with a retired WebSocket URL, and live detection was dead for two days without producing a single error.**

Binance retired the legacy USD-M futures stream paths on **2026-04-23**. `aggTrade` moved under the `/market` route:

```
dead: wss://fstream.binance.com/ws          ← accepts everything, pushes nothing
live: wss://fstream.binance.com/market/ws
```

The futures switch (`5e2f8a0`, 2026-08-04 01:31 KST) was written against the pre-retirement URL, so **futures live detection never worked at all.**

### Why nothing caught it

The legacy endpoint does not refuse the connection. Measured directly:

- TCP, TLS (valid `*.binance.com` cert, no interception), and the WS handshake all succeed.
- `SUBSCRIBE` returns `{"result":null,"id":1}` — the success response.
- `LIST_SUBSCRIPTIONS` echoes the subscription back as active.
- Zero market data, forever. Even `!markPrice@arr@1s`, which pushes unconditionally every second, returns nothing.

So every signal a process can check said "connected". The boot log printed `스트림 연결됨`, the 1-second clock kept ticking, and `evaluations.evaluated` climbed at the normal rate — because that clock is a local `setInterval` that runs whether or not trades arrive. The aggregator simply committed 0 volume every second, ratios never approached threshold, and the detector looked exactly like a quiet market.

### The alerts that "proved" it was working were restart artifacts

`alerts` rows fall into two shapes, and the seconds field separates them:

| `fired_at` seconds | Origin |
|---|---|
| arbitrary (`13:49:55`, `14:20:51`) | live WS detection |
| exactly `:00` | first tick after backfill |

After backfill, `#nextSecond` is set to `lastMinuteSecond + 60` — a minute boundary. That first live evaluation reads a trailing window still full of REST-backfilled data, so it can fire immediately, always landing on `:00`. Every subsequent second adds zero volume and the process goes silent for good.

**The last live alert was 2026-08-03 15:49:52 UTC — 42 minutes before the futures commit.** Everything after it was `:00`. The `:00`/arbitrary split is the fastest way to tell "the detector is working" from "the detector restarted."

The 1m channel never even produced a restart artifact, because the 1m frame is deliberately excluded from backfill priming (§ Detection Pipeline). That asymmetry is what made the bug present as *"only the 1m alerts stopped"* — the misleading symptom that framed the whole investigation.

### What was added

- `SymbolAggregator.ingestDiagnostics` — `lastIngestAtMs` / `ingestCount` / `droppedLateCount`, surfaced per symbol in `/health` alongside `lastPrice`. `ingestCount: 0` on a live process is unambiguous; nothing else in the old snapshot was.
- A silence watchdog in `service.ts` (`#startSilenceWatch`): if a watched symbol goes `STREAM_SILENCE_WARN_MS` (60s) with no trades, it logs an **error** naming the offending symbols and the configured `BINANCE_WS_URL`. Majors trade dozens of times a second, so a silent minute is never the market.

**Diagnosing this class of failure starts at `/health` → `symbols.<SYM>.ingest`.** A healthy detector's `ingestCount` climbs by hundreds every few seconds; `evaluations.evaluated` climbing proves only that the process is alive.

## Continuous Sensitivity (implemented 2026-08-03)

**The user rejected the five discrete stops as too coarse** — one step from 4.2 to 10 alerts/day is a 2.4× jump with nowhere to land in between. They asked for free choice across 1–100.

The decision taken: **ratio continuous, bar length snapped.** Making the bar continuous too would require per-channel windows and baselines, breaking the per-symbol frame sharing that decisions.md 10 exists to protect. The ratio is what actually sets frequency, so opening it alone delivers what the user asked for at a fraction of the cost.

### The old "must stay discrete" argument did not survive

CLAUDE.md previously justified five stops with "every value is measured; interpolating would put an unmeasured alerts/day on screen." That is a real concern but not a blocker — and the codebase had already relaxed it once, in `estimateAlertsPerDay()`, which linearly interpolates a 20-point measured curve.

The fix was to measure more densely rather than to interpolate a sparse table. `denseRatioCurve()` in the backtest sweeps 30 log-spaced ratios per bar and emits `SCALE_RATE_CURVES` verbatim. Every frequency shown on screen is now read from that measurement.

Note also that "1–100 slider" is not a return to the abandoned percentile axis. That axis was dropped because *percentile* was the wrong threshold statistic, not because 1–100 was the wrong control. `sliderToRatio()` — a log-scaled 1–100 → ratio map — had been sitting `@deprecated` in `sensitivity.ts` the whole time.

### Verified

- All five anchors reproduce exactly at levels 20/40/60/80/100 (ratio identical; alerts/day within 1–4% of the rounded table).
- Rate is monotone non-decreasing across all 100 positions. The first implementation was **not** — anchoring band edges to the table's rounded rates made the rate step backwards at levels 21/41/81. Band edges now invert against the curve's own value at the previous anchor.
- Ratio never leaves the measured region (≥ 3.0, the crossing cache floor).
- The default (level 60) still lands on the label-validated 15m/3.6× configuration.

### Not yet done

**Migration `0004` has not been applied to the live Supabase database.** Until it is, the web app and detector will query a `sensitivity_level` column that does not exist. This is the one deploy step this work left open.

## Sensitivity Test (implemented 2026-08-05)

**Opening the slider to 1–100 gave freedom to people who don't yet know where they belong.** "4.8 alerts/day" doesn't tell a first-time user whether that's a lot. So instead of asking, the app shows: real historical turnover charts, the user clicks the bars they'd want alerted on, and the labels are inverted back into a slider position.

**This is the same procedure that produced 3.5×**, run per-user inside the app. The user hand-marked 14 bars on a futures 5m chart; the multiple catching all of them was 3.5. `fitSensitivity()` does that scoring automatically.

Flow: pick a bar length → 5–10 charts of ~100 bars each → click bars → recommended level.

### It does not touch the detection algorithm

`packages/core/src/sensitivity-test.ts` is a pure read of the existing axis — it calls `sensitivityAt()` and reads `LOOKBACK_WINDOW_COUNT`. Nothing in `apps/detector/`, `constants.ts`, the migrations, or the firing rule changed. The output is a `sensitivityLevel` integer, exactly what the slider already produces.

Consequently, re-measuring anchors or `SCALE_RATE_CURVES` needs **zero** changes here — the recommendation follows the tables. The one thing that would require a rewrite is abandoning bar-length snapping for continuous windows, which decisions.md 10 exists to prevent.

### Fit method: F1 over free thresholds, then snap to the band

**Two stages, and the order matters.** First find the threshold ratio from labels alone, ignoring the band; then snap that ratio to the nearest level inside the chosen bar's band.

The first implementation swept only the band's twenty levels, and it was wrong: when the user's criterion sits outside what that bar can express, all twenty score identically and the tie-break lands mid-band. Labeling 2× bars on a 5m chart (band floor 3.5×) fires nothing anywhere → 0 everywhere → returns level 70 when the answer is 80. Fitting the ratio freely first keeps the direction, so the snap picks the correct end. Two tests pin this.

**Scoring is F1, not "catch every click."** Chosen by the user, whose reason was that people mis-click and judge the same bar differently round to round. Minimum-ratio lets one slip drag sensitivity to the band's loud end. F1 discards a slip that lands among ordinary bars — reaching it costs more precision than it gains recall. A slip on an *isolated* bar is not recoverable by any method; the test asserts the realistic case (90 ordinary bars spanning 0.4–2.2×).

Ties pick the geometric middle of the tied thresholds — with a gap between clicked and unclicked bars, every threshold in it scores the same, and an edge pick flips on the next round's labels.

`clamped` is computed from actual performance at the chosen level (`recall < 1` at the band's loud end, `extra > 0` at its quiet end), not from where the raw ratio fell. A ratio can land outside the band and still score perfectly inside it.

### Deliberate omissions in the chart

- **Volume only, no price candles.** Showing price makes users mark "bars that went up," which is not what the detector fires on. Their labels would then encode a criterion the algorithm cannot express.
- **No baseline line drawn** — neither median nor MA. Drawing one tells the user our answer and reads it back as their label. It is also the one question § Continuous Sensitivity still lists as open.
- **Linear y-axis**, matching TradingView and the charts the 3.5× labels came from. Log scale would flatten spikes.

### Data

Live Binance futures REST from the browser (`fapi.binance.com/fapi/v1/klines`, `Access-Control-Allow-Origin: *`, no key). Verified end-to-end: 132 klines requested and returned, 0 null ratios, top ratios 23.3/19.8/13.7/10.6/6.6.

Windows are non-overlapping by construction — the history range is split into equal slots, one random point per slot, so the same spike never appears twice. `isDiscriminating()` rejects dead periods (needs ≥1 bar at 5×, ≥2 at 3×, and ≤25 of 100 above 3× so the chart still separates). Candidates are over-fetched 2× in parallel; unqualifying windows are kept as fallback rather than leaving the user short of rounds.

Field 7 (quote volume) is used, not field 5 — the latter is coin count, not comparable across symbols and not what the algorithm reads.

## Claude Code Configuration

**`.claude/settings.local.json`** — project-level permission allowlist for repeated read-only operations, reducing permission prompts:

```json
{
  "permissions": {
    "allow": [
      "Bash(curl -s -o /dev/null -w \"web:3000 -> %{http_code}\\n\" http://localhost:3000)",
      "Bash(curl -s -o /dev/null -w \"detector:8080/health -> %{http_code}\\n\" http://localhost:8080/health)",
      "Bash(pnpm dev:detector)",
      "Bash(node --experimental-strip-types -e \"console.log('ok')\")",
      "Bash(node -e \"console.log(require('module').findSourceMap)\")",
      "Bash(node --help)"
    ]
  }
}
```

**`.claude/skills/dev/SKILL.md`** — custom skill documenting the two-process development setup. This project runs web (`Next.js` on 3010) and detector (`Node.js` on 8080) as independent processes. The skill explains:

- Why the processes don't start each other (root `pnpm dev` only starts web)
- How to launch both via PowerShell terminal windows with correct working directories (using `-WorkingDirectory` not embedded `cd` to avoid quoting issues on paths with spaces)
- Build prerequisites if `apps/detector/dist/` is missing
- Health check URLs and credential readiness signals

Invoked when the user asks to start dev, run everything, or similar ("개발 서버 켜줘", "detector 켜줘"). Avoids re-explaining the setup across sessions.

**`WEEKLY.md`** — high-level summary of the week's work, tracking progress across deployment readiness, web UI iteration, and detector verification. Kept at the root for visibility and updated once per planning cycle.

## Detector Server (live 2026-08-15)

The detector runs on an Oracle Cloud always-free VM, `ubuntu@152.70.96.232` (Tokyo, `ap-tokyo-1`), as the systemd unit `flare-detector`. SSH uses the local `~/.ssh/id_ed25519` key.

**The shape is `VM.Standard.E2.1.Micro` (x86, 1 OCPU, 954MB RAM), not the Ampere A1 the docs assume.** A1 is perpetually "Out of host capacity" in this region, and the region has only one availability domain, so there is no AD to retry against. Two consequences, both handled in `setup.sh`:

- **A 2GB swap file is created on first run** when RAM < 2GB and swap < 1GB, registered in `/etc/fstab`. Measured during the first build: swap was actually used. Without it the build OOMs.
- **`pnpm install` is filtered to `@flare-alert/detector...`** — detector plus `core`, which is what the filter resolves to. The server never runs web or backtest, so pulling Next.js/React was pure cost on a 1GB box.

`StartLimitIntervalSec`/`StartLimitBurst` live in `[Unit]`, not `[Service]`. systemd silently ignores them in `[Service]` ("Unknown key name"), which means the restart-storm limit reads as configured while actually being absent.

**Verifying the deploy is not "is the service active" — it is whether trades are arriving.** Per § Silent Stream Death, a dead stream looks identical to a quiet market. Sample `/health` twice and compare:

```bash
ssh ubuntu@152.70.96.232 'curl -s localhost:8080/health'   # symbols.<SYM>.ingest.ingestCount must climb
```

At the first live check both watched symbols ingested ~142 trades per 12 seconds. `ingestCount` flat across two samples means the stream is dead regardless of what the boot log said.

`.env` is transferred from the local repo root, stripped of CR (systemd's `EnvironmentFile` would otherwise put `\r` inside every value), and left `600 flare:flare`.

## Known Gaps & Next Steps

1. **Alert quality** — ✅ measured, hour-of-day confound controlled (2.08x corrected). Open: confirmation on 2–3 more symbols; hit-rate targets for a product callout.
2. **`MIN_QUOTE_VOLUME`** — ✅ measurement infrastructure + two rounds of data (see § Turnover Floor). Open: the product decision on where/how to set the floor.
3. **Detector pipeline** — ✅ complete end-to-end. Open: confirm alert rate with a multi-day real-time run; measure user retention/engagement.
4. **Ratio vs. percentile** — ✅ ratio won; the detector runs on ratios.
4b. **Scale-driven slider** — ✅ implemented (2026-08-03). Slider axis swapped from ratio to timeframe; `SENSITIVITY_SCALES` table, `scaleAt/scaleIndexOf/scaleRatio/scaleAlertsPerDay()` exports, migration SQL 0003_channel_scale. Open: quiet-hour label still needed to settle median-vs-MA baseline question.
4c. **Continuous 1–100 slider** — ✅ implemented (2026-08-03). See § Continuous Sensitivity. `SCALE_RATE_CURVES` (dense measured curves), `sensitivityAt()`/`levelForScale()`, `Channel.sensitivityLevel`, migration 0004, `backtest start dense`. Migration 0004 is applied to the live database (verified 2026-08-15 — `channels.sensitivity_level`, `scale`, and `sensitivity` all resolve).
5. **Storage** — ✅ schema, auth, channel persistence, push subscriptions, alert logging, password reset. Open: alert retention policy (table grows unbounded).
6. **Web UI** — ✅ MainApp, ChannelCard, ChannelForm, CoinIcon, AuthDialog + password reset + Google sign-in, MyPageDialog + account deletion, Web Push subscription, service worker, ko/en toggle, alert history view (all complete).
6b. **Plans & admin** — ✅ free/pro columns, DB-enforced channel limit, privilege guard, admin console at `/admin` (see § Plans & Admin). Open: **apply `0006` to the live database**; wire a payment provider to `admin_set_plan`; decide whether the detector should also refuse over-limit channels rather than relying on the downgrade sweep.
7. **Deployment** — ✅ Vercel connected and building; detector live on Oracle Cloud (see § Detector Server). `setup.sh` handles low-memory servers by auto-creating a 2GB swap file if the system has <2GB RAM and <1GB swap, and restricts dependency installation to detector + core only (excluding web/backtest). Open: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` still needs to be added to Vercel's env vars for push to work on the deployed site.
8. **Backtest tools** — ✅ `event-scale.ts` (scale markers + channel rate curve), `quality.ts`, `hour-matched.ts`, `turnover.ts`, `label-fit.ts` (label-based scoring) all in place.

Deferred until the web app is complete: mobile app development (React Native/Expo, iOS + Android).

## UI Simplification (in progress 2026-08-07)

**The web UI is being simplified to de-emphasize ratios and focus on the sensitivity percentage (1–100) axis.**

The continuous 1–100 slider already maps ratios to levels; showing both on every screen added cognitive load without adding information. Changes underway:

- **AlertHistory**: removed `ratio(alert.ratioToMedian)` display from alert items. Alerts still log the ratio to Supabase for analytics, but it's no longer shown to users.
- **ChannelCard**: replaced "catches from frame at ratio×normal" with simpler "catches frame turnover spikes"; displays the sensitivity percentage instead of the frame name in the summary.
- **SensitivitySlider**: removed `formatRatio()` function and related ratio displays; changed summary text from `catchesScale(frame, ratio)` to `catchesScale(frame)` alone.
- **SensitivityTest**: result now displays as `${level}%` instead of `${level}` (the level value is already 1–100; formatting makes it explicit).
- **i18n translations**: removed `alerts.ratio` field; `card.catchesFrom` and `slider.catchesScale` simplified to omit ratio parameter; removed `slider.ratioSuffix`.

The core detector, constants, and sensitivity calculations are unchanged. This is purely a presentation simplification, making the UI easier to understand for users who don't need to know about underlying multipliers.

## Account Management (completed 2026-08-07)

**MyPageDialog** provides account settings and self-service deletion:

- **Email change**: users can update their email address; Supabase sends a confirmation link to the new address.
- **Account deletion**: users can permanently delete their account via a "danger zone" button. Deletion is irreversible and cascades to:
  - All channels (child rows auto-delete via foreign key)
  - All alerts (child rows auto-delete via foreign key)
  - All push subscriptions (child rows auto-delete via foreign key)
  - The profile row itself

The deletion flow includes two confirmation steps (initial button + modal re-confirmation) to prevent accidental data loss. `supabase/migrations/0005_delete_own_account.sql` creates a database-level RPC function that wraps the cascade delete in a single transaction.

**Google sign-in** support was added to `AuthDialog.tsx`:

- The button always renders — unlike the earlier deliberate omission (see the file's own history), this one is meant to be wired up immediately, so it's safe to ship ahead of the Supabase-side config.
- `auth.tsx`'s `signInWithGoogle()` calls `signInWithOAuth({ provider: "google" })`; on failure (most likely because the provider isn't enabled yet), `classify()` maps Supabase's "provider is not enabled" message to a new `provider_not_enabled` problem so the button fails with a real message instead of a silent no-op.
- `i18n.tsx` adds `auth.continueWithGoogle` and `auth.orDivider` strings (ko/en).

Both features are opt-in (Google sign-in requires Supabase setup; account deletion is purely user-initiated) and do not affect the detector or sensitivity calculations.

## Signup Email Verification (fixed 2026-08-15)

**Duplicate email handling**: When email confirmation is enabled, Supabase does not return an error for already-registered emails (to prevent email enumeration attacks). Instead, it returns `identities: []` (empty array) while reporting success. Previously, the signup flow did not check this signal, so users would be shown "check your email" even though no confirmation mail would ever arrive.

The fix checks `data.user.identities?.length === 0` in `signUp()` and returns `{ ok: false, problem: "email_taken" }` to show the appropriate error message. This applies only when email verification is active; without it, Supabase does return a proper error.

## Mobile-First Responsive Refinements (in progress 2026-08-15)

**The web UI layout is being refined for mobile screens with Tailwind `sm:` breakpoint utilities.**

All major components (MainApp, ChannelCard, AlertHistory, dialogs, SensitivityTest, VolumeChart) are being adjusted to:

- **Reduce base padding and spacing on mobile** — base values shrink (e.g., `p-6` → `p-4 sm:p-6`, `gap-4` → `gap-3 sm:gap-4`), expanding on tablets/desktop where space permits
- **Reflow vertical stacking on narrow screens** — tab bar + create button now stack vertically on mobile (`flex-col sm:flex-row`) to prevent horizontal spillover
- **Responsive typography** — smaller headings on mobile (`text-headline sm:text-display`) scale appropriately
- **Touch-friendly button targets** — delete/action buttons widened with padding and focus rings visible to all devices, not just hover-capable ones (using `@media(hover:hover)` to hide opacity effects on phones)
- **Prevent shrinking critical text** — navigation items use `shrink-0` and `whitespace-nowrap` to avoid collapsing on narrow viewports
- **Flexible component sizing** — form dialogs, empty states, and notification prompts adapt their spacing per viewport width

Changes touch: `globals.css` (new responsive utilities), `MainApp.tsx`, `ChannelCard.tsx`, `ChannelForm.tsx`, `AlertHistory.tsx`, `AuthDialog.tsx`, `ResetPasswordDialog.tsx`, `MyPageDialog.tsx`, `ConfirmDialog.tsx`, `SensitivityTest.tsx`, `VolumeChart.tsx`.

This is purely a visual/UX refinement; no functional logic, state management, or API behavior changed.

## Landing Page (added 2026-08-22)

**`/` is now the service introduction; the app moved to `/app`.** The app opens on an empty channel list, which tells a first-time visitor nothing — "거래대금", "민감도", "3.5배" are all words the product assumes you already have. The landing exists to close that gap before anyone is asked to create a channel.

`apps/web/src/components/landing/` holds four files: `Landing.tsx` (the page), `LiveTape.tsx` (the animated demo), `ScaleCompare.tsx` (the ratio explainer), `AuthForward.tsx` (the auth-callback bridge below).

### Auth callbacks still land on `/`, and are forwarded in the browser

`auth.tsx` passes `redirectTo: window.location.origin` for password reset and Google sign-in, so every provider round-trip returns to `/` — which no longer contains `AuthProvider` or `ResetPasswordDialog`. Changing `redirectTo` to `${origin}/app` would also require editing Supabase's redirect allowlist in the dashboard, i.e. a break that code alone cannot fix. **`AuthForward` forwards instead**: on mount it looks for `?code` / `?token_hash` / `?error*` in the query, or `access_token` / `error` / `type=recovery` in the fragment, and `location.replace(\"/app\" + search + hash)`.

Two things this depends on:

- **The fragment never reaches the server**, so the forward must happen in the browser. A server redirect would silently drop recovery tokens.
- **The landing must not construct a Supabase browser client.** `detectSessionInUrl` would consume the `?code=` on `/` and leave nothing for `/app` to exchange. Nothing on the landing imports `lib/supabase/client`; keep it that way.

`sw.js`'s notification-click fallback moved `/` → `/app`, and `AdminPage`'s three "home" links likewise — an alert or an admin console should never drop the user on a marketing page.

### `?auth=login` / `?auth=signup` / `?new=1`

The landing's buttons deep-link into the app: `?auth=...` opens the login/signup dialog, `?new=1` opens the create-channel view. **`?new=1` is what the sensitivity-test CTA uses** — the test lives inside `ChannelForm`, so linking to the bare channel list would drop the visitor one step short of the thing the landing just sold them.

`MainApp` reads both parameters once on mount and strips them with `history.replaceState` (otherwise a refresh reopens the same screen forever). The auth dialog additionally waits for `authLoaded` — opening on a still-loading session flashes a login dialog at someone who is already signed in. Note `loaded` is destructured as `authLoaded` because `useChannels()` exports the same name.

### The hero demo is scripted, and says so

`LiveTape` does **not** connect to Binance. A visitor arriving during a quiet hour would watch a live tape do nothing, which is the opposite of an introduction. The sequence is a fixed seeded array (`mulberry32`, module scope, so server and client render the same first frame) with two bursts written into it. (An earlier draft ran a caption under the chart saying so explicitly; the user asked for it removed, along with a few other lines the copy pass judged self-evident or hedge-y — see § Content decisions.)

The *rule* is real: the dashed baseline is the median of the visible bars excluding the newest, the threshold is 3.5× (the shipped default), and one crossing produces one alert card. `prefers-reduced-motion` freezes it on a post-burst frame rather than leaving an empty chart.

Two bugs worth not reintroducing: bar keys are the absolute sequence index (`(head + index) % len`), not the array position, or every tick remounts all bars and the height transition never runs; and the alert card's dismissal timer keys off the card object, not the tick, or each tick clears the pending timeout and the card never goes away.

### The landing reuses the real controls

`SensitivitySlider` is the shipped component, not a mock-up — the alerts/day it prints comes from `SCALE_RATE_CURVES`, so a visitor who drags it before signing up sees the same numbers they will see after. `ScaleCompare` draws one relative array at two absolute scales for the same reason: the claim is that a ratio survives a 100× size difference, so the picture uses literally the same array.

### Content decisions

- **A section listing what the product does not do** (no direction, not a trade signal) sits above pricing. Direction measured close to a coin flip; a user who signs up expecting a buy signal churns on their first alert. A third item ("no hidden number") was cut in a later copy pass — the user judged it self-evident once the ratio is already shown live in § The landing reuses the real controls, and redundant explanation reads as padding. The `honest.items` grid is 2-up (`md:grid-cols-2`, capped `max-w-3xl`) to match, not 3-up.
- **The sensitivity test is the headline feature, not a footnote.** "Is 5 alerts a day a lot?" is the actual barrier, and clicking bars on a real chart is the answer that needs no numeric literacy. Its "No numbers required" badge was cut for the same self-evident reason as above.
- **Pro shows a "coming soon" panel, not a button.** Billing is not wired; a button that does nothing reads as a broken site.
- **The hero title is a plain label, not a tagline.** It went through two revisions: a poetic two-liner ("The moment turnover spikes, we alert you") tested unclear about what the product *is*, so it was replaced with the literal **"급등 거래량 알림" / "Volume Spike Alerts"**. First-time-visitor clarity outranked flourish here.
- A handful of explanatory asides were cut for being self-evident or hedge-y once seen in context: the "not a picture of the control" note under the live slider, the "here's why we're saying this" preamble on § What this alert does not do, and the closing line under the final CTA. The section headings and remaining body copy carry the same information without the meta-commentary.

Both dictionaries carry the whole `landing` section — a Korean-only addition fails the build, as everywhere else.
