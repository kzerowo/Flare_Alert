// 서비스 워커. 웹 푸시를 받아 알림으로 띄운다.
//
// 이 파일이 존재하는 이유는 하나다 — 탭이 닫혀 있어도 알림을 받기 위해서다.
// 페이지의 JavaScript가 직접 Notification을 띄우면 탭을 닫는 순간 경로가
// 끊긴다. 서비스 워커는 페이지와 별개로 브라우저가 깨워 주므로 탭과 무관하다.
//
// 번들러를 거치지 않고 public/에 그대로 둔다. 서비스 워커의 범위(scope)는
// 파일이 놓인 경로로 정해져서, /sw.js 여야 사이트 전체를 담당할 수 있다.
// /_next/static/... 아래에 있으면 그 하위 경로만 담당하게 된다.

/* eslint-disable no-restricted-globals */

// 설치되자마자 활성화한다. 기본 동작은 기존 워커가 담당하던 탭이 전부
// 닫힐 때까지 기다리는 것인데, 그러면 알림 기능을 켠 사용자가 브라우저를
// 완전히 껐다 켤 때까지 새 버전을 못 받는다.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * 알림 도착.
 *
 * detector가 보낸 페이로드는 push.ts의 PushPayload와 같은 모양이다.
 * 형식이 어긋나도 알림 자체는 띄운다 — 조용히 사라지는 것보다
 * 내용 없는 알림이라도 뜨는 편이 사용자에게 낫다.
 */
self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null;
  }

  const symbol = payload?.symbol ?? "";
  const scale = payload?.scale ?? "";
  const ratio = payload?.ratioToMedian;
  const channelName = payload?.channelName ?? "";

  const title = symbol ? `${symbol} 유동성 급증` : "유동성 급증";

  const parts = [];
  if (scale) {
    parts.push(`${scale}봉급`);
  }
  if (typeof ratio === "number" && Number.isFinite(ratio)) {
    parts.push(`평소의 ${ratio.toFixed(1)}배`);
  }
  if (channelName) {
    parts.push(channelName);
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body: parts.join(" · "),
      icon: "/icon-192.png",
      badge: "/badge-72.png",
      // 같은 코인의 알림은 서로를 덮어쓴다. 자리를 비운 사이 알림이
      // 여러 개 쌓여 있으면 정작 지금 상황을 읽기 어렵다.
      tag: symbol || "flare-alert",
      renotify: true,
      timestamp: payload?.firedAtMs ?? Date.now(),
      data: { url: "/", alertId: payload?.alertId ?? null },
    }),
  );
});

/**
 * 알림 클릭.
 *
 * 이미 열려 있는 탭이 있으면 그리로 보낸다. 매번 새 탭을 열면 알림을
 * 몇 번 받은 뒤 같은 사이트 탭이 여러 개 쌓인다.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // "/"는 서비스 소개 페이지다. 알림을 눌러 소개를 읽고 싶은 사람은 없다.
  const target = event.notification.data?.url ?? "/app";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(target);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
