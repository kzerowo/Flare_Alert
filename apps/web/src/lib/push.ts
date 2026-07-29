"use client";

// 웹 푸시 구독.
//
// 브라우저가 만든 구독을 Supabase에 저장하면, detector가 그걸 읽어
// 알림을 보낸다. 탭이 열려 있는지와 무관하게 도착한다.
//
// 로그인이 필요하다. 구독은 사용자에게 매달리는데 게스트에게는 사용자가
// 없다. 게스트에게 알림을 주려면 익명 식별자를 만들어야 하고, 그러면
// 브라우저를 지우는 순간 영영 못 찾는 구독이 DB에 남는다.

import { getBrowserClient } from "./supabase/client";
import { VAPID_PUBLIC_KEY } from "./supabase/config";

export type PushState =
  /** 이 브라우저가 푸시를 지원하지 않음 */
  | "unsupported"
  /** VAPID 공개 키가 설정되지 않음 (배포 설정 누락) */
  | "unconfigured"
  /** 아직 권한을 묻지 않음 */
  | "default"
  /** 권한은 있는데 아직 구독하지 않음 */
  | "granted"
  /** 구독까지 마침 */
  | "subscribed"
  /** 사용자가 거부함. 브라우저 설정에서만 되돌릴 수 있다 */
  | "denied";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * VAPID 공개 키를 브라우저가 원하는 형태로 바꾼다.
 *
 * 키는 base64url 문자열로 오는데 pushManager.subscribe는 바이트 배열을
 * 요구한다. base64url은 표준 base64와 문자 두 개가 다르고 패딩이 없어서
 * atob에 그대로 넣을 수 없다.
 */
function toApplicationServerKey(base64Url: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);

  // ArrayBuffer를 직접 만들어 돌려준다. Uint8Array를 그대로 넘기면
  // 그 buffer가 SharedArrayBuffer일 수도 있다고 보아 타입이 맞지 않는다.
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return buffer;
}

/** ArrayBuffer를 base64url로. 구독 키를 DB에 넣을 때 쓴다. */
function toBase64Url(buffer: ArrayBuffer | null): string {
  if (buffer === null) {
    return "";
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * "Chrome / Windows (localhost:3000)" 정도로 어느 구독인지 알아볼 수 있게.
 *
 * 출처를 붙이는 이유가 있다. 브라우저는 포트가 다르면 다른 사이트로
 * 보므로 localhost:3000과 :3002에서 각각 구독하면 행이 두 개 생기고,
 * 같은 알림이 두 번 뜬다. 라벨에 출처가 없으면 둘 다 "Chrome / Windows"로
 * 보여서 어느 쪽이 남은 것인지 구분할 수 없다.
 */
function describeDevice(): string {
  const ua = navigator.userAgent;

  let browser = "브라우저";
  if (ua.includes("Edg/")) {
    browser = "Edge";
  } else if (ua.includes("Chrome/")) {
    browser = "Chrome";
  } else if (ua.includes("Firefox/")) {
    browser = "Firefox";
  } else if (ua.includes("Safari/")) {
    browser = "Safari";
  }

  let os = "";
  if (ua.includes("Windows")) {
    os = "Windows";
  } else if (ua.includes("Mac OS")) {
    os = "macOS";
  } else if (ua.includes("Android")) {
    os = "Android";
  } else if (ua.includes("iPhone") || ua.includes("iPad")) {
    os = "iOS";
  } else if (ua.includes("Linux")) {
    os = "Linux";
  }

  const device = os === "" ? browser : `${browser} / ${os}`;
  return `${device} (${window.location.host})`;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) {
    return null;
  }
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

/** 지금 이 브라우저의 상태. 화면에 무엇을 보여줄지 정하는 데 쓴다. */
export async function readPushState(): Promise<PushState> {
  if (!isPushSupported()) {
    return "unsupported";
  }
  if (VAPID_PUBLIC_KEY === null) {
    return "unconfigured";
  }
  if (Notification.permission === "denied") {
    return "denied";
  }
  if (Notification.permission === "default") {
    return "default";
  }

  const registration = await navigator.serviceWorker.getRegistration();
  const existing = await registration?.pushManager.getSubscription();

  return existing == null ? "granted" : "subscribed";
}

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: "denied" | "unsupported" | "unconfigured" | "failed" };

/**
 * 권한을 묻고 구독해서 저장까지 한다.
 *
 * 사용자 제스처(클릭) 안에서 불러야 한다. 브라우저가 그렇지 않은
 * 권한 요청을 무시하거나 자동 거부한다.
 */
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!isPushSupported()) {
    return { ok: false, reason: "unsupported" };
  }

  const applicationServerKey = VAPID_PUBLIC_KEY;
  if (applicationServerKey === null) {
    return { ok: false, reason: "unconfigured" };
  }

  const client = getBrowserClient();
  if (client === null) {
    return { ok: false, reason: "unconfigured" };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: "denied" };
  }

  try {
    const registration =
      (await navigator.serviceWorker.getRegistration()) ??
      (await navigator.serviceWorker.register("/sw.js"));

    // 워커가 활성화되기 전에 subscribe하면 실패한다.
    await navigator.serviceWorker.ready;

    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        // false로 두면 브라우저가 거부한다. 사용자에게 보이지 않는 푸시로
        // 추적하는 것을 막으려는 규칙이고, 우리는 어차피 항상 알림을 띄운다.
        userVisibleOnly: true,
        applicationServerKey: toApplicationServerKey(applicationServerKey),
      }));

    const { data } = await client.auth.getUser();
    const userId = data.user?.id;
    if (userId === undefined) {
      return { ok: false, reason: "failed" };
    }

    const { error } = await client.from("push_subscriptions").upsert(
      {
        endpoint: subscription.endpoint,
        user_id: userId,
        p256dh: toBase64Url(subscription.getKey("p256dh")),
        auth: toBase64Url(subscription.getKey("auth")),
        label: describeDevice(),
      },
      { onConflict: "endpoint" },
    );

    if (error !== null) {
      return { ok: false, reason: "failed" };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** 이 브라우저의 구독을 해제하고 DB에서도 지운다. */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) {
    return false;
  }

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription == null) {
    return true;
  }

  const client = getBrowserClient();
  if (client !== null) {
    await client
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", subscription.endpoint);
  }

  return subscription.unsubscribe();
}
