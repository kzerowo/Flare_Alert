"use client";

import { useEffect, useState } from "react";

import type { Channel } from "@flare-alert/core";

import { useAuth } from "@/lib/auth";
import { useChannels } from "@/lib/channel-store";
import { useT } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n";
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

type NotificationState = "unsupported" | "default" | "granted" | "denied";

/** 브라우저 알림 권한 상태. 게스트의 유일한 알림 수단이라 눈에 띄어야 한다. */
function useNotificationPermission() {
  const [state, setState] = useState<NotificationState>("default");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    setState(Notification.permission as NotificationState);
  }, []);

  async function request(): Promise<void> {
    if (!("Notification" in window)) {
      return;
    }
    const result = await Notification.requestPermission();
    setState(result as NotificationState);
  }

  return { state, request };
}

export function MainApp() {
  const t = useT();
  const { user, signOut } = useAuth();
  const { channels, loaded, problem, dismissProblem, add, update, remove } =
    useChannels();
  const [view, setView] = useState<View>({ kind: "list" });
  const [auth, setAuth] = useState<"login" | "signup" | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Channel | null>(null);
  const notification = useNotificationPermission();

  const signedIn = user !== null;

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
              state={notification.state}
              onRequest={notification.request}
              hasChannels={channels.length > 0}
            />

            <div className="flex items-end justify-between border-b border-white/5 pb-4">
              <div>
                <h2 className="text-headline">
                  {t.list.heading(channels.length)}
                </h2>
                <p className="mt-1 text-body-sm text-on-surface-variant">
                  {t.list.subtitle}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setView({ kind: "create" })}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-primary-container px-6 py-4 font-bold text-on-primary-container transition-all hover:brightness-110"
              >
                <Icon name="plus" size={18} />
                {t.list.create}
              </button>
            </div>

            {!loaded ? null : channels.length === 0 ? (
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

function NotificationNotice({
  t,
  state,
  onRequest,
  hasChannels,
}: {
  t: Dictionary;
  state: NotificationState;
  onRequest: () => void;
  hasChannels: boolean;
}) {
  // 채널이 없으면 아직 알림을 걱정할 단계가 아니다.
  if (!hasChannels || state === "granted") {
    return null;
  }

  if (state === "unsupported") {
    return (
      <div className="rounded-lg border border-white/5 bg-card p-4 text-body-sm text-on-surface-variant">
        {t.notification.unsupported}
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

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <p className="text-body-sm text-on-surface-variant">
        {t.notification.prompt}
      </p>
      <button
        type="button"
        onClick={onRequest}
        className="label shrink-0 rounded-lg bg-primary-container px-6 py-2 font-bold text-on-primary-container transition-all hover:opacity-90"
      >
        {t.notification.enable}
      </button>
    </div>
  );
}
