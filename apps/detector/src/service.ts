// detector 본체.
//
//   aggTrade WS -> 1초 버킷 -> 프레임별 롤링 창 -> 중앙값/MAD 점수 S
//     -> 퍼센타일 환산 -> 민감도 임계 판정 -> 쿨다운/병합 -> 기록 + 웹 푸시
//
// Supabase가 붙어 있으면 사용자 채널을 읽어 감시하고 알림을 저장·발송한다.
// 없으면 독립 모드로 돈다 — 설정된 종목을 기본 민감도로 보고 콘솔에만 낸다.
// 알고리즘을 확인할 때 DB 없이 띄울 수 있어야 해서 남겨 둔 길이다.

import {
  SENSITIVITY_DEFAULT,
  TIMEFRAMES,
  createChannel,
  percentileToSlider,
} from "@flare-alert/core";
import type { Alert, SymbolRef } from "@flare-alert/core";

import { AggTradeStream, fetchTradingSymbols } from "./binance.js";
import {
  BACKFILL_DAYS,
  backfillGap,
  backfillSymbol,
  distributionReadiness,
} from "./backfill.js";
import { ChannelRuntime } from "./channel-runtime.js";
import { Detector } from "./detect.js";
import { Pusher } from "./push.js";
import { Store } from "./store.js";
import type { OwnedChannel } from "./store.js";
import type { DetectorConfig } from "./config.js";

const EXCHANGE = "binance" as const;

/**
 * 몇 초 전을 평가할 것인가.
 *
 * 지금 이 초는 아직 안 끝났다. 끝나기 전에 평가하면 절반만 찬 거래대금으로
 * 속도를 계산하게 된다. 1초를 두면 체결이 도착할 시간도 확보된다 —
 * aggTrade 지연은 보통 100ms 안쪽이라 1초면 넉넉하다.
 */
const EVALUATION_LAG_SECONDS = 1;

/**
 * 채널 목록을 다시 읽는 주기(ms).
 *
 * Realtime으로 구독할 수도 있지만 폴링이 훨씬 단순하고, 이 정도 지연은
 * 문제가 안 된다. 새 채널은 최대 1분 뒤부터 감시된다.
 */
const CHANNEL_REFRESH_MS = 60_000;

export type LogLevel = "debug" | "info" | "warn" | "error";
export type Logger = (level: LogLevel, message: string) => void;

