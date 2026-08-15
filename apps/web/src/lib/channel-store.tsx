"use client";

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

import {
  DEFAULT_SENSITIVITY_LEVEL,
  SENSITIVITY_LEVEL_MAX,
  SENSITIVITY_LEVEL_MIN,
  isScaleTimeframe,
  levelForScale,
  percentileToScale,
} from "@flare-alert/core";
import type { Channel } from "@flare-alert/core";

import { useAuth } from "./auth";
import { useProfile } from "./profile";
import { getBrowserClient } from "./supabase/client";
import {
  createChannelRow,
  deleteChannelRow,
  loadChannels,
  updateChannelRow,
} from "./supabase/channels";

// ---------------------------------------------------------------------------
// 채널 저장소
//
// 게스트는 sessionStorage에 담는다. 탭이 살아 있는 동안만 유지되고 브라우저를
// 닫으면 사라지는데, 이게 게스트 모델과 정확히 맞는다. 게스트 알림은 브라우저
// 알림뿐이고 그건 탭이 열려 있어야 울리므로, 데이터가 탭보다 오래 남을 이유가
// 없다.
//
// localStorage를 쓰면 탭을 닫아도 채널이 남는데, 정작 알림은 안 오는 상태가
// 된다. "채널을 만들어뒀는데 알림이 안 온다"는 오해를 만든다.
//
// 로그인하면 Supabase로 옮겨간다. 이때 게스트로 만들어 둔 채널은 계정으로
// 옮긴다. 로그인했다고 방금 만든 것이 사라지면 로그인이 손해가 된다.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "flare-alert.channels.v1";

/** 화면에 띄울 실패 종류. 문구는 i18n에서 붙인다. */
export type StoreProblem = "load" | "save" | "limit";

interface ChannelStore {
  channels: Channel[];
  /** 저장소를 아직 읽는 중인지. 첫 렌더에서 빈 목록을 깜빡이지 않게 한다. */
  loaded: boolean;
  /** 계정에 저장되는 중인지. false면 이 탭에서만 유지된다. */
  persistent: boolean;
  /** 만들 수 있는 채널 수. null이면 무제한(pro/관리자). */
  limit: number | null;
  /** 지금 더 만들 수 있는지. 화면은 이걸 보고 만들기 버튼을 잠근다. */
  atLimit: boolean;
  problem: StoreProblem | null;
  dismissProblem: () => void;
  add: (channel: Channel) => void;
  update: (channel: Channel) => void;
  remove: (id: string) => void;
}

/**
 * DB가 한도로 거절했는지.
 *
 * 0006의 enforce_channel_limit()이 던지는 문자열이다. 이걸 구분하지 않으면
 * 네 번째 채널을 만들었을 때 "저장하지 못했습니다"라는, 무엇을 고쳐야
 * 하는지 알 수 없는 문구가 뜬다.
 */
function isLimitError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("channel_limit_reached")
  );
}

const Context = createContext<ChannelStore | null>(null);

/**
 * 저장된 채널 하나를 지금 모양에 맞춘다.
 *
 * 1채널 1종목으로 바꾸기 전에는 symbols 배열이었다. 브라우저에 그때
 * 저장된 게스트 데이터가 남아 있으면 channel.symbol이 undefined가 되어
 * `channel.symbol.symbol` 같은 접근에서 그대로 죽는다. 게스트 데이터는
 * 세션 한정이라 마이그레이션할 가치가 없으니, 옛 모양이 보이면 첫 종목만
 * 건지고 나머지는 버린다.
 */
function normalizeChannel(raw: unknown): Channel | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const record = { ...(raw as Record<string, unknown>) };

  if ("symbols" in record && Array.isArray(record.symbols)) {
    const [first] = record.symbols as unknown[];
    record.symbol = first ?? null;
  } else if (!("symbol" in record) || record.symbol === undefined) {
    record.symbol = null;
  }

  // 민감도는 세 세대를 거쳤다 — 백분위, 봉 길이(다섯 칸), 그리고 지금의
  // 1~100 위치. 게스트 데이터는 세션에 얼마든지 오래 남아 있을 수 있어서
  // 세 모양을 다 받아 준다. 순서는 detector·Supabase 읽기 경로와 같다.
  //   apps/detector/src/store.ts
  //   apps/web/src/lib/supabase/channels.ts
  const level = record.sensitivityLevel;
  const hasLevel =
    typeof level === "number" &&
    Number.isFinite(level) &&
    level >= SENSITIVITY_LEVEL_MIN &&
    level <= SENSITIVITY_LEVEL_MAX;

  if (!hasLevel) {
    if (typeof record.scale === "string" && isScaleTimeframe(record.scale)) {
      record.sensitivityLevel = levelForScale(record.scale);
    } else if (
      typeof record.sensitivity === "number" &&
      Number.isFinite(record.sensitivity)
    ) {
      record.sensitivityLevel = levelForScale(
        percentileToScale(record.sensitivity),
      );
    } else {
      record.sensitivityLevel = DEFAULT_SENSITIVITY_LEVEL;
    }
  } else {
    record.sensitivityLevel = Math.round(level);
  }

  return record as unknown as Channel;
}

function readSession(): Channel[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(normalizeChannel)
      .filter((c): c is Channel => c !== null);
  } catch {
    // 저장 형식이 바뀌었거나 손상된 경우. 빈 상태로 시작하는 편이
    // 오류 화면을 띄우는 것보다 낫다.
    return [];
  }
}

function writeSession(channels: readonly Channel[]): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(channels));
  } catch {
    // 시크릿 모드 등에서 저장이 막힐 수 있다. 화면 동작은 계속되어야 한다.
  }
}

function clearSession(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 지우지 못해도 계정 쪽이 정답이므로 화면에는 영향이 없다.
  }
}

