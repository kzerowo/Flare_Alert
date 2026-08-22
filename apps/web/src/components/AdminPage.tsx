"use client";

import { useCallback, useEffect, useState } from "react";

import { effectivePlan } from "@flare-alert/core";
import type { Plan } from "@flare-alert/core";

import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { getBrowserClient } from "@/lib/supabase/client";
import { listUsers, loadStats, setPlan } from "@/lib/supabase/admin";
import type { AdminStats, AdminUser } from "@/lib/supabase/admin";
import { Icon } from "./Icon";
import { LanguageToggle } from "./LanguageToggle";
import { PlanBadge } from "./PlanBadge";

/*
 * 관리자 화면.
 *
 * 여기서 페이지를 감추는 것은 편의일 뿐 방어가 아니다. 실제 방어는
 * admin_list_users/admin_set_plan/admin_stats 안의 is_admin() 검사다(0006).
 * 주소를 직접 쳐서 들어와도 RPC가 예외만 돌려준다.
 *
 * 권한(role) 변경 버튼은 두지 않는다. 관리자를 늘리는 일은 되돌리기
 * 어렵고(자기 자신을 강등시켜 아무도 관리자가 아닌 상태를 만들 수 있다)
 * 실제 빈도는 몇 달에 한 번이다. SQL Editor에서 직접 고친다.
 */

/** 날짜는 자릿수가 흔들리지 않게 고정 형식으로 쓴다. AlertHistory와 같은 이유. */
function formatDate(ms: number): string {
  if (!Number.isFinite(ms)) {
    return "—";
  }
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function AdminPage() {
  const t = useT();
  const { user, loaded: authLoaded } = useAuth();
  const { isAdmin, loaded: profileLoaded } = useProfile();
  const client = getBrowserClient();

  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  /** 요금제를 바꾸는 중인 사용자 id. 그 행의 버튼만 잠근다. */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [changeFailed, setChangeFailed] = useState(false);

  const ready = authLoaded && profileLoaded && isAdmin && client !== null;

  const reload = useCallback(
    async (term: string) => {
      if (client === null) {
        return;
      }

      setLoading(true);
      setFailed(false);
      try {
        // 통계는 검색어와 무관하지만 같이 읽는다. 두 번 왕복해도 관리자
        // 한 명이 가끔 보는 화면이라 아낄 이유가 없고, 요금제를 바꾼 뒤
        // 목록과 통계가 어긋나 보이는 편이 더 나쁘다.
        const [nextUsers, nextStats] = await Promise.all([
          listUsers(client, term),
          loadStats(client),
        ]);
        setUsers(nextUsers);
        setStats(nextStats);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  // 검색어를 입력할 때마다 질의하지 않는다. 타자 한 번에 한 번씩 나가면
  // 이메일 하나 치는 데 스무 번이 나간다.
  useEffect(() => {
    if (!ready) {
      return;
    }

    const timer = setTimeout(() => void reload(search), 300);
    return () => clearTimeout(timer);
  }, [ready, search, reload]);

  async function change(target: AdminUser, next: Plan): Promise<void> {
    if (client === null) {
      return;
    }

    setBusyId(target.id);
    setChangeFailed(false);
    try {
      await setPlan(client, target.id, next);
      await reload(search);
    } catch {
      setChangeFailed(true);
    } finally {
      setBusyId(null);
    }
  }

  if (!authLoaded || !profileLoaded) {
    return null;
  }

  if (user === null || !isAdmin) {
    return <Forbidden t={t} />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-4 md:px-6">
          <div className="flex min-w-0 items-baseline gap-2">
            <a
              href="/app"
              className="shrink-0 text-title font-bold text-primary transition-opacity hover:opacity-80 sm:text-headline"
            >
              {t.brand}
            </a>
            <span className="label shrink-0 rounded-md bg-warm/15 px-2 py-1 text-warm">
              {t.admin.title}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <LanguageToggle />
            <a
              href="/app"
              className="label shrink-0 whitespace-nowrap px-2 py-2 text-on-surface-variant transition-colors hover:text-primary sm:px-4"
            >
              {t.nav.home}
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-grow space-y-6 px-4 py-6 md:px-6">
        <div>
          <h1 className="text-headline sm:text-display">{t.admin.title}</h1>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            {t.admin.subtitle}
          </p>
        </div>

        <StatGrid t={t} stats={stats} />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="group relative w-full sm:max-w-sm">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors group-focus-within:text-primary">
              <Icon name="search" size={18} />
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t.admin.searchPlaceholder}
              className="h-12 w-full rounded-lg border border-outline-variant bg-sunken pl-12 pr-4 text-body-sm placeholder:text-outline-variant focus:border-primary focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-3">
            <span className="text-body-sm text-on-surface-variant">
              {loading ? t.admin.loading : t.admin.resultCount(users.length)}
            </span>
            <button
              type="button"
              onClick={() => void reload(search)}
              disabled={loading}
              className="label shrink-0 rounded-lg border border-white/10 px-4 py-2 text-on-surface-variant transition-colors hover:text-primary disabled:opacity-50"
            >
              {t.admin.refresh}
            </button>
          </div>
        </div>

        {changeFailed ? (
          <p className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-body-sm text-danger">
            {t.admin.changeFailed}
          </p>
        ) : null}

        <p className="text-body-sm text-on-surface-variant">
          {t.admin.downgradeNote}
        </p>

        {failed ? (
          <p className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-body-sm text-danger">
            {t.admin.loadFailed}
          </p>
        ) : users.length === 0 && !loading ? (
          <p className="card rounded-xl border-dashed p-8 text-center text-body-sm text-on-surface-variant">
            {t.admin.empty}
          </p>
        ) : (
          <UserTable
            t={t}
            users={users}
            busyId={busyId}
            onChange={(target, next) => void change(target, next)}
          />
        )}
      </main>
    </div>
  );
}

function Forbidden({ t }: { t: Dictionary }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-high text-on-surface-variant">
        <Icon name="lock" size={28} />
      </span>
      <h1 className="text-headline">{t.admin.forbiddenTitle}</h1>
      <p className="text-body-sm text-on-surface-variant">
        {t.admin.forbiddenBody}
      </p>
      <a
        href="/app"
        className="label rounded-lg border border-primary/30 bg-primary/10 px-6 py-3 font-bold text-primary transition-all hover:bg-primary/20"
      >
        {t.admin.backHome}
      </a>
    </div>
  );
}

function StatGrid({ t, stats }: { t: Dictionary; stats: AdminStats | null }) {
  const cells: { label: string; value: number | null }[] = [
    { label: t.admin.statTotalUsers, value: stats?.totalUsers ?? null },
    { label: t.admin.statProUsers, value: stats?.proUsers ?? null },
    { label: t.admin.statChannels, value: stats?.totalChannels ?? null },
    {
      label: t.admin.statEnabledChannels,
      value: stats?.enabledChannels ?? null,
    },
    {
      label: t.admin.statSubscriptions,
      value: stats?.pushSubscriptions ?? null,
    },
    { label: t.admin.statAlerts24h, value: stats?.alerts24h ?? null },
  ];

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((cell) => (
        <li
          key={cell.label}
          className="rounded-xl border border-white/5 bg-surface-low p-4"
        >
          <p className="label text-on-surface-variant">{cell.label}</p>
          <p className="mt-1 font-mono text-title">
            {cell.value === null ? "—" : cell.value.toLocaleString()}
          </p>
        </li>
      ))}
    </ul>
  );
}

