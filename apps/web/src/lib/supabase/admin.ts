import { toMembership } from "@flare-alert/core";
import type { Membership, Plan } from "@flare-alert/core";

import type { Client } from "./client";
import type { AdminStatsRow, AdminUserRow } from "./types";

/*
 * 관리자 조회/변경.
 *
 * 전부 RPC다. 이메일은 auth.users에만 있고 그 테이블에는 RLS 정책을 걸 수
 * 없어서, 조회는 어차피 SECURITY DEFINER 함수여야 한다. 이왕 함수를 둘
 * 거라면 요금제 변경도 같은 문을 쓰는 편이 낫다 — 관리자에게 profiles를
 * 통째로 여는 정책을 만들면 "관리자면 무엇이든"이 되어 되돌리기 어렵다.
 *
 * 세 함수 모두 안에서 is_admin()으로 막혀 있다(0006). 화면에서 링크를
 * 감추는 것은 편의일 뿐 방어가 아니다.
 */

/** 화면에 뿌릴 한 명. 행의 문자열 컬럼을 도메인 타입으로 좁혀 둔다. */
export interface AdminUser {
  id: string;
  email: string;
  membership: Membership;
  createdAtMs: number;
  channelCount: number;
  alertCount: number;
}

export interface AdminStats {
  totalUsers: number;
  proUsers: number;
  totalChannels: number;
  enabledChannels: number;
  pushSubscriptions: number;
  alerts24h: number;
}

function toAdminUser(row: AdminUserRow): AdminUser {
  const expires =
    row.plan_expires_at === null ? null : Date.parse(row.plan_expires_at);

  return {
    id: row.id,
    email: row.email,
    membership: toMembership({
      plan: row.plan,
      role: row.role,
      planExpiresAt: expires !== null && Number.isNaN(expires) ? null : expires,
    }),
    createdAtMs: Date.parse(row.created_at),
    channelCount: Number(row.channel_count),
    alertCount: Number(row.alert_count),
  };
}

/**
 * 사용자 목록.
 *
 * search가 비면 전체를 가입 역순으로 준다. DB가 500행에서 자르므로
 * 사용자가 그보다 많아지면 검색이 유일한 접근 경로가 된다.
 */
export async function listUsers(
  client: Client,
  search: string,
): Promise<AdminUser[]> {
  const trimmed = search.trim();

  const { data, error } = await client.rpc("admin_list_users", {
    search: trimmed === "" ? null : trimmed,
    max_rows: 200,
  });

  if (error !== null) {
    throw new Error(error.message);
  }

  return (data ?? []).map(toAdminUser);
}

export async function loadStats(client: Client): Promise<AdminStats | null> {
  const { data, error } = await client.rpc("admin_stats");

  if (error !== null) {
    throw new Error(error.message);
  }

  // returns table이라 한 행짜리 배열로 온다.
  const row: AdminStatsRow | undefined = (data ?? [])[0];
  if (row === undefined) {
    return null;
  }

  return {
    totalUsers: Number(row.total_users),
    proUsers: Number(row.pro_users),
    totalChannels: Number(row.total_channels),
    enabledChannels: Number(row.enabled_channels),
    pushSubscriptions: Number(row.push_subscriptions),
    alerts24h: Number(row.alerts_24h),
  };
}

/**
 * 요금제를 바꾼다.
 *
 * expiresAtMs가 null이면 만료 없는 pro다. free로 내릴 때는 DB가 만료 시각을
 * 지우고, 한도를 넘은 채널을 오래된 것부터 남기고 꺼 준다(0006 참고).
 */
export async function setPlan(
  client: Client,
  userId: string,
  plan: Plan,
  expiresAtMs: number | null = null,
): Promise<void> {
  const { error } = await client.rpc("admin_set_plan", {
    target_id: userId,
    next_plan: plan,
    expires_at:
      plan === "pro" && expiresAtMs !== null
        ? new Date(expiresAtMs).toISOString()
        : null,
  });

  if (error !== null) {
    throw new Error(error.message);
  }
}
