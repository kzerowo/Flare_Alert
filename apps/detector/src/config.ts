// 환경변수 로딩과 검증.
// 값이 없으면 프로세스 시작 시점에 즉시 죽인다.
// 상시 프로세스라서 몇 시간 뒤에 undefined로 터지는 것보다 부팅 실패가 낫다.

export interface DetectorConfig {
  /** 바이낸스 aggTrade 스트림 엔드포인트 */
  binanceWsUrl: string;
  /**
   * 텔레그램 봇 토큰.
   *
   * 아직 발송 단계가 없어서 비어 있어도 부팅한다. 발송을 붙이는 순간
   * 필수로 되돌려야 한다 — 상시 프로세스라 몇 시간 뒤에 undefined로
   * 터지는 것보다 부팅 실패가 낫다.
   */
  telegramBotToken: string | null;
  /** 감시할 종목. 비워 두면 기본 목록을 쓴다. */
  symbols: string[];
  /** 헬스체크용 HTTP 포트 */
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

/**
 * 기본 감시 종목.
 *
 * 채널을 DB에서 읽는 단계가 아직 없어서, 그때까지는 이 목록을 본다.
 * 검증용이라 좁게 잡았다 — 종목 하나당 부팅 때 과거 20일치(약 29회)
 * 요청이 나가므로 늘릴수록 시작이 느려진다.
 */
const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return fallback;
  }
  return value;
}

export function loadConfig(): DetectorConfig {
  const rawLogLevel = optionalEnv("LOG_LEVEL", "info");

  let logLevel: DetectorConfig["logLevel"];
  if (
    rawLogLevel === "debug" ||
    rawLogLevel === "info" ||
    rawLogLevel === "warn" ||
    rawLogLevel === "error"
  ) {
    logLevel = rawLogLevel;
  } else {
    throw new Error(`LOG_LEVEL 값이 올바르지 않습니다: ${rawLogLevel}`);
  }

  const port = Number.parseInt(optionalEnv("PORT", "8080"), 10);
  if (Number.isNaN(port)) {
    throw new Error("PORT는 숫자여야 합니다");
  }

  const rawSymbols = optionalEnv("DETECTOR_SYMBOLS", "");
  const symbols =
    rawSymbols === ""
      ? [...DEFAULT_SYMBOLS]
      : rawSymbols
          .split(",")
          .map((symbol) => symbol.trim().toUpperCase())
          .filter((symbol) => symbol !== "");

  if (symbols.length === 0) {
    throw new Error("DETECTOR_SYMBOLS에 종목이 하나도 없습니다");
  }

  const telegramBotToken = process.env["TELEGRAM_BOT_TOKEN"];

  return {
    binanceWsUrl: optionalEnv(
      "BINANCE_WS_URL",
      "wss://stream.binance.com:9443/ws",
    ),
    telegramBotToken:
      telegramBotToken === undefined || telegramBotToken === ""
        ? null
        : telegramBotToken,
    symbols,
    port,
    logLevel,
  };
}