function UserTable({
  t,
  users,
  busyId,
  onChange,
}: {
  t: Dictionary;
  users: AdminUser[];
  busyId: string | null;
  onChange: (user: AdminUser, next: Plan) => void;
}) {
  return (
    // 좁은 화면에서 표가 페이지 전체를 밀어내지 않게 자기 안에서 스크롤한다.
    <div className="overflow-x-auto rounded-xl border border-white/5 bg-surface-low">
      <table className="w-full min-w-[44rem] text-body-sm">
        <thead>
          <tr className="border-b border-white/5 text-left text-on-surface-variant">
            <th className="label px-4 py-3 font-normal">{t.admin.colUser}</th>
            <th className="label px-4 py-3 font-normal">{t.admin.colPlan}</th>
            <th className="label px-4 py-3 text-right font-normal">
              {t.admin.colChannels}
            </th>
            <th className="label px-4 py-3 text-right font-normal">
              {t.admin.colAlerts}
            </th>
            <th className="label px-4 py-3 font-normal">{t.admin.colJoined}</th>
            <th className="label px-4 py-3 text-right font-normal">
              {t.admin.colAction}
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((row) => {
            const plan = effectivePlan(row.membership);
            const admin = row.membership.role === "admin";
            const busy = busyId === row.id;

            return (
              <tr
                key={row.id}
                className="border-b border-white/5 last:border-b-0"
              >
                <td className="max-w-[18rem] truncate px-4 py-3">
                  {row.email}
                </td>

                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <PlanBadge plan={plan} admin={admin} />
                    {row.membership.planExpiresAt === null ? null : (
                      <span className="text-body-sm text-on-surface-variant">
                        {t.plan.expiresAt(
                          formatDate(row.membership.planExpiresAt),
                        )}
                      </span>
                    )}
                  </div>
                </td>

                <td className="px-4 py-3 text-right font-mono">
                  {row.channelCount}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {row.alertCount}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-on-surface-variant">
                  {formatDate(row.createdAtMs)}
                </td>

                <td className="px-4 py-3 text-right">
                  {admin ? (
                    // 관리자는 요금제와 무관하게 pro다. 버튼을 눌러도
                    // 아무것도 달라지지 않으므로 아예 두지 않는다.
                    <span className="text-body-sm text-on-surface-variant">
                      {t.admin.adminRowNote}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        onChange(row, plan === "pro" ? "free" : "pro")
                      }
                      className="label shrink-0 whitespace-nowrap rounded-lg border border-white/10 px-4 py-2 transition-colors hover:text-primary disabled:opacity-50"
                    >
                      {busy
                        ? t.admin.working
                        : plan === "pro"
                          ? t.admin.toFree
                          : t.admin.toPro}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

