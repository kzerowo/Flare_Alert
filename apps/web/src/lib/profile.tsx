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

import {
  DEFAULT_MEMBERSHIP,
  channelLimit,
  effectivePlan,
  toMembership,
} from "@flare-alert/core";
import type { Membership, Plan } from "@flare-alert/core";

import { useAuth } from "./auth";
import { getBrowserClient } from "./supabase/client";

// ---------------------------------------------------------------------------
// 요금제 상태
//
// profiles 행에서 plan/role/plan_expires_at만 읽는다. RLS의 "본인 프로필만
// 다룬다"(0001)가 그대로 적용되므로 남의 요금제는 애초에 보이지 않는다.
//
// 게스트와 로딩 중에는 무료로 가정한다. 반대로 두면 프로필을 읽는 사이에
// 채널 만들기 버튼이 열려 있고, 그때 만든 채널이 저장 단계에서 DB 트리거에
// 거절당한다(0006).
// ---------------------------------------------------------------------------

interface ProfileStore {
  membership: Membership;
  /** 첫 조회가 끝났는지. 게스트는 조회할 것이 없어 즉시 true다. */
  loaded: boolean;
  /** 만료·권한까지 반영한 요금제. 화면은 membership.plan 말고 이걸 본다. */
  plan: Plan;
  isAdmin: boolean;
  /** 만들 수 있는 채널 수. null이면 무제한. */
  channelLimit: number | null;
  /** 관리자 화면에서 자기 요금제를 바꾼 뒤처럼, 다시 읽어야 할 때. */
  refresh: () => void;
}

const Context = createContext<ProfileStore | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user, loaded: authLoaded } = useAuth();
  const client = getBrowserClient();

  const [membership, setMembership] = useState<Membership>(DEFAULT_MEMBERSHIP);
  const [loaded, setLoaded] = useState(false);
  const [nonce, setNonce] = useState(0);

  const signedIn = user !== null && client !== null;

  useEffect(() => {
    if (!authLoaded) {
      return;
    }

    if (!signedIn) {
      setMembership(DEFAULT_MEMBERSHIP);
      setLoaded(true);
      return;
    }

    let alive = true;
    setLoaded(false);

    void (async () => {
      const { data, error } = await client
        .from("profiles")
        .select("plan, role, plan_expires_at")
        .eq("id", user.id)
        .maybeSingle();

      if (!alive) {
        return;
      }

      // 실패하면 무료로 둔다. 화면에 오류를 띄우지 않는 이유는, 이 값이
      // 없어도 앱이 도는 데 지장이 없고(무료로 보일 뿐) DB가 최종
      // 판정을 하기 때문이다. pro 사용자가 잠깐 무료로 보이는 편이
      // 그 반대보다 낫다.
      if (error !== null || data === null) {
        setMembership(DEFAULT_MEMBERSHIP);
        setLoaded(true);
        return;
      }

      const expires =
        data.plan_expires_at === null
          ? null
          : Date.parse(data.plan_expires_at);

      setMembership(
        toMembership({
          plan: data.plan,
          role: data.role,
          planExpiresAt: Number.isNaN(expires) ? null : expires,
        }),
      );
      setLoaded(true);
    })();

    return () => {
      alive = false;
    };
  }, [authLoaded, signedIn, client, user, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const value = useMemo<ProfileStore>(() => {
    return {
      membership,
      loaded,
      plan: effectivePlan(membership),
      isAdmin: membership.role === "admin",
      channelLimit: channelLimit(membership),
      refresh,
    };
  }, [membership, loaded, refresh]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useProfile(): ProfileStore {
  const found = useContext(Context);
  if (found === null) {
    throw new Error("ProfileProvider 안에서만 쓸 수 있습니다");
  }
  return found;
}
