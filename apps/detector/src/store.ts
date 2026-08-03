// Supabase 접근.
//
// detector는 service_role 키로 붙는다. RLS를 통째로 우회하므로 모든
// 사용자의 채널을 읽을 수 있다. 이 키가 브라우저로 새면 전 사용자의
// 데이터가 열리므로, 절대 NEXT_PUBLIC_ 접두사를 붙이지 않는다.

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_SENSITIVITY_LEVEL,
  SENSITIVITY_LEVEL_MAX,
  SENSITIVITY_LEVEL_MIN,
  TIMEFRAMES,
  isScaleTimeframe,
  levelForScale,
  percentileToScale,
} from "@flare-alert/core";
import type {
  Alert,
  BrowserTarget,
  Channel,
  DeliveryMethod,
  Exchange,
  Timeframe,
} from "@flare-alert/core";

import type { SupabaseConfig } from "./config.js";

/**
 * 채널 + 소유자. detector는 알림을 넣을 때 user_id가 필요하다.
 *
 * 독립 모드에서는 주인이 없다. DB에서 온 채널이 아니라 설정으로 만든
 * 가짜 채널이라 저장할 곳도 보낼 사람도 없다. 그 경우 null이다.
 */
export interface OwnedChannel {
  channel: Channel;
  userId: string | null;
}

interface ChannelRow {
  id: string;
  user_id: string;
  name: string;
  enabled: boolean;
  sensitivity_level: number | null;
  scale: string | null;
  sensitivity: number | null;
  timeframes: string[] | null;
  delivery: string[] | null;
  channel_symbols: { exchange: string; symbol: string }[] | null;
}

/**
 * 채널의 민감도 위치(1~100).
 *
 * sensitivity_level이 정본이다. 그 앞의 두 세대가 남아 있을 수 있어서
 * 차례로 물러난다 — 0003~0004 이전 행(scale), 0003 이전 행(백분위).
 *
 * 이 순서는 web의 세 읽기 경로와 같아야 한다. 한 곳만 어긋나면 같은
 * 채널이 화면과 detector에서 다른 민감도로 동작한다.
 *   apps/web/src/lib/supabase/channels.ts
 *   apps/web/src/lib/channel-store.tsx (게스트 sessionStorage)
 */
function toSensitivityLevel(row: ChannelRow): number {
  if (
    row.sensitivity_level !== null &&
    Number.isFinite(row.sensitivity_level)
  ) {
    const level = Math.round(row.sensitivity_level);
    if (level >= SENSITIVITY_LEVEL_MIN && level <= SENSITIVITY_LEVEL_MAX) {
      return level;
    }
  }
  if (row.scale !== null && isScaleTimeframe(row.scale)) {
    return levelForScale(row.scale);
  }
  if (row.sensitivity !== null && Number.isFinite(row.sensitivity)) {
    return levelForScale(percentileToScale(row.sensitivity));
  }
  return DEFAULT_SENSITIVITY_LEVEL;
}

function toExchange(value: string): Exchange {
  return value === "upbit" ? "upbit" : "binance";
}

function toTimeframes(values: string[] | null): Timeframe[] {
  if (values === null) {
    return [...TIMEFRAMES];
  }
  const known = new Set<string>(TIMEFRAMES);
  return values.filter((v): v is Timeframe => known.has(v));
}

function toDelivery(values: string[] | null): DeliveryMethod[] {
  if (values === null) {
    return [];
  }
  return values.filter((v): v is DeliveryMethod => v === "browser");
}

export class Store {
  readonly #client: SupabaseClient;

  constructor(config: SupabaseConfig) {
    this.#client = createClient(config.url, config.serviceRoleKey, {
      auth: {
        // 상시 서버 프로세스다. 세션을 저장하거나 갱신할 이유가 없고,
        // 켜 두면 쓸 데 없는 타이머만 남는다.
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  /**
   * 켜져 있는 채널을 전부 읽는다.
   *
   * 종목이 없는 채널은 버린다. 아직 코인을 안 고른 채널이라 감시할 대상이
   * 없다. 전달 수단이 없는 채널도 버린다 — 감지해 봐야 갈 곳이 없다.
   */
  async loadChannels(): Promise<OwnedChannel[]> {
    const { data, error } = await this.#client
      .from("channels")
      .select(
        "id, user_id, name, enabled, sensitivity_level, scale, sensitivity, timeframes, delivery, channel_symbols(exchange, symbol)",
      )
      .eq("enabled", true);

    if (error !== null) {
      throw new Error(`채널 조회 실패: ${error.message}`);
    }

    const rows = (data ?? []) as unknown as ChannelRow[];
    const channels: OwnedChannel[] = [];

    for (const row of rows) {
      const first = row.channel_symbols?.[0];
      if (first === undefined) {
        continue;
      }

      const delivery = toDelivery(row.delivery);
      if (delivery.length === 0) {
        continue;
      }

      channels.push({
        userId: row.user_id,
        channel: {
          id: row.id,
          name: row.name,
          enabled: row.enabled,
          symbol: {
            exchange: toExchange(first.exchange),
            symbol: first.symbol,
          },
          sensitivityLevel: toSensitivityLevel(row),
          timeframes: toTimeframes(row.timeframes),
          delivery,
        },
      });
    }

    return channels;
  }

  /**
   * 알림을 기록한다.
   *
   * 실패해도 예외를 던지지 않는다. 기록에 실패했다고 발송까지 막으면
   * DB가 잠깐 흔들릴 때 알림이 통째로 끊긴다. 기록은 부가 기능이고
   * 사용자에게 닿는 것이 본질이다.
   */
  async recordAlert(alert: Alert, userId: string): Promise<boolean> {
    const { error } = await this.#client.from("alerts").insert({
      user_id: userId,
      channel_id: alert.channelId,
      exchange: alert.target.exchange,
      symbol: alert.target.symbol,
      fired_at: new Date(alert.firedAtMs).toISOString(),
      price: alert.price,
      percentile: alert.percentile,
      score: alert.score,
      quote_volume: alert.quoteVolume,
      ratio_to_median: alert.ratioToMedian,
      scale: alert.scale,
    });

    return error === null;
  }

  /** 이 사용자의 푸시 구독 전부. 기기마다 하나씩이라 여러 개일 수 있다. */
  async loadSubscriptions(userId: string): Promise<BrowserTarget[]> {
    const { data, error } = await this.#client
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", userId);

    if (error !== null) {
      throw new Error(`푸시 구독 조회 실패: ${error.message}`);
    }

    return (data ?? []) as BrowserTarget[];
  }

  /**
   * 죽은 구독을 지운다.
   *
   * 푸시 서비스가 404나 410을 주면 그 구독은 영영 못 쓴다. 사용자가
   * 브라우저 데이터를 지웠거나 알림을 껐다는 뜻이다. 놔두면 알림마다
   * 실패하는 요청이 계속 나간다.
   */
  async dropSubscription(endpoint: string): Promise<void> {
    await this.#client
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint);
  }

  /** 발송에 성공한 구독의 시각을 갱신한다. 오래 죽어 있는 기기를 볼 때 쓴다. */
  async markSubscriptionSuccess(endpoint: string): Promise<void> {
    await this.#client
      .from("push_subscriptions")
      .update({ last_success_at: new Date().toISOString() })
      .eq("endpoint", endpoint);
  }
}
