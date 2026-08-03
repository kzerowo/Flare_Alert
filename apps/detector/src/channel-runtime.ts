// 채널 하나의 판정 상태.
//
// 여기부터가 사용자 설정에 달린 부분이다. 같은 종목을 두 채널이 감시하면
// 사건 상태는 각자 따로 돌아야 한다 — 한쪽이 울렸다고 다른 쪽이 조용해지면
// 안 된다 (docs/decisions.md 10번).
//
// 판정 로직은 apps/backtest/src/engine.ts와 같은 순서를 따른다. 거기서
// 알림 빈도와 품질을 쟀으므로 조금이라도 다르면 그 수치가 의미를 잃는다.
//
// 판정은 배수로 한다. 백분위가 아니다.
//
// 사용자가 15분봉 차트에 직접 표시한 "이 정도면 알림"을 정답으로 놓고
// 채점해 보니, 백분위 최댓값 방식은 재현율 39% · 정밀도 28%였고 배수
// 방식(15분 창, 4배)은 64% · 74%였다. 알림 수는 오히려 줄었다.
//
// 쿨다운도 걸지 않는다. 쿨다운은 백분위의 꼬리 비율을 조이는 장치라 배수에
// 그대로 옮길 수 없고, 사건 기반 병합이 들어온 뒤로는 역할이 겹친다 —
// 같은 사건에는 어차피 알림이 하나뿐이다.

import {
  TIMEFRAME_MINUTES,
  TIMEFRAMES,
  scaleRatio,
} from "@flare-alert/core";
import type { Alert, Channel, SymbolRef, Timeframe } from "@flare-alert/core";

import type { FrameSignal } from "./detect.js";

/** 프레임이 길수록 큰 값. 사건 규모를 고를 때 쓴다. */
const FRAME_ORDER = new Map<Timeframe, number>(
  TIMEFRAMES.map((timeframe, index) => [timeframe, index]),
);

export interface ChannelDecision {
  alert: Alert | null;
  /** 임계는 넘었지만 이미 나간 알림에 흡수된 프레임 수 */
  merged: number;
}

let alertSequence = 0;

function nextAlertId(): string {
  alertSequence += 1;
  return `alert-${Date.now().toString(36)}-${alertSequence.toString(36)}`;
}

/**
 * 채널 설정에서 판정 배수를 뽑는다.
 *
 * 채널이 고른 것은 봉 길이 하나뿐이고 배수는 거기 딸려 온다. 봉마다 배수를
 * 따로 두는 이유는 짧은 봉이 원래 더 심하게 튀기 때문이다 — 4배로 고정하면
 * 1분봉은 하루 87회, 15분봉은 3.5회가 된다.
 */
export function channelRatio(channel: Channel): number {
  return scaleRatio(channel.scale);
}

/**
 * 사건이 끝났다고 보는 침묵 시간(초). 채널이 보는 봉 길이와 같다.
 *
 * 고정 300초를 쓰면 봉 길이에 따라 뜻이 달라진다. 4시간봉을 보는 채널에서
 * 5분 식었다고 사건이 끝났다고 하면 큰 급등 하나가 여러 알림으로 쪼개지고,
 * 1분봉에서 300초는 별개 급등 다섯 개를 하나로 묶는다.
 *
 * 무엇보다 SENSITIVITY_SCALES의 alertsPerDay가 "사건 간격 = 봉 길이"로
 * 측정한 값이다. 여기서 다른 기준을 쓰면 화면에 적힌 "하루 4.2회"가
 * 실제와 어긋난다.
 */
export function channelEventGapSeconds(channel: Channel): number {
  return TIMEFRAME_MINUTES[channel.scale] * 60;
}

/** 설정 교체 시에도 넘겨야 하는 판정 상태. */
interface InheritedState {
  /** 마지막으로 임계를 넘은 시각 */
  lastAboveAtMs: number;
  /** 지금 사건에서 이미 알림이 나갔는가 */
  firedThisEvent: boolean;
}

