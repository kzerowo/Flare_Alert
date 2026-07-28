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
import type { User } from "@supabase/supabase-js";

import { getBrowserClient } from "./supabase/client";

// ---------------------------------------------------------------------------
// 인증 상태
//
// Supabase 설정이 없으면 available: false 로 두고 전부 게스트로 돈다.
// 로그인 화면은 그대로 열리되 "아직 준비되지 않았다"고 알린다. 누르면
// 아무 일도 없는 버튼보다는 이유를 말해 주는 편이 낫다.
// ---------------------------------------------------------------------------

/** 로그인·가입 실패 사유. 문구는 화면에서 붙인다. */
export type AuthProblem =
  | "unavailable"
  | "invalid_credentials"
  | "email_taken"
  | "weak_password"
  | "invalid_email"
  | "email_not_confirmed"
  | "rate_limited"
  | "unknown";

export interface AuthResult {
  ok: boolean;
  problem?: AuthProblem;
  /** 가입은 됐지만 메일 확인이 남은 경우. */
  needsEmailConfirmation?: boolean;
}

interface Auth {
  user: User | null;
  /** 첫 세션 조회가 끝났는지. 끝나기 전에는 로그인 여부를 단정하지 않는다. */
  loaded: boolean;
  /** Supabase가 설정되어 있는지. false면 회원 기능이 통째로 없다. */
  available: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

const Context = createContext<Auth | null>(null);

/**
 * Supabase가 돌려주는 오류를 우리 사유로 옮긴다.
 *
 * 원문을 그대로 화면에 띄우지 않는다. 영어 고정이라 한국어 화면에서 튀고,
 * 문구가 예고 없이 바뀐다.
 */
function classify(message: string, status: number | undefined): AuthProblem {
  const text = message.toLowerCase();

  if (text.includes("invalid login credentials")) {
    return "invalid_credentials";
  }
  if (text.includes("already registered") || text.includes("already been registered")) {
    return "email_taken";
  }
  if (text.includes("password")) {
    return "weak_password";
  }
  if (text.includes("email") && text.includes("invalid")) {
    return "invalid_email";
  }
  if (text.includes("not confirmed")) {
    return "email_not_confirmed";
  }
  if (status === 429) {
    return "rate_limited";
  }
  return "unknown";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = getBrowserClient();
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (client === null) {
      setLoaded(true);
      return;
    }

    let alive = true;

    // getSession은 쿠키만 읽어서 즉시 답한다. getUser는 서버에 물어보느라
    // 첫 화면이 늦어진다. 여기서 필요한 건 "누구로 그릴까"뿐이고, 실제
    // 권한 판정은 서버와 RLS가 하므로 이걸로 충분하다.
    void client.auth.getSession().then(({ data }) => {
      if (alive) {
        setUser(data.session?.user ?? null);
        setLoaded(true);
      }
    });

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (alive) {
        setUser(session?.user ?? null);
      }
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (client === null) {
        return { ok: false, problem: "unavailable" };
      }

      const { error } = await client.auth.signInWithPassword({
        email,
        password,
      });

      if (error !== null) {
        return { ok: false, problem: classify(error.message, error.status) };
      }
      return { ok: true };
    },
    [client],
  );

  const signUp = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (client === null) {
        return { ok: false, problem: "unavailable" };
      }

      const { data, error } = await client.auth.signUp({ email, password });

      if (error !== null) {
        return { ok: false, problem: classify(error.message, error.status) };
      }

      // 메일 확인이 켜져 있으면 세션 없이 사용자만 돌아온다.
      // 이때 로그인된 것처럼 화면을 바꾸면 새로고침에 풀려서 더 혼란스럽다.
      const confirmed = data.session !== null;
      return { ok: true, needsEmailConfirmation: !confirmed };
    },
    [client],
  );

  const signOut = useCallback(async () => {
    if (client !== null) {
      await client.auth.signOut();
    }
  }, [client]);

  const value = useMemo(
    () => ({
      user,
      loaded,
      available: client !== null,
      signIn,
      signUp,
      signOut,
    }),
    [user, loaded, client, signIn, signUp, signOut],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAuth(): Auth {
  const found = useContext(Context);
  if (found === null) {
    throw new Error("AuthProvider 안에서만 쓸 수 있습니다");
  }
  return found;
}
