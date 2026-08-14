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
  | "provider_not_enabled"
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
  /** 구글로 이동한다. 성공하면 이 페이지로 돌아오지 않는다 — 실패했을 때만 결과가 의미 있다. */
  signInWithGoogle: () => Promise<AuthResult>;
  signOut: () => Promise<void>;
  /** 재설정 링크를 메일로 보낸다. */
  sendPasswordReset: (email: string) => Promise<AuthResult>;
  /** 재설정 링크로 들어온 세션에서 새 비밀번호를 저장한다. */
  updatePassword: (password: string) => Promise<AuthResult>;
  /** 새 주소로 확인 메일을 보낸다. 실제 전환은 사용자가 그 메일을 눌러야 끝난다. */
  updateEmail: (email: string) => Promise<AuthResult>;
  /**
   * 본인 계정을 지운다. channels/alerts/push_subscriptions까지 DB에서
   * CASCADE로 같이 지워진다(0005_delete_own_account.sql).
   */
  deleteAccount: () => Promise<AuthResult>;
  /**
   * 재설정 링크를 타고 들어왔는지.
   *
   * Supabase가 링크의 토큰으로 임시 세션을 만들어 주므로 이때는 이미
   * "로그인된" 상태다. 그대로 두면 사용자는 비밀번호를 바꾸러 왔다가
   * 그냥 메인 화면을 보게 된다. 이 값이 true인 동안 새 비밀번호 화면을 띄운다.
   */
  recovering: boolean;
  /** 재설정을 마쳤거나 사용자가 그만둘 때. */
  endRecovery: () => void;
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
  if (text.includes("provider is not enabled") || text.includes("unsupported provider")) {
    return "provider_not_enabled";
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
  const [recovering, setRecovering] = useState(false);

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

    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (!alive) {
        return;
      }
      setUser(session?.user ?? null);

      // 재설정 링크를 타고 들어오면 Supabase가 임시 세션을 만들고 이 이벤트를
      // 던진다. 이걸 잡지 않으면 사용자는 비밀번호를 바꾸러 왔다가 그냥
      // 로그인된 메인 화면을 보게 된다.
      if (event === "PASSWORD_RECOVERY") {
        setRecovering(true);
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

      // 메일 확인이 켜져 있으면 이미 가입된 이메일이어도 에러를 던지지
      // 않는다(이메일 열거 공격 방지) — 대신 identities가 빈 배열인 채로
      // "성공"을 돌려준다. 이 신호를 안 잡으면 사용자는 실제로는 아무
      // 메일도 오지 않는데 "메일함을 확인하라"는 안내만 보고 기다리게 된다.
      if (data.user !== null && (data.user.identities?.length ?? 0) === 0) {
        return { ok: false, problem: "email_taken" };
      }

      // 메일 확인이 켜져 있으면 세션 없이 사용자만 돌아온다.
      // 이때 로그인된 것처럼 화면을 바꾸면 새로고침에 풀려서 더 혼란스럽다.
      const confirmed = data.session !== null;
      return { ok: true, needsEmailConfirmation: !confirmed };
    },
    [client],
  );

  const signInWithGoogle = useCallback(async (): Promise<AuthResult> => {
    if (client === null) {
      return { ok: false, problem: "unavailable" };
    }

    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        // sendPasswordReset과 같은 이유. 안 주면 Supabase의 Site URL로
        // 가는데, 로컬 개발 중에는 그게 배포 주소다.
        redirectTo: window.location.origin,
      },
    });

    if (error !== null) {
      return { ok: false, problem: classify(error.message, error.status) };
    }
    // 성공하면 브라우저가 구글로 떠난다. 여기로 리턴이 오는 건 이미 실패다.
    return { ok: true };
  }, [client]);

  const sendPasswordReset = useCallback(
    async (email: string): Promise<AuthResult> => {
      if (client === null) {
        return { ok: false, problem: "unavailable" };
      }

      const { error } = await client.auth.resetPasswordForEmail(email, {
        // 메일의 링크가 돌아올 곳. 지정하지 않으면 Supabase의 Site URL로
        // 가는데, 로컬에서 개발 중일 때 배포 주소로 튀어 버린다.
        redirectTo: window.location.origin,
      });

      if (error !== null) {
        return { ok: false, problem: classify(error.message, error.status) };
      }
      return { ok: true };
    },
    [client],
  );

  const updatePassword = useCallback(
    async (password: string): Promise<AuthResult> => {
      if (client === null) {
        return { ok: false, problem: "unavailable" };
      }

      const { error } = await client.auth.updateUser({ password });

      if (error !== null) {
        return { ok: false, problem: classify(error.message, error.status) };
      }

      setRecovering(false);
      return { ok: true };
    },
    [client],
  );

  const endRecovery = useCallback(() => {
    setRecovering(false);
  }, []);

  const updateEmail = useCallback(
    async (email: string): Promise<AuthResult> => {
      if (client === null) {
        return { ok: false, problem: "unavailable" };
      }

      const { error } = await client.auth.updateUser({ email });

      if (error !== null) {
        return { ok: false, problem: classify(error.message, error.status) };
      }
      return { ok: true };
    },
    [client],
  );

  const signOut = useCallback(async () => {
    setRecovering(false);
    if (client !== null) {
      await client.auth.signOut();
    }
  }, [client]);

  const deleteAccount = useCallback(async (): Promise<AuthResult> => {
    if (client === null) {
      return { ok: false, problem: "unavailable" };
    }

    const { error } = await client.rpc("delete_own_account");

    if (error !== null) {
      return { ok: false, problem: classify(error.message, undefined) };
    }

    // auth.users 행이 없어졌으니 남은 로컬 세션도 정리한다.
    setRecovering(false);
    await client.auth.signOut();
    return { ok: true };
  }, [client]);

  const value = useMemo(
    () => ({
      user,
      loaded,
      available: client !== null,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      sendPasswordReset,
      updatePassword,
      updateEmail,
      deleteAccount,
      recovering,
      endRecovery,
    }),
    [
      user,
      loaded,
      client,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      sendPasswordReset,
      updatePassword,
      updateEmail,
      deleteAccount,
      recovering,
      endRecovery,
    ],
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
