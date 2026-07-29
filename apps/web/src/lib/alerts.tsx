"use client";

// 알림 기록.
//
// detector가 service_role로 넣고, 사용자는 자기 것만 읽는다(RLS).
// 읽기 전용이라 채널처럼 낙관적 갱신이 필요 없다 — 사용자가 만드는
// 데이터가 아니라 시스템이 남기는 기록이다.
//
// 목록을 한 번 읽은 뒤 Realtime으로 새 행을 이어 붙인다. 탭이 열려 있는
// 동안에는 새로고침 없이 쌓인다. 탭이 닫혀 있으면 Realtime은 끊기고
// 그 자리는 웹 푸시가 맡는다 — 두 경로는 서로를 대신하지 않는다.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { TIMEFRAMES } from "@flare-alert/core";
import type { Exchange, Timeframe } from "@flare-alert/core";

import { useAuth } from "./auth";
import { getBrowserClient } from "./supabase/client";
import type { AlertRow } from "./supabase/types";

/** 화면에서 쓰는 알림 하나. */
export interface AlertRecord {
  id: string;
  channelId: string;
  exchange: Exchange;
  symbol: string;
  firedAtMs: number;
  price: number;
  percentile: number;
  score: number;
  quoteVolume: number;
  ratioToMedian: number;
  scale: Timeframe;
}

/** 한 번에 읽어 오는 개수. 더 필요하면 그때 늘린다. */
const PAGE_SIZE = 50;

const KNOWN_FRAMES = new Set<string>(TIMEFRAMES);

function toScale(value: string): Timeframe {
  // 스키마에 check 제약이 있지만 타입으로는 그냥 text다.
  return KNOWN_FRAMES.has(value) ? (value as Timeframe) : "1m";
}

function toRecord(row: AlertRow): AlertRecord {
  return {
    id: row.id,
    channelId: row.channel_id,
    exchange: row.exchange === "upbit" ? "upbit" : "binance",
    symbol: row.symbol,
    firedAtMs: new Date(row.fired_at).getTime(),
    price: row.price,
    percentile: row.percentile,
    score: row.score,
    quoteVolume: row.quote_volume,
    ratioToMedian: row.ratio_to_median,
    scale: toScale(row.scale),
  };
}

interface AlertStore {
  alerts: AlertRecord[];
  loaded: boolean;
  /** 조회에 실패했는지. 화면에 배너를 띄우는 데 쓴다. */
  failed: boolean;
  /** 아직 안 읽은 개수. 탭을 안 보고 있는 동안 쌓인 것. */
  unseen: number;
  markSeen: () => void;
  remove: (id: string) => Promise<void>;
}

const AlertContext = createContext<AlertStore | null>(null);

export function AlertStoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [unseen, setUnseen] = useState(0);

  // 목록에 이미 있는 id. Realtime이 같은 행을 두 번 보내는 경우와,
  // 첫 조회와 구독 사이에 들어온 행이 겹치는 경우를 둘 다 막는다.
  const seenIds = useRef(new Set<string>());

  const userId = user?.id ?? null;

  useEffect(() => {
    const client = getBrowserClient();

    if (client === null || userId === null) {
      setAlerts([]);
      setLoaded(true);
      setFailed(false);
      setUnseen(0);
      seenIds.current = new Set();
      return;
    }

    let cancelled = false;
    seenIds.current = new Set();

    void (async () => {
      const { data, error } = await client
        .from("alerts")
        .select("*")
        .order("fired_at", { ascending: false })
        .limit(PAGE_SIZE);

      if (cancelled) {
        return;
      }

      if (error !== null) {
        setFailed(true);
        setLoaded(true);
        return;
      }

      const records = (data ?? []).map(toRecord);
      for (const record of records) {
        seenIds.current.add(record.id);
      }

      setAlerts(records);
      setFailed(false);
      setLoaded(true);
    })();

    // 새 알림을 이어 붙인다. 필터를 걸어야 남의 행이 아예 흘러오지 않는다.
    // RLS가 막아 주긴 하지만 그건 읽기 권한 이야기이고, 필터가 없으면
    // 서버가 모든 행을 밀어 보낸 뒤 걸러진다.
    const channel = client
      .channel(`alerts:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "alerts",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const record = toRecord(payload.new as AlertRow);
          if (seenIds.current.has(record.id)) {
            return;
          }
          seenIds.current.add(record.id);

          setAlerts((previous) => [record, ...previous].slice(0, PAGE_SIZE));
          setUnseen((count) => count + 1);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [userId]);

  const markSeen = useCallback(() => {
    setUnseen(0);
  }, []);

  const remove = useCallback(async (id: string) => {
    const client = getBrowserClient();
    if (client === null) {
      return;
    }

    // 지우기는 낙관적으로 처리한다. 기록 하나가 화면에서 사라지는 것은
    // 되돌리지 못해도 손해가 없다.
    setAlerts((previous) => previous.filter((alert) => alert.id !== id));
    seenIds.current.delete(id);

    await client.from("alerts").delete().eq("id", id);
  }, []);

  const value = useMemo<AlertStore>(
    () => ({ alerts, loaded, failed, unseen, markSeen, remove }),
    [alerts, loaded, failed, unseen, markSeen, remove],
  );

  return (
    <AlertContext.Provider value={value}>{children}</AlertContext.Provider>
  );
}

export function useAlerts(): AlertStore {
  const store = useContext(AlertContext);
  if (store === null) {
    throw new Error("useAlerts는 AlertStoreProvider 안에서만 쓸 수 있습니다");
  }
  return store;
}
