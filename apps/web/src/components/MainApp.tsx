"use client";

import { useEffect, useState } from "react";

import type { Channel } from "@flare-alert/core";

import { useAuth } from "@/lib/auth";
import { useChannels } from "@/lib/channel-store";
import { useT } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import {
  readPushState,
  registerServiceWorker,
  subscribeToPush,
} from "@/lib/push";
import type { PushState } from "@/lib/push";
import { useAlerts } from "@/lib/alerts";
import { AlertHistory } from "./AlertHistory";
import { AuthDialog } from "./AuthDialog";
import { ChannelCard } from "./ChannelCard";
import { ConfirmDialog } from "./ConfirmDialog";
import { MyPageDialog } from "./MyPageDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import { ChannelForm } from "./ChannelForm";
import { Icon } from "./Icon";
import { LanguageToggle } from "./LanguageToggle";
import { PlanBadge } from "./PlanBadge";

type View =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; channel: Channel };

type Tab = { kind: "channels" } | { kind: "alerts"; channelId?: string };

/**
 * 웹 푸시 구독 상태.
 *
 * 예전에는 Notification 권한만 물었고 실제로 띄우는 코드가 없었다. 이제
 * 서비스 워커에 구독까지 붙여야 detector가 보낸 알림이 도착한다.
 */
