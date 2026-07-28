"use client";

import { useEffect, useState } from "react";

import type { Channel } from "@flare-alert/core";

import { useChannels } from "@/lib/channel-store";
import { AuthDialog } from "./AuthDialog";
import { ChannelCard } from "./ChannelCard";
import { ChannelForm } from "./ChannelForm";

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
    <div className="mx-auto min-h-screen w-full max-w-2xl px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Flare Alert</h1>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAuth("login")}
            className="rounded-lg px-3 py-1.5 text-sm text-flare-muted hover:text-flare-accent"
          >
            로그인
          </button>
          <button
            type="button"
            onClick={() => setAuth("signup")}
            className="rounded-lg border border-flare-accent/40 px-3 py-1.5 text-sm text-flare-accent hover:bg-flare-accent/10"
          >
            회원가입
          </button>
        </div>
      </header>

      <p className="mt-3 text-sm leading-relaxed text-flare-muted">
        감시할 코인을 채널로 묶고 민감도만 정하세요. 코인마다 임계치를 따로
        맞출 필요 없이, 종목별 평소 거래량에 맞춰 자동으로 보정됩니다.
      </p>

      {view.kind === "list" ? (
        <>
          <GuestNotice signedIn={signedIn} />
          <NotificationNotice
            state={notification.state}
            onRequest={notification.request}
            hasChannels={channels.length > 0}
          />

          <section className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">
                내 채널{channels.length > 0 ? ` (${channels.length})` : ""}
              </h2>
              <button
                type="button"
                onClick={() => setView({ kind: "create" })}
                className="rounded-lg bg-flare-accent px-3 py-1.5 text-sm font-medium text-flare-bg hover:opacity-90"
              >
                + 채널 만들기
              </button>
            </div>

            {!loaded ? null : channels.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-flare-muted/25 p-8 text-center">
                <p className="text-sm text-flare-muted">
                  아직 채널이 없습니다.
                </p>
                <p className="mt-1 text-xs text-flare-muted/70">
                  코인 몇 개를 묶어 첫 채널을 만들어보세요.
                </p>
              </div>
            ) : (
              <ul className="mt-4 space-y-3">
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
          </section>
        </>
      ) : (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">
            {view.kind === "create" ? "채널 만들기" : "채널 편집"}
          </h2>

          <div className="mt-6">
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
          </div>
        </section>
      )}

      <footer className="mt-16 border-t border-flare-muted/15 pt-6 text-xs leading-relaxed text-flare-muted/60">
        감지 엔진은 아직 연결되지 않았습니다. 지금은 채널을 만들고 설정을
        확인하는 것까지 됩니다.
      </footer>

      {auth === null ? null : (
        <AuthDialog mode={auth} onClose={() => setAuth(null)} />
      )}
    </div>
  );
}

function GuestNotice({ signedIn }: { signedIn: boolean }) {
  if (signedIn) {
    return null;
  }

  return (
    <div className="mt-6 rounded-lg border border-flare-muted/20 bg-flare-surface/60 p-3 text-xs leading-relaxed text-flare-muted">
      로그인 없이 쓰는 중입니다. 만든 채널은 <b>이 탭이 열려 있는 동안</b>{" "}
      유지되고, 브라우저를 닫으면 사라집니다. 알림도 브라우저로만 옵니다.
      계정을 만들면 채널이 저장되고 텔레그램 알림을 쓸 수 있습니다.
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
      <div className="mt-3 rounded-lg border border-flare-muted/20 p-3 text-xs text-flare-muted">
        이 브라우저는 알림을 지원하지 않습니다. 크롬이나 엣지를 써주세요.
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-400">
        알림이 차단되어 있습니다. 주소창 왼쪽 자물쇠 아이콘에서 이 사이트의
        알림을 허용해주세요.
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-flare-accent/30 bg-flare-accent/5 p-3">
      <p className="text-xs leading-relaxed text-flare-muted">
        알림을 받으려면 브라우저 권한이 필요합니다.
      </p>
      <button
        type="button"
        onClick={onRequest}
        className="shrink-0 rounded-lg bg-flare-accent px-3 py-1.5 text-xs font-medium text-flare-bg hover:opacity-90"
      >
        알림 켜기
      </button>
    </div>
  );
}
