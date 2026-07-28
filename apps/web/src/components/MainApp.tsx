"use client";

import { useEffect, useState } from "react";

import type { Channel } from "@flare-alert/core";

import { useChannels } from "@/lib/channel-store";
import { AuthDialog } from "./AuthDialog";
import { ChannelCard } from "./ChannelCard";
import { ChannelForm } from "./ChannelForm";
import { Icon } from "./Icon";

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
  const { channels, loaded, add, update, remove } = useChannels();
  const [view, setView] = useState<View>({ kind: "list" });
  const [auth, setAuth] = useState<"login" | "signup" | null>(null);
  const notification = useNotificationPermission();

  // 로그인은 아직 없다. 붙으면 세션에서 읽어온다.
  const signedIn = false;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 md:px-6">
          <span className="text-headline font-bold text-primary">
            Flare Alert
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAuth("login")}
              className="label px-4 py-2 text-on-surface-variant transition-colors hover:text-primary"
            >
              로그인
            </button>
            <button
              type="button"
              onClick={() => setAuth("signup")}
              className="label rounded-lg bg-primary-container px-6 py-2 font-bold text-on-primary-container transition-all hover:opacity-90"
            >
              회원가입
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-grow space-y-6 px-4 py-6 md:px-6">
        {view.kind === "list" ? (
          <>
            <section className="rounded-xl border border-white/5 bg-surface-low p-6">
              <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
                <div>
                  <h1 className="text-display">
                    코인마다 임계치를 맞출 필요 없는 급등 알림
                  </h1>
                  <p className="mt-1 text-body-sm text-on-surface-variant">
                    감시할 코인을 채널로 묶고 민감도만 정하면, 종목별 평소
                    거래량에 맞춰 자동으로 보정됩니다.
                  </p>
                </div>

                {signedIn ? null : (
                  <div className="flex shrink-0 items-start gap-4 rounded-lg border border-primary/20 bg-primary/10 p-4">
                    <span className="mt-0.5 text-primary">
                      <Icon name="info" size={18} />
                    </span>
                    <div>
                      <p className="label text-primary">게스트</p>
                      <p className="mt-1 text-body-sm">
                        채널은 이 탭이 열려 있는 동안 유지됩니다.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <NotificationNotice
              state={notification.state}
              onRequest={notification.request}
              hasChannels={channels.length > 0}
            />

            <div className="flex items-end justify-between border-b border-white/5 pb-4">
              <div>
                <h2 className="text-headline">
                  내 채널{channels.length > 0 ? ` (${channels.length})` : ""}
                </h2>
                <p className="mt-1 text-body-sm text-on-surface-variant">
                  감시 중인 목록입니다
                </p>
              </div>

              <button
                type="button"
                onClick={() => setView({ kind: "create" })}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-primary-container px-6 py-4 font-bold text-on-primary-container transition-all hover:brightness-110"
              >
                <Icon name="plus" size={18} />
                채널 만들기
              </button>
            </div>

            {!loaded ? null : channels.length === 0 ? (
              <div className="card mx-auto flex max-w-md flex-col items-center rounded-xl border-dashed p-12 text-center">
                <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-high text-primary">
                  <Icon name="chart" size={32} />
                </span>
                <h3 className="text-title">아직 채널이 없습니다</h3>
                <p className="mb-6 mt-1 text-body-sm text-on-surface-variant">
                  코인 몇 개를 묶어 첫 채널을 만들어보세요.
                </p>
                <button
                  type="button"
                  onClick={() => setView({ kind: "create" })}
                  className="rounded-lg border border-primary/30 bg-primary/10 px-6 py-2 font-bold text-primary transition-all hover:bg-primary/20"
                >
                  첫 채널 만들기
                </button>
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {channels.map((channel) => (
                  <ChannelCard
                    key={channel.id}
                    channel={channel}
                    onEdit={() => setView({ kind: "edit", channel })}
                    onRemove={() => remove(channel.id)}
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
          <span className="text-title font-bold">Flare Alert</span>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            감지 엔진은 아직 연결되지 않았습니다. 지금은 채널을 만들고 설정을
            확인하는 것까지 됩니다.
          </p>
        </div>
      </footer>

      {auth === null ? null : (
        <AuthDialog mode={auth} onClose={() => setAuth(null)} />
      )}
    </div>
  );
}

function NotificationNotice({
  state,
  onRequest,
  hasChannels,
}: {
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
        이 브라우저는 알림을 지원하지 않습니다. 크롬이나 엣지를 써주세요.
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-body-sm text-danger">
        알림이 차단되어 있습니다. 주소창 왼쪽 자물쇠 아이콘에서 이 사이트의
        알림을 허용해주세요.
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <p className="text-body-sm text-on-surface-variant">
        알림을 받으려면 브라우저 권한이 필요합니다.
      </p>
      <button
        type="button"
        onClick={onRequest}
        className="label shrink-0 rounded-lg bg-primary-container px-6 py-2 font-bold text-on-primary-container transition-all hover:opacity-90"
      >
        알림 켜기
      </button>
    </div>
  );
}
