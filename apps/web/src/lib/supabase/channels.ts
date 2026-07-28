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
  return values.filter(
    (v): v is DeliveryMethod => v === "browser" || v === "telegram",
  );
}

function toExchange(value: string): Exchange {
  if (value === "upbit") {
    return "upbit";
  }
  return "binance";
}

function toChannel(row: ChannelRow, symbols: ChannelSymbolRow[]): Channel {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    sensitivity: row.sensitivity,
    timeframes: toTimeframes(row.timeframes),
    delivery: toDelivery(row.delivery),
    symbols: symbols.map((s) => ({
      exchange: toExchange(s.exchange),
      symbol: s.symbol,
    })),
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

async function replaceSymbols(
  client: Client,
  channelId: string,
  symbols: readonly SymbolRef[],
): Promise<void> {
  // 전부 지우고 다시 넣지 않는다. 그 사이에 종목이 하나도 없는 순간이
  // 생기는데, 그때 detector가 읽으면 채널이 아무것도 감시하지 않게 된다.
  // 빠진 것만 지우고 새 것만 넣는다.
  const keep = symbols.map((s) => s.symbol);

  if (keep.length === 0) {
    const { error } = await client
      .from("channel_symbols")
      .delete()
      .eq("channel_id", channelId);
    if (error !== null) {
      throw new Error(`감시 종목을 지우지 못했습니다: ${error.message}`);
    }
    return;
  }

  const { error: deleteError } = await client
    .from("channel_symbols")
    .delete()
    .eq("channel_id", channelId)
    .not("symbol", "in", `(${keep.map((s) => `"${s}"`).join(",")})`);

  if (deleteError !== null) {
    throw new Error(`감시 종목을 정리하지 못했습니다: ${deleteError.message}`);
  }

  const { error: insertError } = await client.from("channel_symbols").upsert(
    symbols.map((s) => ({
      channel_id: channelId,
      exchange: s.exchange,
      symbol: s.symbol,
    })),
    { onConflict: "channel_id,exchange,symbol", ignoreDuplicates: true },
  );

  if (insertError !== null) {
    throw new Error(`감시 종목을 저장하지 못했습니다: ${insertError.message}`);
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

  await replaceSymbols(client, data.id, channel.symbols);

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

  await replaceSymbols(client, channel.id, channel.symbols);
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