function usePush(signedIn: boolean) {
  const [state, setState] = useState<PushState>("default");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // 워커를 미리 등록해 둔다. 구독 시점에 등록하면 활성화를 기다리느라
      // 사용자가 버튼을 누른 뒤 눈에 띄게 멈춘다.
      await registerServiceWorker();
      const next = await readPushState();
      if (!cancelled) {
        setState(next);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  async function enable(): Promise<void> {
    setBusy(true);
    try {
      const result = await subscribeToPush();
      if (result.ok) {
        setState("subscribed");
      } else if (result.reason === "denied") {
        setState("denied");
      } else {
        setState(result.reason === "unsupported" ? "unsupported" : "unconfigured");
      }
    } finally {
      setBusy(false);
    }
  }

  return { state, busy, enable };
}

export function MainApp() {
  const t = useT();
  // loaded는 채널 저장소에도 있는 이름이라 여기서 갈라 둔다.
  const { user, loaded: authLoaded, signOut, recovering } = useAuth();
  const { plan, isAdmin } = useProfile();
  const {
    channels,
    loaded,
    limit,
    atLimit,
    problem,
    dismissProblem,
    add,
    update,
    remove,
  } = useChannels();
  const [view, setView] = useState<View>({ kind: "list" });
  const [auth, setAuth] = useState<"login" | "signup" | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Channel | null>(null);
  const [myPageOpen, setMyPageOpen] = useState(false);

  /*
   * 랜딩(/)에서 무엇을 누르고 넘어왔는지.
   *
   * 소개 페이지에는 인증 창도 채널 만들기 화면도 없다. 그것들을 띄우려면
   * AuthProvider와 채널 저장소를 소개 페이지까지 끌고 가야 하는데, 그러자고
   * 소개 화면이 로그인 상태를 알 이유는 없다. 대신 주소에 표시를 붙여
   * 보내고 여기서 열어 준다.
   *
   * ?auth=login|signup → 로그인/가입 창
   * ?new=1             → 채널 만들기 (민감도 테스트가 그 안에 있다)
   */
  const [pendingAuth, setPendingAuth] = useState<"login" | "signup" | null>(
    null,
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("auth");
    const wantsNew = params.get("new") === "1";

    if (requested !== "login" && requested !== "signup" && !wantsNew) {
      return;
    }

    if (requested === "login" || requested === "signup") {
      setPendingAuth(requested);
    }
    if (wantsNew) {
      setView({ kind: "create" });
    }

    // 표시는 한 번만 쓴다. 남겨 두면 새로고침할 때마다 같은 화면이 뜬다.
    params.delete("auth");
    params.delete("new");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query === "" ? "" : `?${query}`}`,
    );
  }, []);

  // 이미 로그인한 사람에게는 열지 않는다. 세션을 읽기 전에 판단하면
  // 로그인 상태인데도 로그인 창이 잠깐 떴다가 사라진다.
  useEffect(() => {
    if (pendingAuth === null || !authLoaded) {
      return;
    }
    if (user === null) {
      setAuth(pendingAuth);
    }
    setPendingAuth(null);
  }, [pendingAuth, authLoaded, user]);

  const signedIn = user !== null;
  const push = usePush(signedIn);
  const { unseen, markSeen } = useAlerts();
  // 알림 탭은 채널 하나로 좁혀 볼 수 있다. 채널 카드에서 들어온 경우다.
  const [tab, setTab] = useState<Tab>({ kind: "channels" });

  // 좁혀 보는 중이면 그 채널 이름. 지워진 채널을 가리키고 있으면 null이라
  // 자연히 전체 목록처럼 보인다.
  const filteredChannelId = tab.kind === "alerts" ? tab.channelId : undefined;
  const filteredChannelName =
    filteredChannelId === undefined
      ? null
      : (channels.find((channel) => channel.id === filteredChannelId)?.name ??
        null);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 py-4 md:px-6">
          <button
            type="button"
            onClick={() => setView({ kind: "list" })}
            className="shrink-0 text-title font-bold text-primary transition-opacity hover:opacity-80 sm:text-headline"
          >
            {t.brand}
          </button>

          <div className="flex min-w-0 items-center gap-1 sm:gap-2">
            <LanguageToggle />

            {signedIn ? (
              <>
                {/*
                  관리자 링크. 감추는 것은 편의일 뿐이고 실제 방어는 DB의
                  is_admin() 검사다 — 주소를 직접 쳐도 RPC가 거절한다.
                */}
                {isAdmin ? (
                  <a
                    href="/admin"
                    className="label shrink-0 whitespace-nowrap rounded-lg px-2 py-2 text-warm transition-opacity hover:opacity-80 sm:px-3"
                  >
                    {t.nav.admin}
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => setMyPageOpen(true)}
                  aria-label={t.myPage.title}
                  className="rounded-lg p-2 text-on-surface-variant transition-colors hover:text-primary sm:hidden"
                >
                  <Icon name="user" size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setMyPageOpen(true)}
                  className="hidden max-w-[16rem] items-center gap-2 px-2 text-body-sm text-on-surface-variant transition-colors hover:text-primary sm:flex"
                >
                  <span className="truncate">{user.email}</span>
                  {/* 관리자는 이미 왼쪽에 관리자 링크가 있어 배지가 겹친다. */}
                  {isAdmin ? null : <PlanBadge plan={plan} />}
                </button>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="label shrink-0 whitespace-nowrap px-2 py-2 text-on-surface-variant transition-colors hover:text-primary sm:px-4"
                >
                  {t.nav.logout}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setAuth("login")}
                  className="label shrink-0 whitespace-nowrap px-2 py-2 text-on-surface-variant transition-colors hover:text-primary sm:px-4"
                >
                  {t.nav.login}
                </button>
                <button
                  type="button"
                  onClick={() => setAuth("signup")}
                  className="label shrink-0 whitespace-nowrap rounded-lg bg-primary-container px-3 py-2 font-bold text-on-primary-container transition-all hover:opacity-90 sm:px-6"
                >
                  {t.nav.signup}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-grow space-y-6 px-4 py-6 md:px-6">
        {problem === null ? null : (
          <div className="flex items-start justify-between gap-4 rounded-lg border border-danger/30 bg-danger/5 p-4">
            <p className="text-body-sm text-danger">
              {problem === "load"
                ? t.store.loadFailed
                : problem === "limit"
                  ? t.store.limitReached
                  : t.store.saveFailed}
            </p>
            <button
              type="button"
              onClick={dismissProblem}
              className="shrink-0 text-danger transition-opacity hover:opacity-70"
              aria-label={t.store.dismiss}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}

        {view.kind === "list" ? (
          <>
            <section className="rounded-xl border border-white/5 bg-surface-low p-4 sm:p-6">
              <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
                <div>
                  <h1 className="text-headline sm:text-display">
                    {t.hero.title}
                  </h1>
                  <p className="mt-1 text-body-sm text-on-surface-variant">
                    {t.hero.body}
                  </p>
                </div>

                {signedIn ? null : (
                  <div className="flex shrink-0 items-start gap-4 rounded-lg border border-primary/20 bg-primary/10 p-4">
                    <span className="mt-0.5 text-primary">
                      <Icon name="info" size={18} />
                    </span>
                    <div>
                      <p className="label text-primary">{t.hero.guestBadge}</p>
                      <p className="mt-1 text-body-sm">{t.hero.guestBody}</p>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <NotificationNotice
              t={t}
              state={push.state}
              busy={push.busy}
              signedIn={signedIn}
              onEnable={() => void push.enable()}
              hasChannels={channels.length > 0}
            />

            {/*
              한도에 닿았을 때만 뜬다. 상시로 보여 주면 세 개를 다 쓰기
              전까지는 팔 것도 없는 광고가 화면에 붙어 있게 된다.
            */}
            {atLimit && tab.kind === "channels" && loaded ? (
              <UpgradeNotice t={t} signedIn={signedIn} />
            ) : null}

            {/*
              좁은 화면에서는 탭과 만들기 버튼을 위아래로 쌓는다. 한 줄에
              두면 영어 라벨에서 버튼이 밀려 나간다.
            */}
            <div className="flex flex-col gap-4 border-b border-white/5 pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-1" role="tablist">
                  <TabButton
                    active={tab.kind === "channels"}
                    onClick={() => setTab({ kind: "channels" })}
                    label={t.list.tab}
                  />
                  <TabButton
                    active={tab.kind === "alerts"}
                    onClick={() => {
                      setTab({ kind: "alerts" });
                      markSeen();
                    }}
                    label={t.alerts.tab}
                    badge={unseen}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="truncate text-body-sm text-on-surface-variant">
                    {tab.kind === "channels"
                      ? t.list.subtitle
                      : filteredChannelName === null
                        ? t.alerts.subtitle
                        : t.alerts.forChannel(filteredChannelName)}
                  </p>

                  {/*
                    남은 자리를 목록 옆에 붙여 둔다. 한도는 만들기를 누른
                    뒤가 아니라 누르기 전에 보여야 한다.
                  */}
                  {tab.kind === "channels" && loaded ? (
                    <span
                      className={`font-mono text-body-sm ${
                        atLimit ? "text-warm" : "text-on-surface-variant"
                      }`}
                    >
                      {limit === null
                        ? t.plan.channelUnlimited(channels.length)
                        : t.plan.channelUsage(channels.length, limit)}
                    </span>
                  ) : null}
                </div>
              </div>

              {tab.kind === "channels" ? (
                <button
                  type="button"
                  onClick={() => setView({ kind: "create" })}
                  disabled={atLimit}
                  className="flex shrink-0 items-center justify-center gap-1 rounded-lg bg-primary-container px-6 py-3 font-bold text-on-primary-container transition-all hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 sm:py-4"
                >
                  <Icon name="plus" size={18} />
                  {t.list.create}
                </button>
              ) : filteredChannelName === null ? null : (
                <button
                  type="button"
                  onClick={() => setTab({ kind: "alerts" })}
                  className="label shrink-0 self-start rounded-lg border border-white/10 px-4 py-2 text-on-surface-variant transition-colors hover:text-primary sm:self-auto"
                >
                  {t.alerts.backToAll}
                </button>
              )}
            </div>

            {tab.kind === "alerts" ? (
              <AlertHistory signedIn={signedIn} channelId={tab.channelId} />
            ) : !loaded ? null : channels.length === 0 ? (
              <div className="card mx-auto flex max-w-md flex-col items-center rounded-xl border-dashed p-8 text-center sm:p-12">
                <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-high text-primary">
                  <Icon name="chart" size={32} />
                </span>
                <h3 className="text-title">{t.list.emptyTitle}</h3>
                <p className="mb-6 mt-1 text-body-sm text-on-surface-variant">
                  {t.list.emptyBody}
                </p>
                <button
                  type="button"
                  onClick={() => setView({ kind: "create" })}
                  className="rounded-lg border border-primary/30 bg-primary/10 px-6 py-2 font-bold text-primary transition-all hover:bg-primary/20"
                >
                  {t.list.emptyAction}
                </button>
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {channels.map((channel) => (
                  <ChannelCard
                    key={channel.id}
                    channel={channel}
                    onEdit={() => setView({ kind: "edit", channel })}
                    onRemove={() => setPendingRemove(channel)}
                    onHistory={() => {
                      setTab({ kind: "alerts", channelId: channel.id });
                      markSeen();
                    }}
                    onToggle={() =>
                      update({ ...channel, enabled: !channel.enabled })
                    }
                  />
                ))}
              </ul>
            )}
          </>
        ) : (
          <ChannelForm
            initial={view.kind === "edit" ? view.channel : undefined}
            signedIn={signedIn}
            onSave={(channel) => {
              if (view.kind === "edit") {
                update(channel);
              } else {
                add(channel);
              }
              setView({ kind: "list" });
            }}
            onCancel={() => setView({ kind: "list" })}
          />
        )}
      </main>

      <footer className="border-t border-white/5 bg-sunken">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
          {/* 소개 페이지로 돌아가는 유일한 길. 머리말의 로고는 앱 안에서
              목록으로 되돌리는 역할이라 여기에 둔다. */}
          <a
            href="/"
            className="text-title font-bold transition-colors hover:text-primary"
          >
            {t.brand}
          </a>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            {t.footer.note}
          </p>
        </div>
      </footer>

      {auth === null ? null : (
        <AuthDialog mode={auth} onClose={() => setAuth(null)} />
      )}

      {myPageOpen ? (
        <MyPageDialog onClose={() => setMyPageOpen(false)} />
      ) : null}

      {/* 재설정 링크로 들어온 경우. 다른 창보다 우선한다. */}
      {recovering ? <ResetPasswordDialog /> : null}

      {pendingRemove === null ? null : (
        <ConfirmDialog
          title={t.card.removeConfirmTitle(pendingRemove.name)}
          body={t.card.removeConfirmBody}
          confirmLabel={t.card.remove}
          onConfirm={() => {
            remove(pendingRemove.id);
            setPendingRemove(null);
          }}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </div>
  );
}

/** 채널/알림 기록 전환. 안 읽은 알림이 있으면 개수를 붙인다. */
function TabButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg px-4 py-2 text-title transition-colors ${
        active
          ? "bg-white/5 text-on-surface"
          : "text-on-surface-variant hover:text-on-surface"
      }`}
    >
      {label}
      {badge !== undefined && badge > 0 ? (
        <span className="label rounded-full bg-primary-container px-2 py-[2px] font-mono text-on-primary-container">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * 무료 한도에 닿았을 때.
 *
 * 결제가 아직 없으므로 버튼 대신 안내만 둔다. 누르면 아무 일도 없는
 * "업그레이드" 버튼은 눌러 본 사람에게 서비스가 고장 난 것처럼 보인다.
 * 게스트에게는 로그인을 먼저 권한다 — 계정 없이 올릴 수 있는 것이 없다.
 */
function UpgradeNotice({ t, signedIn }: { t: Dictionary; signedIn: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-warm/30 bg-warm/5 p-4">
      <div className="min-w-0 flex-1">
        <p className="label text-warm">{t.plan.upgradeTitle}</p>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          {t.plan.upgradeBody}
        </p>
      </div>
      <p className="shrink-0 text-body-sm text-on-surface-variant">
        {signedIn ? t.plan.upgradeSoon : t.notification.loginRequired}
      </p>
    </div>
  );
}

function NotificationNotice({
  t,
  state,
  busy,
  signedIn,
  onEnable,
  hasChannels,
}: {
  t: Dictionary;
  state: PushState;
  busy: boolean;
  signedIn: boolean;
  onEnable: () => void;
  hasChannels: boolean;
}) {
  // 채널이 없으면 아직 알림을 걱정할 단계가 아니다.
  if (!hasChannels || state === "subscribed") {
    return null;
  }

  if (state === "unsupported") {
    return (
      <div className="rounded-lg border border-white/5 bg-card p-4 text-body-sm text-on-surface-variant">
        {t.notification.unsupported}
      </div>
    );
  }

  if (state === "unconfigured") {
    return (
      <div className="rounded-lg border border-white/5 bg-card p-4 text-body-sm text-on-surface-variant">
        {t.notification.unconfigured}
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-body-sm text-danger">
        {t.notification.denied}
      </div>
    );
  }

  // 구독은 사용자에게 매달린다. 게스트에게는 보낼 대상이 없다.
  if (!signedIn) {
    return (
      <div className="rounded-lg border border-white/5 bg-card p-4 text-body-sm text-on-surface-variant">
        {t.notification.loginRequired}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <p className="min-w-0 flex-1 text-body-sm text-on-surface-variant">
        {t.notification.prompt}
      </p>
      <button
        type="button"
        onClick={onEnable}
        disabled={busy}
        className="label shrink-0 rounded-lg bg-primary-container px-6 py-3 font-bold text-on-primary-container transition-all hover:opacity-90 disabled:opacity-50"
      >
        {busy ? t.notification.enabling : t.notification.enable}
      </button>
    </div>
  );
}
