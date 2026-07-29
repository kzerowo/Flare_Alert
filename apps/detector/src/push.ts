// 웹 푸시 발송.
//
// 브라우저의 Notification API를 페이지에서 직접 부르지 않는다. 그 방식은
// 탭이 열려 있어야만 동작하는데, 트레이더가 이 사이트 탭을 하루 종일
// 열어둘 거라는 가정이 비현실적이었다. 서비스 워커로 받으면 탭과 무관하게
// 도착한다 (브라우저 자체를 종료하면 그때는 못 받는다).
//
// 암호화를 직접 구현하지 않고 web-push를 쓴다. 페이로드 암호화는
// ECDH P-256 + HKDF + AES128GCM 조합이고(RFC 8291), 여기서 미묘하게
// 틀리면 조용히 전달만 안 된다. 직접 만들 이유가 없는 부분이다.

import webpush from "web-push";
import type { PushSubscription } from "web-push";

import type { Alert, BrowserTarget } from "@flare-alert/core";

import type { VapidConfig } from "./config.js";

/** 서비스 워커가 받아서 화면에 띄우는 데 필요한 것만 담는다. */
export interface PushPayload {
  alertId: string;
  channelId: string;
  channelName: string;
  symbol: string;
  scale: string;
  price: number;
  ratioToMedian: number;
  firedAtMs: number;
}

export type PushOutcome =
  | { kind: "sent" }
  /** 구독이 영구히 죽었다. 지워야 한다. */
  | { kind: "gone" }
  | { kind: "failed"; reason: string };

export class Pusher {
  constructor(config: VapidConfig) {
    webpush.setVapidDetails(
      config.subject,
      config.publicKey,
      config.privateKey,
    );
  }

  async send(
    target: BrowserTarget,
    alert: Alert,
    channelName: string,
  ): Promise<PushOutcome> {
    const subscription: PushSubscription = {
      endpoint: target.endpoint,
      keys: { p256dh: target.p256dh, auth: target.auth },
    };

    const payload: PushPayload = {
      alertId: alert.id,
      channelId: alert.channelId,
      channelName,
      symbol: alert.target.symbol,
      scale: alert.scale,
      price: alert.price,
      ratioToMedian: alert.ratioToMedian,
      firedAtMs: alert.firedAtMs,
    };

    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload), {
        // 급등은 금방 지나간다. 기기가 오래 꺼져 있었다면 그때 밀어 넣어야
        // 이미 끝난 사건을 알리게 된다. 10분이 지나면 버린다.
        TTL: 600,
        urgency: "high",
      });
      return { kind: "sent" };
    } catch (error) {
      // 404/410은 구독이 영구히 사라졌다는 뜻이다. 사용자가 브라우저
      // 데이터를 지웠거나 알림 권한을 껐다. 재시도해도 영영 안 된다.
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        return { kind: "gone" };
      }
      return { kind: "failed", reason: String(error) };
    }
  }
}

/**
 * VAPID 키 쌍을 만든다.
 *
 * 한 번 만들어 환경변수에 넣고 계속 쓴다. 키를 바꾸면 기존 구독이 전부
 * 무효가 되어 모든 사용자가 알림을 다시 켜야 한다.
 */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
