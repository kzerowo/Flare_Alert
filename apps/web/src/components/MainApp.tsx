"use client";

import { useEffect, useState } from "react";

import type { Channel } from "@flare-alert/core";

import { useAuth } from "@/lib/auth";
import { useChannels } from "@/lib/channel-store";
import { useT } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n";
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
import { ChannelForm } from "./ChannelForm";
import { Icon } from "./Icon";
import { LanguageToggle } from "./LanguageToggle";

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
  const { user, signOut } = useAuth();
  const { channels, loaded, problem, dismissProblem, add, update, remove } =
    useChannels();
  const [view, setView] = useState<View>({ kind: "list" });
  const [auth, setAuth] = useState<"login" | "signup" | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Channel | null>(null);

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
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 md:px-6">
          <button
            type="button"
            onClick={() => setView({ kind: "list" })}
            className="text-headline font-bold text-primary transition-opacity hover:opacity-80"
          >
            {t.brand}
          </button>

          <div className="flex items-center gap-2">
            <LanguageToggle />

            {signedIn ? (
              <>
                <span className="hidden max-w-[14rem] truncate px-2 text-body-sm text-on-surface-variant sm:block">
                  {user.email}
                </span>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="label px-4 py-2 text-on-surface-variant transition-colors hover:text-primary"
                >
                  {t.nav.logout}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setAuth("login")}
                  className="label px-4 py-2 text-on-surface-variant transition-colors hover:text-primary"
                >
                  {t.nav.login}
                </button>
                <button
                  type="button"
                  onClick={() => setAuth("signup")}
                  className="label rounded-lg bg-primary-container px-6 py-2 font-bold text-on-primary-container transition-all hover:opacity-90"
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
              {problem === "load" ? t.store.loadFailed : t.store.saveFailed}
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
            <section className="rounded-xl border border-white/5 bg-surface-low p-6">
              <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
                <div>
                  <h1 className="text-display">{t.hero.title}</h1>
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

            <div className="flex items-end justify-between gap-4 border-b border-white/5 pb-4">
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
                <p className="mt-2 truncate text-body-sm text-on-surface-variant">
                  {tab.kind === "channels"
                    ? t.list.subtitle
                    : filteredChannelName === null
                      ? t.alerts.subtitle
                      : t.alerts.forChannel(filteredChannelName)}
                </p>
              </div>

              {tab.kind === "channels" ? (
                <button
                  type="button"
                  onClick={() => setView({ kind: "create" })}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-primary-container px-6 py-4 font-bold text-on-primary-container transition-all hover:brightness-110"
                >
                  <Icon name="plus" size={18} />
                  {t.list.create}
                </button>
              ) : filteredChannelName === null ? null : (
                <button
                  type="button"
                  onClick={() => setTab({ kind: "alerts" })}
                  className="label shrink-0 rounded-lg border border-white/10 px-4 py-2 text-on-surface-variant transition-colors hover:text-primary"
                >
                  {t.alerts.backToAll}
                </button>
              )}
            </div>

            {tab.kind === "alerts" ? (
              <AlertHistory signedIn={signedIn} channelId={tab.channelId} />
            ) : !loaded ? null : channels.length === 0 ? (
              <div className="card mx-auto flex max-w-md flex-col items-center rounded-xl border-dashed p-12 text-center">
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
          <span className="text-title font-bold">{t.brand}</span>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            {t.footer.note}
          </p>
        </div>
      </footer>

      {auth === null ? null : (
        <AuthDialog mode={auth} onClose={() => setAuth(null)} />
      )}

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
    <div className="flex items-center justify-between gap-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <p className="text-body-sm text-on-surface-variant">
        {t.notification.prompt}
      </p>
      <button
        type="button"
        onClick={onEnable}
        disabled={busy}
        className="label shrink-0 rounded-lg bg-primary-container px-6 py-2 font-bold text-on-primary-container transition-all hover:opacity-90 disabled:opacity-50"
      >
        {busy ? t.notification.enabling : t.notification.enable}
      </button>
    </div>
  );
}
