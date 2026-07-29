"use client";

import { useState } from "react";

import { useAuth } from "@/lib/auth";
import type { AuthProblem } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { Icon } from "./Icon";

/**
 * 새 비밀번호 입력.
 *
 * 메일의 재설정 링크를 타고 들어오면 Supabase가 임시 세션을 만들어 준다.
 * 그 상태에서 이 창이 뜬다.
 *
 * 배경을 눌러서 닫을 수 없게 했다. 다른 창들과 다른 점인데, 여기서
 * 실수로 닫으면 링크가 이미 소비된 뒤라 메일을 다시 받아야 한다.
 * 그만두려면 명시적으로 눌러야 한다.
 */
export function ResetPasswordDialog() {
  const t = useT();
  const { updatePassword, endRecovery } = useAuth();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AuthProblem | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) {
      return;
    }

    // 새 비밀번호는 확인이 필요하다. 로그인과 달리 틀려도 즉시 알 수 없고,
    // 다음 로그인에서야 "왜 안 되지"가 된다.
    if (password !== confirm) {
      setMismatch(true);
      return;
    }

    setBusy(true);
    setProblem(null);
    setMismatch(false);

    const result = await updatePassword(password);
    setBusy(false);

    if (!result.ok) {
      setProblem(result.problem ?? "unknown");
      return;
    }

    setDone(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-title"
        className="panel w-full max-w-md rounded-xl p-12 shadow-2xl"
      >
        <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary-container text-on-primary-container">
          <Icon name="lock" size={24} />
        </span>

        <h2 id="reset-title" className="text-display">
          {t.auth.resetTitle}
        </h2>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          {t.auth.resetSubtitle}
        </p>

        {done ? (
          <>
            <p className="mt-12 rounded-lg border border-primary/30 bg-primary/5 p-4 text-body-sm leading-relaxed text-on-surface">
              {t.auth.resetDone}
            </p>
            <button
              type="button"
              onClick={endRecovery}
              className="label mt-6 flex h-12 w-full items-center justify-center rounded-lg bg-primary-container font-bold text-on-primary-container transition-all hover:opacity-90"
            >
              {t.auth.resetContinue}
            </button>
          </>
        ) : (
          <form className="mt-12 space-y-6" onSubmit={submit}>
            <PasswordField
              id="reset-password"
              label={t.auth.newPassword}
              value={password}
              onChange={setPassword}
              disabled={busy}
            />
            <PasswordField
              id="reset-confirm"
              label={t.auth.confirmPassword}
              value={confirm}
              onChange={setConfirm}
              disabled={busy}
            />

            {mismatch ? (
              <p className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-body-sm text-danger">
                {t.auth.passwordMismatch}
              </p>
            ) : null}

            {problem === null ? null : (
              <p className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-body-sm text-danger">
                {t.auth.problem[problem]}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="label flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary-container font-bold text-on-primary-container transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:bg-primary-container/40"
            >
              {busy ? t.auth.working : t.auth.submitNewPassword}
            </button>

            <button
              type="button"
              onClick={endRecovery}
              className="w-full text-center text-body-sm text-on-surface-variant transition-colors hover:text-primary"
            >
              {t.auth.resetCancel}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="label block px-1 text-on-surface-variant">
        {label}
      </label>
      <div className="group relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors group-focus-within:text-primary">
          <Icon name="lock" size={18} />
        </span>
        <input
          id={id}
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder="••••••••"
          className="h-12 w-full rounded-lg border border-outline-variant bg-sunken pl-12 pr-4 text-body-sm placeholder:text-outline-variant focus:border-primary focus:outline-none disabled:opacity-50"
        />
      </div>
    </div>
  );
}
