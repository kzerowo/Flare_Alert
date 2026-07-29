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
  DETECTION_TIMEFRAME,
  EVENT_GAP_SECONDS,
  TIMEFRAMES,
  percentileToSlider,
  sliderToRatio,
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
 * channels.sensitivity에는 아직 백분위가 들어 있다. 그 값을 슬라이더
 * 위치로 되돌린 뒤 배수로 옮긴다. 사용자가 맞춰 둔 상대적 위치는 그대로
 * 유지되므로 마이그레이션 없이 넘어갈 수 있다.
 *
 * 임시 조치다. 축을 다시 손보면 저장된 값의 의미가 조용히 바뀌므로,
 * 결국 배수를 직접 저장하도록 스키마를 옮겨야 한다.
 */
export function channelRatio(channel: Channel): number {
  return sliderToRatio(percentileToSlider(channel.sensitivity));
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
   * 판정은 DETECTION_TIMEFRAME 하나로만 한다. 나머지 프레임은 규모 라벨을
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
      (signal) => signal.timeframe === DETECTION_TIMEFRAME,
    );

    // 사건 경계 판정은 이 초를 반영하기 "전"의 값으로 해야 한다.
    const isNewEvent = atMs - this.#lastAboveAtMs > EVENT_GAP_SECONDS * 1000;

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
        scale: widestScale(signals, threshold),
      },
      merged: 0,
    };
  }
}

/**
 * 사건의 규모 라벨. 같은 배수를 넘긴 가장 긴 프레임이다.
 *
 * 판정과는 별개다. 15분 창이 4배인데 1시간 창까지 4배라면 훨씬 큰 사건이고,
 * 그걸 "1시간봉급"이라고 불러 준다.
 */
function widestScale(
  signals: readonly FrameSignal[],
  threshold: number,
): Timeframe {
  let scale: Timeframe = DETECTION_TIMEFRAME;
  let order = FRAME_ORDER.get(DETECTION_TIMEFRAME) ?? 0;

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
