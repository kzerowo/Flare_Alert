"use client";

import { useState } from "react";

import { useAuth } from "@/lib/auth";
import type { AuthProblem } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { Icon } from "./Icon";

type Mode = "login" | "signup" | "forgot";

interface Props {
  mode: Mode;
  onClose: () => void;
}

/**
 * 로그인 / 회원가입.
 *
 * Supabase Auth를 쓴다. 비밀번호는 이 컴포넌트를 지나 바로 Supabase로
 * 가고 우리 서버에는 남지 않는다.
 *
 * 시안에 있던 구글 로그인과 API 키 버튼은 뺐다. 연결한 공급자가 없어서
 * 누르면 아무 일도 일어나지 않는 버튼이 두 개 더 생길 뿐이다.
 * "AES-256 암호화" 같은 문구도 뺐다. 사실이 아니다.
 */
export function AuthDialog({ mode, onClose }: Props) {
  const t = useT();
  const { signIn, signUp, sendPasswordReset, available } = useAuth();

  const [current, setCurrent] = useState<Mode>(mode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AuthProblem | null>(null);
  const [sentConfirmation, setSentConfirmation] = useState(false);
  const [sentReset, setSentReset] = useState(false);

  const isLogin = current === "login";
  const isForgot = current === "forgot";

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    if (busy) {
      return;
    }

    setBusy(true);
    setProblem(null);

    const result = isForgot
      ? await sendPasswordReset(email)
      : isLogin
        ? await signIn(email, password)
        : await signUp(email, password);

    setBusy(false);

    if (!result.ok) {
      setProblem(result.problem ?? "unknown");
      return;
    }

    if (isForgot) {
      setSentReset(true);
      return;
    }

    // 메일 확인이 남았으면 아직 로그인된 것이 아니다. 창을 닫으면
    // 로그인된 줄 알고 기다리게 된다.
    if (result.needsEmailConfirmation === true) {
      setSentConfirmation(true);
      return;
    }

    onClose();
  }

  function goTo(next: Mode): void {
    setCurrent(next);
    setProblem(null);
    setSentConfirmation(false);
    setSentReset(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-md rounded-xl p-12 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex flex-col items-start">
            <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary-container text-on-primary-container">
              <Icon name="bell" size={24} />
            </span>
            <h2 className="text-display">
              {isForgot
                ? t.auth.forgotTitle
                : isLogin
                  ? t.auth.login
                  : t.auth.signup}
            </h2>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              {isForgot ? t.auth.forgotSubtitle : t.auth.subtitle}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-on-surface-variant transition-colors hover:text-primary"
            aria-label={t.auth.close}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {sentConfirmation || sentReset ? (
          <p className="mt-12 rounded-lg border border-primary/30 bg-primary/5 p-4 text-body-sm leading-relaxed text-on-surface">
            {sentReset ? t.auth.resetSent : t.auth.checkEmail}
          </p>
        ) : (
          <form className="mt-12 space-y-6" onSubmit={submit}>
            <div className="space-y-1">
              <label htmlFor="auth-email" className="label block px-1 text-on-surface-variant">
                {t.auth.email}
              </label>
              <div className="group relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors group-focus-within:text-primary">
                  <Icon name="mail" size={18} />
                </span>
                <input
                  id="auth-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={!available || busy}
                  placeholder="name@example.com"
                  className="h-12 w-full rounded-lg border border-outline-variant bg-sunken pl-12 pr-4 text-body-sm placeholder:text-outline-variant focus:border-primary focus:outline-none disabled:opacity-50"
                />
              </div>
            </div>

            {isForgot ? null : (
            <div className="space-y-1">
              <label htmlFor="auth-password" className="label block px-1 text-on-surface-variant">
                {t.auth.password}
              </label>
              <div className="group relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors group-focus-within:text-primary">
                  <Icon name="lock" size={18} />
                </span>
                <input
                  id="auth-password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={!available || busy}
                  placeholder="••••••••"
                  className="h-12 w-full rounded-lg border border-outline-variant bg-sunken pl-12 pr-4 text-body-sm placeholder:text-outline-variant focus:border-primary focus:outline-none disabled:opacity-50"
                />
              </div>
            </div>
            )}

            {isForgot || !isLogin ? null : (
              <button
                type="button"
                onClick={() => goTo("forgot")}
                className="w-full text-right text-body-sm text-on-surface-variant transition-colors hover:text-primary"
              >
                {t.auth.forgotLink}
              </button>
            )}

            {problem === null ? null : (
              <p className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-body-sm text-danger">
                {t.auth.problem[problem]}
              </p>
            )}

            <button
              type="submit"
              disabled={!available || busy}
              className="label flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary-container font-bold text-on-primary-container transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:bg-primary-container/40"
            >
              {busy
                ? t.auth.working
                : isForgot
                  ? t.auth.submitReset
                  : isLogin
                    ? t.auth.submitLogin
                    : t.auth.submitSignup}
              {busy ? null : <Icon name="arrow-right" size={16} />}
            </button>
          </form>
        )}

        <p className="mt-6 rounded-lg border border-white/5 bg-white/[0.02] p-4 text-body-sm leading-relaxed text-on-surface-variant">
          {available ? t.auth.guestHint : t.auth.problem.unavailable}
        </p>

        <button
          type="button"
          onClick={() => goTo(isLogin ? "signup" : "login")}
          className="mt-6 w-full text-center text-body-sm text-on-surface-variant transition-colors hover:text-primary"
        >
          {isLogin ? (
            <>
              {t.auth.toSignupPrefix}{" "}
              <b className="text-primary">{t.auth.toSignupAction}</b>
            </>
          ) : (
            <>
              {t.auth.toLoginPrefix}{" "}
              <b className="text-primary">{t.auth.toLoginAction}</b>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
