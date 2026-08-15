"use client";

import { useT } from "@/lib/i18n";
import { Icon } from "./Icon";

interface Props {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 되돌릴 수 없는 동작(채널 삭제 등) 전에 한 번 더 묻는다.
 *
 * AuthDialog와 같은 오버레이 구조를 쓴다. 배경을 눌러 닫는 동작도 취소로
 * 다룬다 — 확인 창에서는 "의도치 않게 닫힘"과 "취소"가 같은 결과여야
 * 안전하다.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: Props) {
  const t = useT();

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="panel my-auto w-full max-w-sm rounded-xl p-6 shadow-2xl sm:p-8"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-danger/15 text-danger">
          <Icon name="trash" size={22} />
        </span>

        <h2 id="confirm-dialog-title" className="text-title font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-body-sm text-on-surface-variant">{body}</p>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="label rounded-lg px-4 py-3 text-on-surface-variant transition-colors hover:text-on-surface"
          >
            {t.form.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="label rounded-lg border border-danger px-4 py-3 text-danger transition-colors hover:bg-danger/10"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
