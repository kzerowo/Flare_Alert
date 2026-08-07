"use client";

import { useState } from "react";

import { useAuth } from "@/lib/auth";
import type { AuthProblem } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";

interface Props {
  onClose: () => void;
}

/**
 * 마이페이지. 이메일 변경과 계정 삭제만 있다.
 *
 * 비밀번호 변경은 넣지 않았다 — 이미 "비밀번호를 잊으셨나요?" 링크가
 * 같은 일(재설정 메일 보내기)을 한다. 구글로 가입한 사용자는 애초에
 * 비밀번호가 없다.
 *
 * 계정 삭제는 supabase/migrations/0005_delete_own_account.sql의 RPC를
 * 부른다. 서비스 키가 브라우저에 없어서 auth.users를 직접 못 지우므로
 * 이 방법뿐이다.
 */
export function MyPageDialog({ onClose }: Props) {
  const t = useT();
  const { user, updateEmail, deleteAccount, signOut } = useAuth();

  const [email, setEmail] = useState(user?.email ?? "");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailProblem, setEmailProblem] = useState<AuthProblem | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteProblem, setDeleteProblem] = useState<AuthProblem | null>(
    null,
  );

  if (user === null) {
    return null;
  }

  const emailChanged = email.trim() !== "" && email.trim() !== user.email;

  async function submitEmail(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (emailBusy || !emailChanged) {
      return;
    }

    setEmailBusy(true);
    setEmailProblem(null);
    const result = await updateEmail(email.trim());
    setEmailBusy(false);

    if (!result.ok) {
      setEmailProblem(result.problem ?? "unknown");
      return;
    }
    setEmailSent(true);
  }

  async function confirmDelete(): Promise<void> {
    setDeleteBusy(true);
    setDeleteProblem(null);
    const result = await deleteAccount();
    setDeleteBusy(false);

    if (!result.ok) {
      setConfirmingDelete(false);
      setDeleteProblem(result.problem ?? "unknown");
      return;
    }
    onClose();
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
              <Icon name="user" size={24} />
            </span>
            <h2 className="text-display">{t.myPage.title}</h2>
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

        {/* 이메일 */}
        <section className="mt-12 space-y-1">
          <label
            htmlFor="mypage-email"
            className="label block px-1 text-on-surface-variant"
          >
            {t.auth.email}
          </label>
          <form className="flex gap-2" onSubmit={submitEmail}>
            <div className="group relative flex-grow">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors group-focus-within:text-primary">
                <Icon name="mail" size={18} />
              </span>
              <input
                id="mypage-email"
                type="email"
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailSent(false);
                }}
                disabled={emailBusy}
                className="h-12 w-full rounded-lg border border-outline-variant bg-sunken pl-12 pr-4 text-body-sm placeholder:text-outline-variant focus:border-primary focus:outline-none disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={!emailChanged || emailBusy}
              className="label shrink-0 rounded-lg bg-primary-container px-4 font-bold text-on-primary-container transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {emailBusy ? t.auth.working : t.myPage.saveEmail}
            </button>
          </form>

          {emailSent ? (
            <p className="mt-2 text-body-sm text-primary">
              {t.myPage.emailChangeSent}
            </p>
          ) : null}
          {emailProblem === null ? null : (
            <p className="mt-2 text-body-sm text-danger">
              {t.auth.problem[emailProblem]}
            </p>
          )}
        </section>

        {/* 위험 구역 */}
        <section className="mt-10 rounded-lg border border-danger/30 p-4">
          <h3 className="label text-danger">{t.myPage.dangerZone}</h3>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            {t.myPage.deleteAccountBody}
          </p>
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="label mt-4 rounded-lg border border-danger px-4 py-2 text-danger transition-colors hover:bg-danger/10"
          >
            {t.myPage.deleteAccount}
          </button>
          {deleteProblem === null ? null : (
            <p className="mt-2 text-body-sm text-danger">
              {t.auth.problem[deleteProblem]}
            </p>
          )}
        </section>

        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-6 w-full text-center text-body-sm text-on-surface-variant transition-colors hover:text-primary"
        >
          {t.nav.logout}
        </button>
      </div>

      {confirmingDelete ? (
        <ConfirmDialog
          title={t.myPage.deleteConfirmTitle}
          body={t.myPage.deleteConfirmBody}
          confirmLabel={deleteBusy ? t.auth.working : t.myPage.deleteAccount}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setConfirmingDelete(false)}
        />
      ) : null}
    </div>
  );
}
