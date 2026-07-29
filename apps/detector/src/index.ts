// detector 진입점.
//
// 이 프로세스는 바이낸스 WebSocket에 상시 연결된 채로 돌아간다.
// 서버리스에 올릴 수 없어서 web과 배포를 분리했다 (docs/decisions.md 6번).
//
//   aggTrade WS -> 1초 버킷 -> 프레임별 롤링 창 -> 중앙값/MAD 점수 S
//     -> 퍼센타일 환산 -> 민감도 임계 판정 -> 쿨다운/병합 -> 발송
//
// 발송 단계는 아직 없다. 지금은 콘솔로 낸다 — 알고리즘이 실제 시세에서
// 의도대로 도는지 눈으로 확인하는 게 먼저다.

import { createServer } from "node:http";

import {
  SENSITIVITY_DEFAULT,
  TIMEFRAMES,
  createChannel,
  percentileToSlider,
} from "@flare-alert/core";
import type { Alert, Channel, SymbolRef } from "@flare-alert/core";

import { AggTradeStream, fetchTradingSymbols } from "./binance.js";
import {
  BACKFILL_DAYS,
  backfillGap,
  backfillSymbol,
  distributionReadiness,
} from "./backfill.js";
import { ChannelRuntime } from "./channel-runtime.js";
import { Detector } from "./detect.js";
import { loadConfig } from "./config.js";
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

// ---------------------------------------------------------------------------
// 로그
// ---------------------------------------------------------------------------

const LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LEVEL_ORDER;

function makeLogger(threshold: LogLevel) {
  return (level: LogLevel, message: string): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold]) {
      return;
    }
    const stamp = new Date().toISOString().slice(11, 19);
    console.log(`${stamp} [${level}] ${message}`);
  };
}

type Logger = ReturnType<typeof makeLogger>;

