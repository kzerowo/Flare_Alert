"use client";

import type { Plan } from "@flare-alert/core";

import { useT } from "@/lib/i18n";

/*
 * 요금제 배지.
 *
 * 관리자는 요금제와 별개의 축이라 따로 그린다(0006 주석 참고). 관리자에게
 * "Pro"라고만 쓰면 화면상 유료 결제자와 구분이 안 되어, 관리자 화면에서
 * 실제 매출 규모를 잘못 읽게 된다.
 */
export function PlanBadge({ plan, admin }: { plan: Plan; admin?: boolean }) {
  const t = useT();

  if (admin === true) {
    return (
      <span className="label shrink-0 rounded-md bg-warm/15 px-2 py-1 text-warm">
        {t.plan.admin}
      </span>
    );
  }

  if (plan === "pro") {
    return (
      <span className="label shrink-0 rounded-md bg-primary-container px-2 py-1 font-bold text-on-primary-container">
        {t.plan.pro}
      </span>
    );
  }

  return (
    <span className="label shrink-0 rounded-md bg-surface-high px-2 py-1 text-on-surface-variant">
      {t.plan.free}
    </span>
  );
}
