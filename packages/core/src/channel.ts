import { SENSITIVITY_DEFAULT, TIMEFRAMES } from "./constants.js";
import type { Channel, DeliveryMethod, SymbolRef } from "./types.js";

/**
 * 코인 선택 목록.
 *
 * 바이낸스 USDT 마켓에서 거래가 활발한 종목들이다. 거래소 전체 목록을
 * 실시간으로 받아오는 편이 정확하지만, 그러려면 API 호출과 실패 처리가
 * 붙는다. 채널 UI를 먼저 세우는 단계라 고정 목록으로 시작한다.
 */
export const POPULAR_BINANCE_SYMBOLS: readonly string[] = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "BNBUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "TRXUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "DOTUSDT",
  "MATICUSDT",
  "LTCUSDT",
  "SHIBUSDT",
  "UNIUSDT",
  "ATOMUSDT",
  "ETCUSDT",
  "APTUSDT",
  "ARBUSDT",
  "OPUSDT",
  "FILUSDT",
  "NEARUSDT",
  "INJUSDT",
  "SUIUSDT",
  "SEIUSDT",
  "TIAUSDT",
  "PEPEUSDT",
  "WIFUSDT",
  "ANKRUSDT",
  "ONEUSDT",
  "CHZUSDT",
  "SANDUSDT",
];

/** 채널 하나에 넣을 수 있는 코인 수. */
export const MAX_SYMBOLS_PER_CHANNEL = 20;

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
 */
export function createChannel(overrides: Partial<Channel> = {}): Channel {
  counter += 1;

  return {
    id: `ch_${Date.now().toString(36)}_${counter.toString(36)}`,
    name: "새 채널",
    enabled: true,
    symbols: [],
    sensitivity: SENSITIVITY_DEFAULT,
    timeframes: [...TIMEFRAMES],
    delivery: ["browser"],
    ...overrides,
  };
}

export type ChannelProblem =
  | "empty_name"
  | "name_too_long"
  | "no_symbols"
  | "too_many_symbols"
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

  if (channel.symbols.length === 0) {
    problems.push("no_symbols");
  } else if (channel.symbols.length > MAX_SYMBOLS_PER_CHANNEL) {
    problems.push("too_many_symbols");
  }

  if (channel.delivery.length === 0) {
    problems.push("no_delivery");
  }

  return problems;
}

export const CHANNEL_PROBLEM_MESSAGE: Record<ChannelProblem, string> = {
  empty_name: "채널 이름을 입력해주세요.",
  name_too_long: `채널 이름은 ${MAX_CHANNEL_NAME_LENGTH}자까지입니다.`,
  no_symbols: "코인을 하나 이상 선택해주세요.",
  too_many_symbols: `코인은 채널당 ${MAX_SYMBOLS_PER_CHANNEL}개까지입니다.`,
  no_delivery: "알림 받을 방법을 하나 이상 골라주세요.",
};

/** 게스트가 쓸 수 있는 전달 수단. 텔레그램은 계정 연결이 필요하다. */
export const GUEST_DELIVERY_METHODS: readonly DeliveryMethod[] = ["browser"];
