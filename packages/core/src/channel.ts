import { DEFAULT_SCALE, TIMEFRAMES } from "./constants.js";
import type { Channel, DeliveryMethod, SymbolRef } from "./types.js";

/**
 * 코인 선택 목록. 바이낸스 시가총액 순위 기준.
 *
 * 전부 바이낸스 USDT 마켓에서 실제로 거래 중인(status TRADING) 종목이다.
 * detector가 바이낸스 WebSocket에 붙는 구조라, 거기 없는 종목은 화면에
 * 보여줘도 감시가 되지 않는다. 목록을 늘릴 때는 상장 여부를 먼저 확인한다.
 * (2026-07-29 기준 XMR은 상장폐지로 BREAK, HYPE는 현물 미상장이라 제외됨)
 *
 * 아이콘은 apps/web/public/coins/ 에 심볼 소문자 이름으로 들어 있다.
 * 여기에 종목을 추가하면 아이콘도 같이 넣어야 한다. 없으면 색 점으로
 * 대체되므로 화면이 깨지지는 않는다.
 */
export const POPULAR_BINANCE_SYMBOLS: readonly string[] = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "SOLUSDT",
  "TRXUSDT",
  "DOGEUSDT",
  "XLMUSDT",
  "ZECUSDT",
  "WBTCUSDT",
  "WBETHUSDT",
  "LINKUSDT",
  "ADAUSDT",
];

/** 채널 이름 길이 제한. */
export const MAX_CHANNEL_NAME_LENGTH = 24;

export function toBinanceSymbol(symbol: string): SymbolRef {
  return { exchange: "binance", symbol };
}

/** "BTCUSDT" -> "BTC". 화면에는 견적 통화를 빼고 보여준다. */
export function displaySymbol(symbol: string): string {
  if (symbol.endsWith("USDT")) {
    return symbol.slice(0, -4);
  }
  return symbol;
}

let counter = 0;

/**
 * 새 채널의 기본값.
 *
 * id는 저장소가 정해지면 서버가 발급하게 된다. 지금은 브라우저 세션
 * 안에서만 유효하면 되므로 시각과 카운터를 조합한다. 같은 밀리초에
 * 두 개를 만들어도 겹치지 않는다.
 *
 * 이름은 비워 둔다. core는 사용자 언어를 모르므로 기본 이름을 여기서
 * 정할 수 없다. 화면 쪽에서 번역된 이름을 넣어 부른다.
 */
export function createChannel(overrides: Partial<Channel> = {}): Channel {
  counter += 1;

  return {
    id: `ch_${Date.now().toString(36)}_${counter.toString(36)}`,
    name: "",
    enabled: true,
    symbol: null,
    scale: DEFAULT_SCALE,
    timeframes: [...TIMEFRAMES],
    delivery: ["browser"],
    ...overrides,
  };
}

export type ChannelProblem =
  | "empty_name"
  | "name_too_long"
  | "no_symbol"
  | "no_delivery";

/** 저장 전에 확인한다. 문제가 없으면 빈 배열. */
export function validateChannel(channel: Channel): ChannelProblem[] {
  const problems: ChannelProblem[] = [];

  const name = channel.name.trim();
  if (name.length === 0) {
    problems.push("empty_name");
  } else if (name.length > MAX_CHANNEL_NAME_LENGTH) {
    problems.push("name_too_long");
  }

  if (channel.symbol === null) {
    problems.push("no_symbol");
  }

  if (channel.delivery.length === 0) {
    problems.push("no_delivery");
  }

  return problems;
}

// 문제를 문장으로 바꾸는 일은 core가 하지 않는다.
// 웹은 사용자가 고른 언어로, detector는 나중에 텔레그램 수신자의 언어로
// 써야 한다. 여기서 한 언어를 고르면 양쪽 다 틀린다.
// 화면용 번역은 apps/web/src/lib/i18n.tsx의 formatProblem에 있다.

/** 게스트가 쓸 수 있는 전달 수단. 텔레그램은 계정 연결이 필요하다. */
export const GUEST_DELIVERY_METHODS: readonly DeliveryMethod[] = ["browser"];
