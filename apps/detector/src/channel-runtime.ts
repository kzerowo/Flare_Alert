// 채널 하나의 판정 상태.
//
// 여기부터가 사용자 설정에 달린 부분이다. 같은 종목을 두 채널이 감시하면
// 쿨다운과 병합은 각자 따로 돌아야 한다 — 한쪽이 울렸다고 다른 쪽이
// 조용해지면 안 된다 (docs/decisions.md 10번).
//
// 판정 로직은 apps/backtest/src/engine.ts와 같은 순서를 따른다. 거기서
// 알림 빈도와 품질을 쟀으므로 조금이라도 다르면 그 수치가 의미를 잃는다.

import {
  EVENT_GAP_SECONDS,
  TIMEFRAMES,
  TimeDecayCooldown,
} from "@flare-alert/core";
import type {
  Alert,
  Channel,
  SeriesKey,
  SymbolRef,
  Timeframe,
} from "@flare-alert/core";

import type { FrameSignal } from "./detect.js";

/** 프레임이 길수록 큰 값. 사건 규모를 고를 때 쓴다. */
const FRAME_ORDER = new Map<Timeframe, number>(
  TIMEFRAMES.map((timeframe, index) => [timeframe, index]),
);

export interface ChannelDecision {
  alert: Alert | null;
  /** 임계는 넘었지만 쿨다운에 걸린 프레임 수 */
  rejectedCooldown: number;
  /** 직전 알림과 같은 사건으로 보고 흡수한 프레임 수 */
  merged: number;
}

let alertSequence = 0;

function nextAlertId(): string {
  alertSequence += 1;
  return `alert-${Date.now().toString(36)}-${alertSequence.toString(36)}`;
}

/** 설정 교체 시에도 넘겨야 하는 판정 상태. */
interface InheritedState {
  cooldown: TimeDecayCooldown;
  /** 마지막으로 임계를 넘은 시각 */
  lastAboveAtMs: number;
  /** 지금 사건에서 이미 알림이 나갔는가 */
  firedThisEvent: boolean;
}

export class ChannelRuntime {
  readonly channel: Channel;
  readonly #cooldown: TimeDecayCooldown;
  /** 사건 경계 판정 기준. 알림 시각이 아니라 교차 시각이다. */
  #lastAboveAtMs: number;
  #firedThisEvent: boolean;

  constructor(channel: Channel, inherited?: InheritedState) {
    this.channel = channel;
    this.#cooldown = inherited?.cooldown ?? new TimeDecayCooldown();
    this.#lastAboveAtMs = inherited?.lastAboveAtMs ?? Number.NEGATIVE_INFINITY;
    this.#firedThisEvent = inherited?.firedThisEvent ?? false;
  }

  /**
   * 설정만 갈아끼운 새 상태를 만든다.
   *
   * 쿨다운과 사건 상태를 넘겨받는 것이 요점이다. 채널 목록을 다시 읽을
   * 때마다 새로 만들면 그것들이 초기화되어, 방금 울린 사건이 1분 뒤에
   * 또 울린다.
   */
  withChannel(channel: Channel): ChannelRuntime {
    return new ChannelRuntime(channel, {
      cooldown: this.#cooldown,
      lastAboveAtMs: this.#lastAboveAtMs,
      firedThisEvent: this.#firedThisEvent,
    });
  }

  /**
   * 이 초의 신호들로 알림을 낼지 정한다.
   *
   * 프레임별로 알림을 만들지 않는다. 여러 프레임이 동시에 임계를 넘어도
   * 알림은 채널당 하나다. 프레임 수를 세어 강도로 쓰지도 않는다.
   */
  decide(
    target: SymbolRef,
    signals: readonly FrameSignal[],
    atMs: number,
    price: number,
  ): ChannelDecision {
    const sensitivity = this.channel.sensitivity;

    let rejectedCooldown = 0;
    let best: FrameSignal | null = null;
    let scale: Timeframe | null = null;
    let passed = 0;

    // 사건 경계 판정은 이 초를 반영하기 "전"의 값으로 해야 한다.
    const isNewEvent = atMs - this.#lastAboveAtMs > EVENT_GAP_SECONDS * 1000;

    for (const signal of signals) {
      if (signal.percentile < sensitivity) {
        continue;
      }

      // 쿨다운에 막히더라도 임계를 넘었으면 사건은 이어지는 중이다.
      this.#lastAboveAtMs = atMs;

      const key: SeriesKey = {
        exchange: target.exchange,
        symbol: target.symbol,
        timeframe: signal.timeframe,
      };

      const threshold = this.#cooldown.effectiveThreshold(
        key,
        sensitivity,
        atMs,
      );

      if (signal.percentile < threshold) {
        rejectedCooldown += 1;
        continue;
      }

      this.#cooldown.record(key, atMs);
      passed += 1;

      // 판정에 쓸 신호는 가장 높은 백분위를 낸 프레임.
      if (best === null || signal.percentile > best.percentile) {
        best = signal;
      }

      // 사건의 규모는 이상치였던 가장 긴 프레임. 판정과는 별개의 라벨이다.
      const order = FRAME_ORDER.get(signal.timeframe) ?? 0;
      if (scale === null || order > (FRAME_ORDER.get(scale) ?? 0)) {
        scale = signal.timeframe;
      }
    }

    // 사건이 새로 시작했으면 발사 권리도 새로 생긴다. 이 초에 쿨다운으로
    // 아무것도 통과하지 못했더라도 리셋해 둬야, 사건 도중 쿨다운이 풀렸을 때
    // 그 사건의 첫 알림이 제대로 나간다.
    if (isNewEvent) {
      this.#firedThisEvent = false;
    }

    if (best === null || scale === null) {
      return { alert: null, rejectedCooldown, merged: 0 };
    }

    // 같은 사건이 수백 초 동안 임계를 계속 넘는다. 사건당 알림은 하나이므로
    // 이미 나간 알림에 흡수한다. 후보를 모으려고 발사를 미루지는 않는다 —
    // 지연을 줄이려고 aggTrade까지 쓴 물건이라 늦출 수 없다.
    if (this.#firedThisEvent) {
      return { alert: null, rejectedCooldown, merged: passed };
    }

    this.#firedThisEvent = true;

    return {
      alert: {
        id: nextAlertId(),
        channelId: this.channel.id,
        target,
        firedAtMs: atMs,
        price,
        percentile: best.percentile,
        score: best.score,
        quoteVolume: best.quoteVolume,
        ratioToMedian: best.ratioToMedian ?? 0,
        scale,
      },
      rejectedCooldown,
      merged: 0,
    };
  }
}