export class ChannelRuntime {
  readonly channel: Channel;
  /** 사건 경계 판정 기준. 알림 시각이 아니라 교차 시각이다. */
  #lastAboveAtMs: number;
  #firedThisEvent: boolean;

  constructor(channel: Channel, inherited?: InheritedState) {
    this.channel = channel;
    this.#lastAboveAtMs = inherited?.lastAboveAtMs ?? Number.NEGATIVE_INFINITY;
    this.#firedThisEvent = inherited?.firedThisEvent ?? false;
  }

  /**
   * 설정만 갈아끼운 새 상태를 만든다.
   *
   * 사건 상태를 넘겨받는 것이 요점이다. 채널 목록을 다시 읽을 때마다 새로
   * 만들면 초기화되어, 방금 울린 사건이 1분 뒤에 또 울린다.
   */
  withChannel(channel: Channel): ChannelRuntime {
    return new ChannelRuntime(channel, {
      lastAboveAtMs: this.#lastAboveAtMs,
      firedThisEvent: this.#firedThisEvent,
    });
  }

  /**
   * 이 초의 신호들로 알림을 낼지 정한다.
   *
   * 판정은 채널이 고른 봉 하나로만 한다. 나머지 프레임은 규모 라벨을
   * 붙이는 데만 쓴다 — 사건이 어디까지 번졌는지 보여주는 표시일 뿐,
   * 알림 여부에는 관여하지 않는다.
   */
  decide(
    target: SymbolRef,
    signals: readonly FrameSignal[],
    atMs: number,
    price: number,
  ): ChannelDecision {
    const threshold = channelRatio(this.channel);

    const primary = signals.find(
      (signal) => signal.timeframe === this.channel.scale,
    );

    // 사건 경계 판정은 이 초를 반영하기 "전"의 값으로 해야 한다.
    const gapMs = channelEventGapSeconds(this.channel) * 1000;
    const isNewEvent = atMs - this.#lastAboveAtMs > gapMs;

    const above =
      primary !== undefined &&
      primary.ratioToMedian !== null &&
      primary.ratioToMedian >= threshold;

    if (above) {
      this.#lastAboveAtMs = atMs;
    }

    if (isNewEvent) {
      this.#firedThisEvent = false;
    }

    if (!above || primary === undefined) {
      return { alert: null, merged: 0 };
    }

    if (this.#firedThisEvent) {
      // 같은 사건이 계속 임계를 넘는 중이다. 이미 나간 알림에 흡수한다.
      return { alert: null, merged: 1 };
    }

    this.#firedThisEvent = true;

    return {
      alert: {
        id: nextAlertId(),
        channelId: this.channel.id,
        target,
        firedAtMs: atMs,
        price,
        percentile: primary.percentile,
        score: primary.score,
        quoteVolume: primary.quoteVolume,
        ratioToMedian: primary.ratioToMedian ?? 0,
        scale: widestScale(signals, threshold, this.channel.scale),
      },
      merged: 0,
    };
  }
}

/**
 * 사건의 규모 라벨. 같은 배수를 넘긴 가장 긴 프레임이다.
 *
 * 판정과는 별개다. 채널이 15분봉급인데 1시간 창까지 같은 배수를 넘겼다면
 * 훨씬 큰 사건이고, 그걸 "1시간봉급"이라고 불러 준다. 최소값은 채널이
 * 고른 봉이다 — 그보다 작게 표시하면 판정 근거와 어긋난다.
 */
function widestScale(
  signals: readonly FrameSignal[],
  threshold: number,
  channelScale: Timeframe,
): Timeframe {
  let scale: Timeframe = channelScale;
  let order = FRAME_ORDER.get(channelScale) ?? 0;

  for (const signal of signals) {
    if (signal.ratioToMedian === null || signal.ratioToMedian < threshold) {
      continue;
    }
    const candidate = FRAME_ORDER.get(signal.timeframe) ?? 0;
    if (candidate > order) {
      order = candidate;
      scale = signal.timeframe;
    }
  }

  return scale;
}
