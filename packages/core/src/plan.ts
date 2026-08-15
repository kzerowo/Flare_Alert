/*
 * 요금제.
 *
 * 화면과 DB가 같은 답을 내야 하는 규칙이 세 개 있다 — 관리자는 항상 pro다,
 * 만료된 pro는 free다, free는 채널 3개다. 이 파일이 그 규칙의 원본이고
 * supabase/migrations/0006_plans_and_admin.sql 의 effective_plan() /
 * channel_limit_for() 가 같은 규칙을 SQL로 옮긴 것이다.
 *
 * 둘 중 하나만 고치면 사용자는 저장을 눌렀다가 조용히 되돌아가는 화면을
 * 본다 — 버튼은 살아 있는데 DB가 거절하기 때문이다.
 */

export type Plan = "free" | "pro";
export type UserRole = "user" | "admin";

export const PLANS: readonly Plan[] = ["free", "pro"];

/**
 * 무료 요금제의 채널 수 상한.
 *
 * 0006 마이그레이션의 channel_limit_for()에 같은 숫자가 박혀 있다.
 */
export const FREE_CHANNEL_LIMIT = 3;

/**
 * 계정의 요금제 상태.
 *
 * plan과 role을 나눠 둔 이유는 0006 주석 참고 — 관리자는 돈을 낸 사람이
 * 아니라 운영하는 사람이라, 한 컬럼에 합치면 매출 집계가 부풀려진다.
 */
export interface Membership {
  plan: Plan;
  role: UserRole;
  /** epoch ms. null이면 만료 없음(수동 부여 또는 미결제 상태). */
  planExpiresAt: number | null;
}

/**
 * 로그인하지 않았거나 프로필을 아직 못 읽었을 때.
 *
 * 무료로 가정한다. 반대로 두면 프로필을 읽는 짧은 사이에 무제한으로 보이고,
 * 그때 만든 채널이 저장 단계에서 거절당한다.
 */
export const DEFAULT_MEMBERSHIP: Membership = {
  plan: "free",
  role: "user",
  planExpiresAt: null,
};

export function isPlan(value: unknown): value is Plan {
  return value === "free" || value === "pro";
}

export function isUserRole(value: unknown): value is UserRole {
  return value === "user" || value === "admin";
}

/** 저장된 값이 무엇이든 쓸 수 있는 Membership으로 만든다. */
export function toMembership(raw: {
  plan?: unknown;
  role?: unknown;
  planExpiresAt?: unknown;
}): Membership {
  const expires =
    typeof raw.planExpiresAt === "number" && Number.isFinite(raw.planExpiresAt)
      ? raw.planExpiresAt
      : null;

  return {
    plan: isPlan(raw.plan) ? raw.plan : "free",
    role: isUserRole(raw.role) ? raw.role : "user",
    planExpiresAt: expires,
  };
}

/**
 * 실제로 적용되는 요금제.
 *
 * 저장된 plan을 그대로 믿지 않는다. 관리자는 결제 여부와 무관하게 pro고,
 * 만료 시각이 지난 pro는 free다.
 */
export function effectivePlan(
  membership: Membership,
  nowMs: number = Date.now(),
): Plan {
  if (membership.role === "admin") {
    return "pro";
  }
  if (membership.plan !== "pro") {
    return "free";
  }
  if (membership.planExpiresAt !== null && membership.planExpiresAt <= nowMs) {
    return "free";
  }
  return "pro";
}

/**
 * 만들 수 있는 채널 수. null이면 무제한.
 *
 * null을 큰 숫자(Infinity 등)로 바꾸지 않는다. "무제한"과 "아주 큰 한도"는
 * 화면에서 다르게 보여야 하는데, 숫자로 만들면 그 구분이 사라진다.
 */
export function channelLimit(
  membership: Membership,
  nowMs: number = Date.now(),
): number | null {
  return effectivePlan(membership, nowMs) === "pro" ? null : FREE_CHANNEL_LIMIT;
}

/** 지금 채널을 하나 더 만들 수 있는지. */
export function canCreateChannel(
  membership: Membership,
  currentCount: number,
  nowMs: number = Date.now(),
): boolean {
  const limit = channelLimit(membership, nowMs);
  return limit === null || currentCount < limit;
}
