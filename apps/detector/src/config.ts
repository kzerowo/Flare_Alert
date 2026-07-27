// 환경변수 로딩과 검증.
// 값이 없으면 프로세스 시작 시점에 즉시 죽인다.
// 상시 프로세스라서 몇 시간 뒤에 undefined로 터지는 것보다 부팅 실패가 낫다.

export interface DetectorConfig {
  /** 바이낸스 aggTrade 스트림 엔드포인트 */
  binanceWsUrl: string;
  /** 텔레그램 봇 토큰 */
  telegramBotToken: string;
  /** 헬스체크용 HTTP 포트 */
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`필수 환경변수가 없습니다: ${name}`);
  }
  return value;
}

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

  return {
    binanceWsUrl: optionalEnv(
      "BINANCE_WS_URL",
      "wss://stream.binance.com:9443/ws",
    ),
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    port,
    logLevel,
  };
}
