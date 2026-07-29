// 채널 하나의 판정 상태.
//
// 여기부터가 사용자 설정에 달린 부분이다. 같은 종목을 두 채널이 감시하면
// 쿨다운과 병합은 각자 따로 돌아야 한다 — 한쪽이 울렸다고 다른 쪽이
// 조용해지면 안 된다 (docs/decisions.md 10번).
//
// 판정 로직은 apps/backtest/src/engine.ts와 같은 순서를 따른다. 거기서
// 알림 빈도와 품질을 쟀으므로 조금이라도 다르면 그 수치가 의미를 잃는다.

import {
  FRAME_MERGE_WINDOW_SECONDS,
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

export class ChannelRuntime {
  readonly channel: Channel;
  readonly #cooldown: TimeDecayCooldown;
  #lastAlertAtMs: number;

  constructor(
    channel: Channel,
    inherited?: { cooldown: TimeDecayCooldown; lastAlertAtMs: number },
  ) {
    this.channel = channel;
    this.#cooldown = inherited?.cooldown ?? new TimeDecayCooldown();
    this.#lastAlertAtMs = inherited?.lastAlertAtMs ?? Number.NEGATIVE_INFINITY;
  }

  /**
   * 설정만 갈아끼운 새 상태를 만든다.
   *
   * 쿨다운과 마지막 알림 시각을 넘겨받는 것이 요점이다. 채널 목록을 다시
   * 읽을 때마다 새로 만들면 그 둘이 초기화되어, 방금 울린 사건이 1분 뒤에
   * 또 울린다.
   */
  withChannel(channel: Channel): ChannelRuntime {
    return new ChannelRuntime(channel, {
      cooldown: this.#cooldown,
      lastAlertAtMs: this.#lastAlertAtMs,
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

    for (const signal of signals) {
      if (signal.percentile < sensitivity) {
        continue;
      }

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

    if (best === null || scale === null) {
      return { alert: null, rejectedCooldown, merged: 0 };
    }

    // 같은 사건이 수백 초 동안 임계를 계속 넘는다. 병합 창 안의 후속
    // 교차는 이미 나간 알림에 흡수한다. 후보를 모으려고 발사를 미루지는
    // 않는다 — 지연을 줄이려고 aggTrade까지 쓴 물건이라 늦출 수 없다.
    if (atMs - this.#lastAlertAtMs < FRAME_MERGE_WINDOW_SECONDS * 1000) {
      return { alert: null, rejectedCooldown, merged: passed };
    }

    this.#lastAlertAtMs = atMs;

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
