"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import type { Channel } from "@flare-alert/core";

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
// 로그인 회원은 계정에 저장한다. 저장소가 정해지면 이 파일에 서버 동기화를
// 붙인다. 화면 쪽 코드는 이 훅만 쓰므로 바꿀 것이 없다.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "flare-alert.channels.v1";

interface ChannelStore {
  channels: Channel[];
  /** 저장소를 아직 읽는 중인지. 첫 렌더에서 빈 목록을 깜빡이지 않게 한다. */
  loaded: boolean;
  add: (channel: Channel) => void;
  update: (channel: Channel) => void;
  remove: (id: string) => void;
}

const Context = createContext<ChannelStore | null>(null);

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

    return parsed as Channel[];
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

export function ChannelStoreProvider({ children }: { children: ReactNode }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loaded, setLoaded] = useState(false);

  // 서버 렌더에는 sessionStorage가 없다. 마운트 후에 읽는다.
  useEffect(() => {
    setChannels(readSession());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) {
      writeSession(channels);
    }
  }, [channels, loaded]);

  const add = useCallback((channel: Channel) => {
    setChannels((previous) => [...previous, channel]);
  }, []);

  const update = useCallback((channel: Channel) => {
    setChannels((previous) =>
      previous.map((item) => (item.id === channel.id ? channel : item)),
    );
  }, []);

  const remove = useCallback((id: string) => {
    setChannels((previous) => previous.filter((item) => item.id !== id));
  }, []);

  const value = useMemo(
    () => ({ channels, loaded, add, update, remove }),
    [channels, loaded, add, update, remove],
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
