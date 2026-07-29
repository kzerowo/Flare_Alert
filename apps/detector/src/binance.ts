// 바이낸스 접속. REST(과거 봉)와 WebSocket(실시간 체결) 두 가지를 쓴다.
//
// 둘 다 필요한 이유는 냉시동 문제 때문이다. 백분위는 "이 종목의 과거 S 분포에서
// 지금이 몇 등인가"인데, 갓 켠 프로세스에는 과거가 없다. 1일봉 기준선 하나만
// 해도 완결된 창 14개가 필요해서, 실시간 데이터만 기다리면 2주 동안 아무것도
// 못 한다. 그래서 시작할 때 REST로 과거를 받아 채운다.
//
// API 키는 쓰지 않는다. 공개 시세 엔드포인트라 필요 없다.

const REST_BASE = "https://api.binance.com";

/** 봉 하나. 우리가 쓰는 건 견적 통화 거래대금과 종가뿐이다. */
export interface Kline {
  openTimeMs: number;
  quoteVolume: number;
  close: number;
}

/**
 * 한 번에 받을 수 있는 봉 수의 상한.
 *
 * 바이낸스가 정한 값이다. 이보다 크게 요청해도 1000개만 온다.
 */
const KLINE_PAGE_LIMIT = 1000;

/** 응답 배열에서 쓰는 자리. 나머지는 우리가 안 본다. */
const OPEN_TIME = 0;
const CLOSE_PRICE = 4;
const QUOTE_VOLUME = 7;

function parseKline(row: unknown): Kline | null {
  if (!Array.isArray(row)) {
    return null;
  }

  const openTimeMs = Number(row[OPEN_TIME]);
  const close = Number(row[CLOSE_PRICE]);
  const quoteVolume = Number(row[QUOTE_VOLUME]);

  if (
    !Number.isFinite(openTimeMs) ||
    !Number.isFinite(close) ||
    !Number.isFinite(quoteVolume)
  ) {
    return null;
  }

  return { openTimeMs, close, quoteVolume };
}

/**
 * 지정 구간의 1분봉을 전부 받아온다.
 *
 * 한 번에 1000개까지만 오므로 페이지를 이어 붙인다. 마지막 페이지인지는
 * 받은 개수가 아니라 "마지막 봉의 시각이 끝을 지났는가"로 판단한다.
 * 거래가 없는 구간에서도 바이낸스는 봉을 채워 주지만, 상장 이전 구간처럼
 * 아예 데이터가 없으면 빈 배열이 와서 개수만으로는 끝을 알 수 없다.
 */
export async function fetchMinuteKlines(
  symbol: string,
  startMs: number,
  endMs: number,
): Promise<Kline[]> {
  const collected: Kline[] = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const url = new URL("/api/v3/klines", REST_BASE);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", "1m");
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(endMs));
    url.searchParams.set("limit", String(KLINE_PAGE_LIMIT));

    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `바이낸스 봉 조회 실패 ${symbol} ${response.status}: ${body.slice(0, 200)}`,
      );
    }

    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      break;
    }

    let lastOpenTime = cursor;
    for (const row of rows) {
      const kline = parseKline(row);
      if (kline === null) {
        continue;
      }
      collected.push(kline);
      lastOpenTime = kline.openTimeMs;
    }

    // 다음 페이지는 마지막 봉 다음 분부터. 진전이 없으면 무한 루프가 되므로
    // 커서가 반드시 앞으로 가도록 강제한다.
    const next = lastOpenTime + 60_000;
    if (next <= cursor) {
      break;
    }
    cursor = next;
  }

  return collected;
}

/**
 * 요청한 심볼 중 현재 거래 중인 것만 골라낸다. 오타나 상장폐지를 부팅 때 잡는다.
 *
 * symbols 파라미터로 좁혀 물어보지 않는다. 목록에 없는 심볼이 하나라도
 * 끼면 바이낸스가 400(-1121)으로 요청 전체를 거절해서, 정작 걸러내고 싶은
 * 상황에서 아무것도 못 받는다. 전체를 받아 우리가 거른다 — 응답이 크지만
 * 부팅 때 한 번뿐이다.
 */