function formatUsd(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(0)}K`;
  }
  return value.toFixed(0);
}

// ---------------------------------------------------------------------------
// 채널
// ---------------------------------------------------------------------------

/**
 * 감시할 채널을 만든다.
 *
 * DB에서 읽는 단계가 아직 없어서, 종목마다 기본 민감도 채널을 하나씩
 * 세운다. 실제 사용자 채널을 읽기 시작하면 이 함수만 갈아치우면 된다.
 */
function buildChannels(symbols: readonly string[]): Channel[] {
  return symbols.map((symbol) => {
    const channel = createChannel();
    return {
      ...channel,
      name: `${symbol} 기본`,
      symbol: { exchange: EXCHANGE, symbol },
      sensitivity: SENSITIVITY_DEFAULT,
    };
  });
}

// ---------------------------------------------------------------------------
// 본체
// ---------------------------------------------------------------------------

class DetectorService {
  readonly #config: DetectorConfig;
  readonly #log: Logger;
  readonly #detector = new Detector();
  readonly #runtimes: ChannelRuntime[] = [];
  #stream: AggTradeStream | null = null;
  #tick: NodeJS.Timeout | null = null;
  #nextSecond = 0;
  #alertCount = 0;
  #startedAtMs = Date.now();
  #ready = false;

  constructor(config: DetectorConfig, log: Logger) {
    this.#config = config;
    this.#log = log;
  }

  get ready(): boolean {
    return this.#ready;
  }

  get alertCount(): number {
    return this.#alertCount;
  }

  get uptimeSeconds(): number {
    return Math.floor((Date.now() - this.#startedAtMs) / 1000);
  }

  async start(): Promise<void> {
    const symbols = await this.#verifySymbols(this.#config.symbols);

    for (const channel of buildChannels(symbols)) {
      this.#runtimes.push(new ChannelRuntime(channel));
    }

    // 스트림을 먼저 연다. 과거를 채우는 동안 오는 체결을 버퍼에 담아
    // 두려는 것이다. 반대 순서로 하면 채우기와 실시간 사이에 구멍이 난다.
    this.#connectStream(symbols);

    await this.#backfill(symbols);

    this.#startClock();
    this.#ready = true;
  }

  stop(): void {
    if (this.#tick !== null) {
      clearInterval(this.#tick);
      this.#tick = null;
    }
    this.#stream?.stop();
    this.#stream = null;
  }

  /** 오타나 상장폐지를 부팅 때 잡는다. 몇 시간 뒤 조용한 것보다 낫다. */
  async #verifySymbols(requested: readonly string[]): Promise<string[]> {
    const trading = await fetchTradingSymbols(requested);
    const usable = requested.filter((symbol) => trading.has(symbol));
    const dropped = requested.filter((symbol) => !trading.has(symbol));

    if (dropped.length > 0) {
      this.#log(
        "warn",
        `거래 중이 아닌 종목을 제외합니다: ${dropped.join(", ")}`,
      );
    }
    if (usable.length === 0) {
      throw new Error("감시할 수 있는 종목이 없습니다");
    }

    return usable;
  }

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
        void this.#repairGap(symbols, gapMs);
      },
      onLog: (level, message) => {
        this.#log(level, message);
      },
    });

    stream.start();
    this.#stream = stream;
  }

  async #backfill(symbols: readonly string[]): Promise<void> {
    // 진행 중인 분은 거래대금이 덜 찼다. 직전 분까지만 채운다.
    const endMs = Math.floor(Date.now() / 60_000) * 60_000;

    this.#log(
      "info",
      `과거 ${BACKFILL_DAYS}일치를 받습니다 (${symbols.length}종목). 몇 분 걸립니다.`,
    );

    let lastMinuteSecond = 0;

    for (const symbol of symbols) {
      const result = await backfillSymbol(this.#detector, symbol, endMs);
      lastMinuteSecond = Math.max(lastMinuteSecond, result.lastMinuteSecond);

      this.#log(
        "info",
        `  ${symbol}: ${result.minutes.toLocaleString()}분 ` +
          `(${(result.elapsedMs / 1000).toFixed(1)}초)`,
      );
    }

    // 채우기가 끝난 분의 다음 초부터 실시간으로 이어간다.
    this.#nextSecond = lastMinuteSecond + 60;

    this.#reportReadiness(symbols);
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
    this.#log(
      "info",
      "… 표시는 표본이 아직 모자라 그 프레임이 조용하다는 뜻입니다 (실시간으로 쌓입니다).",
    );
  }

  async #repairGap(symbols: readonly string[], gapMs: number): Promise<void> {
    // 짧은 끊김은 그냥 둔다. REST 왕복이 오히려 더 오래 걸린다.
    if (gapMs < 5000) {
      return;
    }

    const toMs = Math.floor(Date.now() / 60_000) * 60_000;

    for (const symbol of symbols) {
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

  #startClock(): void {
    // 1초마다 깨어나되, 밀린 초가 있으면 한 번에 따라잡는다.
    // setInterval은 정확히 1000ms를 보장하지 않아서 그냥 두면 시계가 밀린다.
    this.#tick = setInterval(() => {
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

    for (const runtime of this.#runtimes) {
      const target = runtime.channel.symbol;
      if (target === null || !runtime.channel.enabled) {
        continue;
      }

      const signals = this.#detector.evaluate(target.symbol, atMs);
      if (signals.length === 0) {
        continue;
      }

      const price = this.#detector.aggregator(target.symbol).lastPrice;
      const decision = runtime.decide(target, signals, atMs, price);

      if (decision.alert !== null) {
        this.#alertCount += 1;
        this.#report(decision.alert, target);
      }
    }
  }

  /**
   * 알림을 콘솔에 낸다.
   *
   * 발송기가 붙기 전까지의 임시 출력이다. 검증에 필요한 값을 전부 적는다 —
   * 나중에 차트와 대조하려면 시각, 백분위, 배수가 있어야 한다.
   */
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

  /** 헬스체크와 진단에 쓸 현재 상태. */
  snapshot(): Record<string, unknown> {
    const stats = this.#detector.stats;
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
      uptimeSeconds: this.uptimeSeconds,
      alerts: this.#alertCount,
      evaluations: stats,
      symbols,
    };
  }
}

// ---------------------------------------------------------------------------
// 부팅
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = loadConfig();
  const log = makeLogger(config.logLevel);

  log("info", "detector 시작");
  log("info", `감시 종목: ${config.symbols.join(", ")}`);
  log(
    "info",
    `기본 민감도: ${SENSITIVITY_DEFAULT} (슬라이더 ${percentileToSlider(SENSITIVITY_DEFAULT)})`,
  );

  if (config.telegramBotToken === null) {
    log("warn", "TELEGRAM_BOT_TOKEN이 없습니다. 알림은 콘솔로만 나갑니다.");
  }

  const service = new DetectorService(config, log);

  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(service.ready ? 200 : 503, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(service.snapshot(), null, 2));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  server.listen(config.port, () => {
    log("info", `헬스체크 http://localhost:${config.port}/health`);
  });

  registerShutdownHandlers(() => {
    service.stop();
    server.close();
  }, log);

  await service.start();
  log("info", "실시간 감지 시작. 알림이 나오면 아래에 표시됩니다.");
}

/**
 * 상시 프로세스라서 종료 신호를 직접 처리해야 한다.
 * 재배포 때 WebSocket을 정리하지 않으면 연결이 남아 중복 알림이 나갈 수 있다.
 */
function registerShutdownHandlers(cleanup: () => void, log: Logger): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log("info", `${signal} 수신, 종료합니다`);
    cleanup();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("[detector] 부팅 실패", error);
  process.exit(1);
});
