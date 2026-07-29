import { SENSITIVITY_DEFAULT, TIMEFRAMES } from "@flare-alert/core";
import type {
  Channel,
  DeliveryMethod,
  Exchange,
  SymbolRef,
  Timeframe,
} from "@flare-alert/core";

import type { Client } from "./client";
import type { ChannelRow, ChannelSymbolRow } from "./types";

/*
 * 채널 읽기/쓰기.
 *
 * 브라우저에서 직접 질의한다. 중간에 API 라우트를 두면 코드가 두 배가
 * 되는데, RLS가 이미 "남의 행은 보이지도 않는다"를 보장하므로 그 층이
 * 막아 줄 것이 없다. (supabase/migrations/0001_init.sql 참고)
 */

// ---------------------------------------------------------------------------
// 행 → 도메인
//
// 데이터베이스의 text[]는 우리 유니온 타입을 모른다. 그냥 캐스팅하면
// 스키마를 손으로 고쳤을 때 이상한 값이 조용히 들어온다. 걸러서 받는다.
// ---------------------------------------------------------------------------

function toTimeframes(values: string[]): Timeframe[] {
  const known = new Set<string>(TIMEFRAMES);
  const kept = values.filter((v): v is Timeframe => known.has(v));

  // 전부 걸러졌으면 감시할 프레임이 없다는 뜻이 되어 채널이 죽는다.
  if (kept.length === 0) {
    return [...TIMEFRAMES];
  }
  return kept;
}

function toDelivery(values: string[]): DeliveryMethod[] {
  return values.filter((v): v is DeliveryMethod => v === "browser");
}

function toExchange(value: string): Exchange {
  if (value === "upbit") {
    return "upbit";
  }
  return "binance";
}

/**
 * 채널당 종목은 하나다.
 *
 * 그런데도 channel_symbols를 별도 테이블로 남겨 둔다. detector가 매초
 * 던지는 질문이 "이 종목을 보는 채널이 누구인가"라는 역방향 조회이고,
 * 여기에 인덱스를 걸 수 있는 형태가 필요하기 때문이다.
 *
 * 1채널 1종목으로 바꾸기 전에 만들어진 행은 여러 개일 수 있다.
 * 그럴 땐 첫 번째만 쓴다. 화면이 깨지는 것보다 낫다.
 */
function toChannel(row: ChannelRow, symbols: ChannelSymbolRow[]): Channel {
  const first = symbols[0];

  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    sensitivity: row.sensitivity,
    timeframes: toTimeframes(row.timeframes),
    delivery: toDelivery(row.delivery),
    symbol:
      first === undefined
        ? null
        : { exchange: toExchange(first.exchange), symbol: first.symbol },
  };
}

// ---------------------------------------------------------------------------
// 읽기
// ---------------------------------------------------------------------------

/**
 * 로그인한 사용자의 채널 전부.
 *
 * 채널과 종목을 각각 한 번씩 읽어 메모리에서 붙인다. 채널마다 종목을
 * 따로 조회하면 N+1이 된다. 한 사람의 채널은 많아야 수십 개라 두 번의
 * 왕복이면 충분하다.
 */
export async function loadChannels(client: Client): Promise<Channel[]> {
  const { data: rows, error } = await client
    .from("channels")
    .select("*")
    .order("created_at", { ascending: true });

  if (error !== null) {
    throw new Error(`채널을 읽지 못했습니다: ${error.message}`);
  }
  if (rows === null || rows.length === 0) {
    return [];
  }

  const { data: symbolRows, error: symbolError } = await client
    .from("channel_symbols")
    .select("*")
    .in(
      "channel_id",
      rows.map((r) => r.id),
    );

  if (symbolError !== null) {
    throw new Error(`감시 종목을 읽지 못했습니다: ${symbolError.message}`);
  }

  const byChannel = new Map<string, ChannelSymbolRow[]>();
  for (const row of symbolRows ?? []) {
    const list = byChannel.get(row.channel_id);
    if (list === undefined) {
      byChannel.set(row.channel_id, [row]);
    } else {
      list.push(row);
    }
  }

  return rows.map((row) => toChannel(row, byChannel.get(row.id) ?? []));
}

// ---------------------------------------------------------------------------
// 쓰기
// ---------------------------------------------------------------------------

/**
 * 채널이 감시하는 종목을 지정한 하나로 맞춘다.
 *
 * 먼저 넣고 나중에 지운다. 순서를 뒤집으면 그 사이에 종목이 하나도 없는
 * 순간이 생기고, 그때 detector가 읽으면 채널이 아무것도 감시하지 않게 된다.
 */
async function setSymbol(
  client: Client,
  channelId: string,
  symbol: SymbolRef | null,
): Promise<void> {
  if (symbol !== null) {
    const { error } = await client.from("channel_symbols").upsert(
      {
        channel_id: channelId,
        exchange: symbol.exchange,
        symbol: symbol.symbol,
      },
      { onConflict: "channel_id,exchange,symbol", ignoreDuplicates: true },
    );

    if (error !== null) {
      throw new Error(`감시 종목을 저장하지 못했습니다: ${error.message}`);
    }
  }

  // 방금 넣은 것 말고 남아 있는 행을 정리한다.
  // 1채널 1종목으로 바꾸기 전에 만들어진 행이 있을 수 있다.
  let stale = client
    .from("channel_symbols")
    .delete()
    .eq("channel_id", channelId);

  if (symbol !== null) {
    stale = stale.neq("symbol", symbol.symbol);
  }

  const { error: deleteError } = await stale;
  if (deleteError !== null) {
    throw new Error(`감시 종목을 정리하지 못했습니다: ${deleteError.message}`);
  }
}

/**
 * 새 채널.
 *
 * id는 넘기지 않는다. 게스트 시절의 id("ch_...")는 uuid가 아니라
 * 그대로 넣으면 거절당한다. 데이터베이스가 발급한 id를 돌려준다.
 */
export async function createChannelRow(
  client: Client,
  userId: string,
  channel: Channel,
): Promise<Channel> {
  const { data, error } = await client
    .from("channels")
    .insert({
      user_id: userId,
      name: channel.name,
      enabled: channel.enabled,
      sensitivity: channel.sensitivity ?? SENSITIVITY_DEFAULT,
      timeframes: channel.timeframes,
      delivery: channel.delivery,
    })
    .select()
    .single();

  if (error !== null || data === null) {
    throw new Error(`채널을 만들지 못했습니다: ${error?.message ?? "빈 응답"}`);
  }

  await setSymbol(client, data.id, channel.symbol);

  return { ...channel, id: data.id };
}

export async function updateChannelRow(
  client: Client,
  channel: Channel,
): Promise<void> {
  const { error } = await client
    .from("channels")
    .update({
      name: channel.name,
      enabled: channel.enabled,
      sensitivity: channel.sensitivity,
      timeframes: channel.timeframes,
      delivery: channel.delivery,
    })
    .eq("id", channel.id);

  if (error !== null) {
    throw new Error(`채널을 저장하지 못했습니다: ${error.message}`);
  }

  await setSymbol(client, channel.id, channel.symbol);
}

export async function deleteChannelRow(
  client: Client,
  id: string,
): Promise<void> {
  // channel_symbols는 on delete cascade로 같이 지워진다.
  const { error } = await client.from("channels").delete().eq("id", id);

  if (error !== null) {
    throw new Error(`채널을 지우지 못했습니다: ${error.message}`);
  }
}