export function ChannelStoreProvider({ children }: { children: ReactNode }) {
  const { user, loaded: authLoaded } = useAuth();
  // 게스트에게도 같은 한도를 건다. 게스트는 프로필이 없어 무료로 잡히는데,
  // 이게 맞는 동작이다 — 게스트가 열 개를 만들어 두고 로그인하면 그중
  // 일곱 개가 DB 트리거에 거절당하는 편이 훨씬 나쁘다.
  const { channelLimit: limit } = useProfile();
  const client = getBrowserClient();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState<StoreProblem | null>(null);

  const signedIn = user !== null && client !== null;

  // 계정 모드에서는 sessionStorage에 쓰지 않는다. 이 값이 없으면 로그인
  // 직후 계정에서 읽어온 채널을 세션에도 복사해 버려서, 로그아웃했을 때
  // 남의 자리에 남는다.
  const persistent = signedIn;

  // ---- 불러오기 -----------------------------------------------------------
  useEffect(() => {
    if (!authLoaded) {
      return;
    }

    let alive = true;

    if (!signedIn) {
      // 서버 렌더에는 sessionStorage가 없다. 마운트 후에 읽는다.
      setChannels(readSession());
      setLoaded(true);
      return;
    }

    setLoaded(false);

    void (async () => {
      try {
        const stored = await loadChannels(client);

        // 게스트로 만들어 둔 것이 있으면 계정으로 옮긴다.
        const pending = readSession();
        if (pending.length > 0 && user !== null) {
          const moved: Channel[] = [];
          let hitLimit = false;

          for (const channel of pending) {
            try {
              moved.push(await createChannelRow(client, user.id, channel));
            } catch (error) {
              // 계정에 이미 채널이 있으면 게스트 것까지 합쳐 한도를 넘길 수
              // 있다. 여기서 통째로 실패하면 옮길 수 있었던 것까지 잃는다.
              // 들어가는 만큼 넣고 나머지는 포기한 뒤 이유를 알린다.
              if (!isLimitError(error)) {
                throw error;
              }
              hitLimit = true;
              break;
            }
          }

          // 못 옮긴 것이 남아 있어도 세션은 비운다. 남겨 두면 새로고침할
          // 때마다 같은 거절을 반복하고, 그때마다 오류 배너가 다시 뜬다.
          clearSession();

          if (alive) {
            setChannels([...stored, ...moved]);
            setLoaded(true);
            if (hitLimit) {
              setProblem("limit");
            }
          }
          return;
        }

        if (alive) {
          setChannels(stored);
          setLoaded(true);
        }
      } catch {
        if (alive) {
          setProblem("load");
          setChannels([]);
          setLoaded(true);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [authLoaded, signedIn, client, user]);

  // ---- 게스트 저장 --------------------------------------------------------
  useEffect(() => {
    if (loaded && !persistent) {
      writeSession(channels);
    }
  }, [channels, loaded, persistent]);

  // ---- 바꾸기 -------------------------------------------------------------
  //
  // 화면은 먼저 바꾸고 서버에는 뒤이어 쓴다. 왕복을 기다리면 슬라이더를
  // 옮길 때마다 화면이 멈춘 것처럼 보인다. 실패하면 되돌리고 알린다.

  const previous = useRef<Channel[]>([]);
  previous.current = channels;

  const runWrite = useCallback(
    (work: () => Promise<void>) => {
      const snapshot = previous.current;

      void work().catch((error: unknown) => {
        setProblem(isLimitError(error) ? "limit" : "save");
        setChannels(snapshot);
      });
    },
    [],
  );

  // 한도는 화면에서도 막는다. DB 트리거가 최종 판정이지만, 거기까지 가면
  // 폼을 다 채우고 저장을 누른 뒤에야 되돌아간다.
  const atLimit = limit !== null && channels.length >= limit;

  const add = useCallback(
    (channel: Channel) => {
      if (limit !== null && previous.current.length >= limit) {
        setProblem("limit");
        return;
      }

      setChannels((list) => [...list, channel]);

      if (!signedIn || user === null) {
        return;
      }

      runWrite(async () => {
        const saved = await createChannelRow(client, user.id, channel);
        // 데이터베이스가 발급한 id로 바꿔 둔다. 이걸 안 하면 이어지는
        // 편집·삭제가 존재하지 않는 id를 가리킨다.
        setChannels((list) =>
          list.map((item) => (item.id === channel.id ? saved : item)),
        );
      });
    },
    [signedIn, user, client, runWrite, limit],
  );

  const update = useCallback(
    (channel: Channel) => {
      setChannels((list) =>
        list.map((item) => (item.id === channel.id ? channel : item)),
      );

      if (!signedIn) {
        return;
      }

      runWrite(() => updateChannelRow(client, channel));
    },
    [signedIn, client, runWrite],
  );

  const remove = useCallback(
    (id: string) => {
      setChannels((list) => list.filter((item) => item.id !== id));

      if (!signedIn) {
        return;
      }

      runWrite(() => deleteChannelRow(client, id));
    },
    [signedIn, client, runWrite],
  );

  const dismissProblem = useCallback(() => setProblem(null), []);

  const value = useMemo(
    () => ({
      channels,
      loaded,
      persistent,
      limit,
      atLimit,
      problem,
      dismissProblem,
      add,
      update,
      remove,
    }),
    [
      channels,
      loaded,
      persistent,
      limit,
      atLimit,
      problem,
      dismissProblem,
      add,
      update,
      remove,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useChannels(): ChannelStore {
  const store = useContext(Context);
  if (store === null) {
    throw new Error("ChannelStoreProvider 안에서만 쓸 수 있습니다");
  }
  return store;
}