export async function fetchTradingSymbols(
  symbols: readonly string[],
): Promise<Set<string>> {
  const requested = new Set(symbols);
  const url = new URL("/api/v3/exchangeInfo", REST_BASE);
  url.searchParams.set("permissions", "SPOT");

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `바이낸스 종목 정보 조회 실패 ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  const payload: unknown = await response.json();
  const trading = new Set<string>();

  if (
    typeof payload === "object" &&
    payload !== null &&
    "symbols" in payload &&
    Array.isArray((payload as { symbols: unknown[] }).symbols)
  ) {
    for (const entry of (payload as { symbols: unknown[] }).symbols) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const record = entry as { symbol?: unknown; status?: unknown };
      if (
        typeof record.symbol === "string" &&
        record.status === "TRADING" &&
        requested.has(record.symbol)
      ) {
        trading.add(record.symbol);
      }
    }
  }

  return trading;
}

/** 정규화한 체결 하나. */
export interface AggTrade {
  symbol: string;
  timestampMs: number;
  price: number;
  quoteVolume: number;
}

export interface AggTradeStreamOptions {
  wsUrl: string;
  symbols: readonly string[];
  onTrade: (trade: AggTrade) => void;
  /**
   * 연결이 끊겼다가 다시 붙었을 때 부른다. 인자는 끊겨 있던 시간(ms)이다.
   *
   * 그 사이 체결은 영영 오지 않는다. 그냥 두면 거래대금이 0인 구간이 되어
   * 창이 조용해 보이고, 그 창이 완결되면 기준선 중앙값까지 낮아진다.
   * 호출부가 REST로 메워야 한다.
   */
  onGap: (gapMs: number) => void;
  onLog: (level: "info" | "warn" | "error", message: string) => void;
}

/**
 * aggTrade 스트림. 끊기면 스스로 다시 붙는다.
 *
 * 상시 프로세스라 재연결은 선택이 아니다. 바이낸스는 24시간마다 연결을
 * 끊고, 그 밖에도 네트워크 사정으로 수시로 끊긴다.
 */
export class AggTradeStream {
  readonly #options: AggTradeStreamOptions;
  #symbols: string[];
  #socket: WebSocket | null = null;
  #closed = false;
  #attempt = 0;
  #requestId = 0;
  #disconnectedAtMs: number | null = null;
  #reconnectTimer: NodeJS.Timeout | null = null;

  constructor(options: AggTradeStreamOptions) {
    this.#options = options;
    this.#symbols = [...options.symbols];
  }

  start(): void {
    this.#closed = false;
    this.#connect();
  }

  get symbols(): readonly string[] {
    return this.#symbols;
  }

  /**
   * 감시 목록을 바꾼다.
   *
   * 연결을 다시 맺지 않는다. 사용자가 채널 하나를 추가할 때마다 끊었다
   * 붙으면 그 순간 모든 종목의 체결이 끊겨 창에 구멍이 난다. 바이낸스가
   * 지원하는 SUBSCRIBE/UNSUBSCRIBE 메시지로 차이만 보낸다.
   */
  setSymbols(next: readonly string[]): void {
    const wanted = new Set(next.map((symbol) => symbol.toUpperCase()));
    const current = new Set(this.#symbols);

    const added = [...wanted].filter((symbol) => !current.has(symbol));
    const removed = [...current].filter((symbol) => !wanted.has(symbol));

    if (added.length === 0 && removed.length === 0) {
      return;
    }

    this.#symbols = [...wanted];

    // 연결이 없으면 다음 연결 때 새 목록으로 붙으므로 보낼 것이 없다.
    const socket = this.#socket;
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (added.length > 0) {
      this.#sendCommand(socket, "SUBSCRIBE", added);
      this.#options.onLog("info", `스트림 추가: ${added.join(", ")}`);
    }
    if (removed.length > 0) {
      this.#sendCommand(socket, "UNSUBSCRIBE", removed);
      this.#options.onLog("info", `스트림 해제: ${removed.join(", ")}`);
    }
  }

  #sendCommand(
    socket: WebSocket,
    method: "SUBSCRIBE" | "UNSUBSCRIBE",
    symbols: readonly string[],
  ): void {
    this.#requestId += 1;
    socket.send(
      JSON.stringify({
        method,
        params: symbols.map((symbol) => `${symbol.toLowerCase()}@aggTrade`),
        id: this.#requestId,
      }),
    );
  }

  stop(): void {
    this.#closed = true;
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#socket?.close();
    this.#socket = null;
  }

  #streamUrl(): string {
    // 설정값은 단일 스트림용 주소(.../ws)로 들어온다. 여러 종목을 한 연결로
    // 받으려면 조합 스트림(/stream?streams=...)으로 바꿔야 한다.
    const base = this.#options.wsUrl.replace(/\/ws\/?$/, "");
    const streams = this.#symbols
      .map((symbol) => `${symbol.toLowerCase()}@aggTrade`)
      .join("/");
    return `${base}/stream?streams=${streams}`;
  }

  #connect(): void {
    if (this.#closed) {
      return;
    }

    const socket = new WebSocket(this.#streamUrl());
    this.#socket = socket;

    socket.addEventListener("open", () => {
      this.#attempt = 0;

      const since = this.#disconnectedAtMs;
      if (since !== null) {
        const gapMs = Date.now() - since;
        this.#disconnectedAtMs = null;
        this.#options.onLog(
          "warn",
          `스트림 재연결됨 (${(gapMs / 1000).toFixed(1)}초 끊김)`,
        );
        this.#options.onGap(gapMs);
      } else {
        this.#options.onLog("info", "스트림 연결됨");
      }
    });

    socket.addEventListener("message", (event) => {
      this.#handleMessage(event.data);
    });

    socket.addEventListener("error", () => {
      // 상세 사유는 close 이벤트에서 다룬다. 여기서 로그를 또 내면
      // 끊길 때마다 같은 내용이 두 줄씩 쌓인다.
    });

    socket.addEventListener("close", () => {
      if (this.#closed) {
        return;
      }
      if (this.#disconnectedAtMs === null) {
        this.#disconnectedAtMs = Date.now();
      }
      this.#scheduleReconnect();
    });
  }

  #scheduleReconnect(): void {
    this.#attempt += 1;

    // 지수 백오프. 바이낸스가 막고 있는 상황에서 1초마다 두드리면
    // 차단만 길어진다. 30초에서 멈춘다.
    const delayMs = Math.min(30_000, 1000 * 2 ** (this.#attempt - 1));
    this.#options.onLog(
      "warn",
      `스트림 끊김. ${(delayMs / 1000).toFixed(0)}초 뒤 재연결 (${this.#attempt}번째)`,
    );

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, delayMs);
  }

  #handleMessage(raw: unknown): void {
    if (typeof raw !== "string") {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    if (typeof payload !== "object" || payload === null) {
      return;
    }

    // 조합 스트림은 {stream, data}로 한 겹 감싸서 온다.
    const envelope = payload as { data?: unknown };
    const data = envelope.data ?? payload;

    if (typeof data !== "object" || data === null) {
      return;
    }

    const trade = data as {
      e?: unknown;
      s?: unknown;
      p?: unknown;
      q?: unknown;
      T?: unknown;
    };

    if (trade.e !== "aggTrade" || typeof trade.s !== "string") {
      return;
    }

    const price = Number(trade.p);
    const quantity = Number(trade.q);
    const timestampMs = Number(trade.T);

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(quantity) ||
      !Number.isFinite(timestampMs)
    ) {
      return;
    }

    this.#options.onTrade({
      symbol: trade.s,
      timestampMs,
      price,
      quoteVolume: price * quantity,
    });
  }
}
