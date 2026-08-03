// 환경변수 로딩과 검증.
// 값이 없으면 프로세스 시작 시점에 즉시 죽인다.
// 상시 프로세스라서 몇 시간 뒤에 undefined로 터지는 것보다 부팅 실패가 낫다.

/**
 * Supabase 연결. 둘 다 있어야 채널을 읽고 알림을 저장한다.
 *
 * 없으면 독립 모드로 돈다 — DETECTOR_SYMBOLS를 감시하고 알림을 콘솔에만
 * 낸다. 알고리즘을 확인할 때 DB 없이 띄울 수 있어야 해서 남겨 둔 길이다.
 */
export interface SupabaseConfig {
  url: string;
  /** RLS를 통째로 우회한다. 절대 NEXT_PUBLIC_ 접두사를 붙이지 않는다. */
  serviceRoleKey: string;
}

/**
 * 웹 푸시 서명 키(VAPID).
 *
 * 공개 키는 브라우저가 구독할 때 쓰므로 웹에도 같은 값이 들어간다
 * (NEXT_PUBLIC_VAPID_PUBLIC_KEY). 비밀 키는 여기에만 둔다.
 *
 * subject는 푸시 서비스가 문제 생겼을 때 연락할 곳이다. mailto: 또는
 * https: URL이어야 하고, 형식이 틀리면 발송이 통째로 거절된다.
 */
export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface DetectorConfig {
  /** 바이낸스 aggTrade 스트림 엔드포인트 */
  binanceWsUrl: string;
  /**
   * 감시할 종목의 고정 목록.
   *
   * Supabase가 붙어 있으면 채널에서 종목을 읽으므로 이 값은 무시된다.
   * 독립 모드에서만 쓴다.
   */
  symbols: string[];
  supabase: SupabaseConfig | null;
  vapid: VapidConfig | null;
  /** 헬스체크용 HTTP 포트 */
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

/**
 * 독립 모드에서 감시할 기본 종목.
 *
 * 좁게 잡았다 — 종목 하나당 부팅 때 과거 20일치(약 29회) 요청이 나가므로
 * 늘릴수록 시작이 느려진다.
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

  return {
    // USD-M 선물 스트림이다. 현물(stream.binance.com)이 아니다 —
    // 이유는 binance.ts 상단 주석 참고.
    binanceWsUrl: optionalEnv("BINANCE_WS_URL", "wss://fstream.binance.com/ws"),
    symbols,
    supabase: loadSupabase(),
    vapid: loadVapid(),
    port,
    logLevel,
  };
}

/**
 * 반쯤 설정된 상태는 거부한다.
 *
 * URL만 있고 키가 없으면 조용히 독립 모드로 도는데, 그러면 채널을 만든
 * 사용자가 알림을 못 받는 채로 아무도 눈치채지 못한다. 둘 다 있거나
 * 둘 다 없거나여야 한다.
 */
function loadSupabase(): SupabaseConfig | null {
  const url = optionalEnv("SUPABASE_URL", "");
  const serviceRoleKey = optionalEnv("SUPABASE_SERVICE_ROLE_KEY", "");

  if (url === "" && serviceRoleKey === "") {
    return null;
  }
  if (url === "" || serviceRoleKey === "") {
    throw new Error(
      "SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY는 둘 다 있거나 둘 다 없어야 합니다",
    );
  }

  return { url, serviceRoleKey };
}

function loadVapid(): VapidConfig | null {
  const publicKey = optionalEnv("VAPID_PUBLIC_KEY", "");
  const privateKey = optionalEnv("VAPID_PRIVATE_KEY", "");

  if (publicKey === "" && privateKey === "") {
    return null;
  }
  if (publicKey === "" || privateKey === "") {
    throw new Error(
      "VAPID_PUBLIC_KEY와 VAPID_PRIVATE_KEY는 둘 다 있거나 둘 다 없어야 합니다",
    );
  }

  const subject = optionalEnv("VAPID_SUBJECT", "");
  if (subject === "") {
    throw new Error(
      "VAPID_SUBJECT가 필요합니다 (mailto:you@example.com 또는 https://...)",
    );
  }
  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
    // 푸시 서비스가 형식을 검사한다. 여기서 안 막으면 발송할 때 전부 거절된다.
    throw new Error(
      `VAPID_SUBJECT는 mailto: 또는 https:// 로 시작해야 합니다: ${subject}`,
    );
  }

  return { publicKey, privateKey, subject };
}