interface Runtime {
  runtime: ChannelRuntime;
  userId: string | null;
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(0)}K`;
  }
  return value.toFixed(0);
}

export class DetectorService {
  readonly #config: DetectorConfig;
  readonly #log: Logger;
  readonly #detector = new Detector();
  readonly #store: Store | null;
  readonly #pusher: Pusher | null;

  /** 채널 id → 판정 상태. 쿨다운이 살아 있어야 해서 갱신 때 재사용한다. */
  readonly #runtimes = new Map<string, Runtime>();
  /** 이미 과거를 채운 종목. 두 번 채우면 분포가 두 배로 쌓인다. */
  readonly #primed = new Set<string>();

  #stream: AggTradeStream | null = null;
  #tick: NodeJS.Timeout | null = null;
  #refresh: NodeJS.Timeout | null = null;
  #nextSecond = 0;
  #alertCount = 0;
  #pushSent = 0;
  #pushFailed = 0;
  #startedAtMs = Date.now();
  #ready = false;
  /** 종목 추가 중에는 시계를 멈춘다. 채우는 동안 초가 밀리면 안 된다. */
  #priming = false;

  constructor(config: DetectorConfig, log: Logger) {
    this.#config = config;
    this.#log = log;
    this.#store = config.supabase === null ? null : new Store(config.supabase);
    this.#pusher = config.vapid === null ? null : new Pusher(config.vapid);
  }

  get ready(): boolean {
    return this.#ready;
  }

  async start(): Promise<void> {
    const channels = await this.#loadChannels();
    const symbols = await this.#verifySymbols(this.#watchedSymbols(channels));

    if (symbols.length === 0) {
      this.#log("warn", "감시할 종목이 없습니다. 채널이 생기면 시작합니다.");
    }

    // 스트림을 먼저 연다. 과거를 채우는 동안 오는 체결을 버퍼에 담아
    // 두려는 것이다. 반대 순서로 하면 채우기와 실시간 사이에 구멍이 난다.
    this.#connectStream(symbols);
    this.#applyChannels(channels);

    await this.#primeSymbols(symbols);

    this.#startClock();
    this.#startChannelRefresh();
    this.#ready = true;
  }

  stop(): void {
    for (const timer of [this.#tick, this.#refresh]) {
      if (timer !== null) {
        clearInterval(timer);
      }
    }
    this.#tick = null;
    this.#refresh = null;
    this.#stream?.stop();
    this.#stream = null;
  }

  // -------------------------------------------------------------------------
  // 채널
  // -------------------------------------------------------------------------

  async #loadChannels(): Promise<OwnedChannel[]> {
    if (this.#store === null) {
      // 독립 모드. 설정된 종목마다 기본 스케일 채널을 하나씩 세운다.
      // createChannel()이 DEFAULT_SCALE을 넣어 준다.
      return this.#config.symbols.map((symbol) => ({
        userId: null,
        channel: {
          ...createChannel(),
          name: `${symbol} 기본`,
          symbol: { exchange: EXCHANGE, symbol },
        },
      }));
    }

    return this.#store.loadChannels();
  }

  #watchedSymbols(channels: readonly OwnedChannel[]): string[] {
    const symbols = new Set<string>();
    for (const owned of channels) {
      const target = owned.channel.symbol;
      if (target !== null && target.exchange === EXCHANGE) {
        symbols.add(target.symbol);
      }
    }
    return [...symbols];
  }

  /**
   * 채널 목록을 판정 상태에 반영한다.
   *
   * 살아 있던 채널의 ChannelRuntime은 그대로 둔다. 새로 만들면 쿨다운과
   * 마지막 알림 시각이 초기화되어, 목록을 새로 읽을 때마다 방금 울린
   * 사건이 다시 울린다.
   */
  #applyChannels(channels: readonly OwnedChannel[]): void {
    const seen = new Set<string>();

    for (const owned of channels) {
      seen.add(owned.channel.id);
      const existing = this.#runtimes.get(owned.channel.id);

      if (existing === undefined) {
        this.#runtimes.set(owned.channel.id, {
          runtime: new ChannelRuntime(owned.channel),
          userId: owned.userId,
        });
        continue;
      }

      // 설정이 바뀌었으면 갈아끼우되 쿨다운은 넘겨받는다.
      if (
        existing.runtime.channel.sensitivity !== owned.channel.sensitivity ||
        existing.runtime.channel.symbol?.symbol !== owned.channel.symbol?.symbol
      ) {
        this.#runtimes.set(owned.channel.id, {
          runtime: existing.runtime.withChannel(owned.channel),
          userId: owned.userId,
        });
      }
    }

    for (const id of [...this.#runtimes.keys()]) {
      if (!seen.has(id)) {
        this.#runtimes.delete(id);
      }
    }
  }

  #startChannelRefresh(): void {
    if (this.#store === null) {
      return;
    }

    this.#refresh = setInterval(() => {
      void this.#refreshChannels();
    }, CHANNEL_REFRESH_MS);
  }

  async #refreshChannels(): Promise<void> {
    if (this.#store === null || this.#priming) {
      return;
    }

    try {
      const channels = await this.#store.loadChannels();
      this.#applyChannels(channels);

      const wanted = await this.#verifySymbols(this.#watchedSymbols(channels));
      const missing = wanted.filter((symbol) => !this.#primed.has(symbol));

      if (missing.length > 0) {
        this.#stream?.setSymbols(wanted);
        await this.#primeSymbols(missing);
      } else {
        this.#stream?.setSymbols(wanted);
      }
    } catch (error) {
      this.#log("error", `채널 갱신 실패: ${String(error)}`);
    }
  }

  // -------------------------------------------------------------------------
  // 부팅과 과거 채우기
  // -------------------------------------------------------------------------

  /** 오타나 상장폐지를 부팅 때 잡는다. 몇 시간 뒤 조용한 것보다 낫다. */
  async #verifySymbols(requested: readonly string[]): Promise<string[]> {
    if (requested.length === 0) {
      return [];
    }

    const trading = await fetchTradingSymbols(requested);
    const dropped = requested.filter((symbol) => !trading.has(symbol));

    if (dropped.length > 0) {
      this.#log(
        "warn",
        `거래 중이 아닌 종목을 제외합니다: ${dropped.join(", ")}`,
      );
    }

    return requested.filter((symbol) => trading.has(symbol));
  }

  async #primeSymbols(symbols: readonly string[]): Promise<void> {
    const pending = symbols.filter((symbol) => !this.#primed.has(symbol));
    if (pending.length === 0) {
      return;
    }

    this.#priming = true;
    try {
      // 진행 중인 분은 거래대금이 덜 찼다. 직전 분까지만 채운다.
      const endMs = Math.floor(Date.now() / 60_000) * 60_000;

      this.#log(
        "info",
        `과거 ${BACKFILL_DAYS}일치를 받습니다 (${pending.length}종목)`,
      );

      let lastMinuteSecond = 0;

      for (const symbol of pending) {
        const result = await backfillSymbol(this.#detector, symbol, endMs);
        this.#primed.add(symbol);
        lastMinuteSecond = Math.max(lastMinuteSecond, result.lastMinuteSecond);

        this.#log(
          "info",
          `  ${symbol}: ${result.minutes.toLocaleString()}분 ` +
            `(${(result.elapsedMs / 1000).toFixed(1)}초)`,
        );
      }

      // 채우기가 끝난 분의 다음 초부터 실시간으로 이어간다.
      this.#nextSecond = Math.max(this.#nextSecond, lastMinuteSecond + 60);
      this.#reportReadiness(pending);
    } finally {
      this.#priming = false;
    }
  }

  /**
   * 프레임별로 임계를 분해할 만큼 분포가 쌓였는지 보여준다.
   *
   * 표본이 모자라면 백분위가 임계에 닿지 못해 그 프레임은 조용하다.
   * 조용한 게 시세가 잠잠해서인지 아직 못 깨어나서인지 구분되어야 한다.
   */
  #reportReadiness(symbols: readonly string[]): void {
    for (const symbol of symbols) {
      const rows = distributionReadiness(
        this.#detector,
        symbol,
        SENSITIVITY_DEFAULT,
      );
      const summary = rows
        .map((row) => `${row.timeframe}${row.ready ? "✓" : "…"}`)
        .join(" ");
      this.#log("info", `  ${symbol} 분포: ${summary}`);
    }
  }

  // -------------------------------------------------------------------------
  // 스트림
  // -------------------------------------------------------------------------

  #connectStream(symbols: readonly string[]): void {
    const stream = new AggTradeStream({
      wsUrl: this.#config.binanceWsUrl,
      symbols,
      onTrade: (trade) => {
        this.#detector
          .aggregator(trade.symbol)
          .ingest(trade.timestampMs, trade.price, trade.quoteVolume);
      },
      onGap: (gapMs) => {
        void this.#repairGap(gapMs);
      },
      onLog: (level, message) => {
        this.#log(level, message);
      },
    });

    stream.start();
    this.#stream = stream;
  }

  async #repairGap(gapMs: number): Promise<void> {
    // 짧은 끊김은 그냥 둔다. REST 왕복이 오히려 더 오래 걸린다.
    if (gapMs < 5000) {
      return;
    }

    const toMs = Math.floor(Date.now() / 60_000) * 60_000;

    for (const symbol of this.#detector.symbols) {
      const aggregator = this.#detector.aggregator(symbol);
      try {
        const applied = await backfillGap(
          this.#detector,
          symbol,
          aggregator.currentSecond + 1,
          toMs,
        );
        if (applied > 0) {
          this.#log("info", `${symbol}: 끊긴 ${applied}분을 과거 봉으로 메움`);
        }
      } catch (error) {
        this.#log("error", `${symbol} 구간 복구 실패: ${String(error)}`);
      }
    }

    this.#nextSecond = Math.max(this.#nextSecond, Math.floor(toMs / 1000));
  }

  // -------------------------------------------------------------------------
  // 시계와 판정
  // -------------------------------------------------------------------------

  #startClock(): void {
    // 1초마다 깨어나되, 밀린 초가 있으면 한 번에 따라잡는다.
    // setInterval은 정확히 1000ms를 보장하지 않아서 그냥 두면 시계가 밀린다.
    this.#tick = setInterval(() => {
      if (this.#priming) {
        return;
      }
      const target = Math.floor(Date.now() / 1000) - EVALUATION_LAG_SECONDS;
      while (this.#nextSecond <= target) {
        this.#processSecond(this.#nextSecond);
        this.#nextSecond += 1;
      }
    }, 250);
  }

  #processSecond(absSecond: number): void {
    const atMs = absSecond * 1000;

    for (const symbol of this.#detector.symbols) {
      this.#detector.aggregator(symbol).advanceSecond(absSecond);
    }

    for (const entry of this.#runtimes.values()) {
      const target = entry.runtime.channel.symbol;
      if (target === null || !entry.runtime.channel.enabled) {
        continue;
      }

      const signals = this.#detector.evaluate(target.symbol, atMs);
      if (signals.length === 0) {
        continue;
      }

      const price = this.#detector.aggregator(target.symbol).lastPrice;
      const decision = entry.runtime.decide(target, signals, atMs, price);

      if (decision.alert !== null) {
        this.#alertCount += 1;
        this.#report(decision.alert, target);
        void this.#dispatch(decision.alert, entry);
      }
    }
  }

  /**
   * 알림을 기록하고 발송한다.
   *
   * 실패해도 감지 루프를 막지 않는다. 매 초 도는 시계 위에서 await하면
   * DB나 푸시 서비스가 느릴 때 초가 통째로 밀린다.
   */
  async #dispatch(alert: Alert, entry: Runtime): Promise<void> {
    const { userId } = entry;
    if (this.#store === null || userId === null) {
      return;
    }

    try {
      const recorded = await this.#store.recordAlert(alert, userId);
      if (!recorded) {
        this.#log("warn", `알림 기록 실패 (발송은 계속): ${alert.id}`);
      }

      if (
        this.#pusher === null ||
        !entry.runtime.channel.delivery.includes("browser")
      ) {
        return;
      }

      const targets = await this.#store.loadSubscriptions(userId);
      for (const target of targets) {
        const outcome = await this.#pusher.send(
          target,
          alert,
          entry.runtime.channel.name,
        );

        if (outcome.kind === "sent") {
          this.#pushSent += 1;
          void this.#store.markSubscriptionSuccess(target.endpoint);
        } else if (outcome.kind === "gone") {
          this.#log("info", "죽은 푸시 구독을 지웁니다");
          await this.#store.dropSubscription(target.endpoint);
        } else {
          this.#pushFailed += 1;
          this.#log("warn", `푸시 발송 실패: ${outcome.reason}`);
        }
      }
    } catch (error) {
      this.#log("error", `알림 처리 실패: ${String(error)}`);
    }
  }

  /** 알림을 콘솔에 낸다. 검증에 필요한 값을 전부 적는다. */
  #report(alert: Alert, target: SymbolRef): void {
    const slider = percentileToSlider(alert.percentile);
    const time = new Date(alert.firedAtMs).toISOString().slice(11, 19);

    console.log(
      `\n🔔 ${target.symbol} ${alert.scale}급 유동성 — ${time} UTC\n` +
        `   가격 ${alert.price.toFixed(4)}\n` +
        `   백분위 ${alert.percentile.toFixed(4)} (슬라이더 ${slider}) · S=${alert.score.toFixed(1)}\n` +
        `   창 거래대금 ${formatUsd(alert.quoteVolume)} · 평소의 ${alert.ratioToMedian.toFixed(1)}배\n`,
    );
  }

  // -------------------------------------------------------------------------
  // 진단
  // -------------------------------------------------------------------------

  snapshot(): Record<string, unknown> {
    const symbols: Record<string, unknown> = {};

    for (const symbol of this.#detector.symbols) {
      const samples: Record<string, number> = {};
      for (const timeframe of TIMEFRAMES) {
        samples[timeframe] = this.#detector.sampleCount(symbol, timeframe);
      }
      symbols[symbol] = {
        warmup: this.#detector.aggregator(symbol).warmupState(),
        percentileSamples: samples,
      };
    }

    return {
      ready: this.#ready,
      mode: this.#store === null ? "standalone" : "supabase",
      pushEnabled: this.#pusher !== null,
      uptimeSeconds: Math.floor((Date.now() - this.#startedAtMs) / 1000),
      channels: this.#runtimes.size,
      alerts: this.#alertCount,
      push: { sent: this.#pushSent, failed: this.#pushFailed },
      evaluations: this.#detector.stats,
      symbols,
    };
  }
}
