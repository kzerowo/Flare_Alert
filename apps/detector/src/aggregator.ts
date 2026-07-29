// 체결을 1초 버킷에 모으고, 프레임별 트레일링 창을 잘라낸다.
//
// 백테스트(apps/backtest/src/replay.ts)와 같은 창을 만들어야 한다. 거기서
// 잰 파라미터를 여기서 쓰기 때문이다. 다른 점은 방향뿐이다 — 백테스트는
// 전체 기간을 미리 알고 누적합을 만들어 두지만, 여기서는 미래를 모르므로
// 링 버퍼로 최근 구간을 들고 간다.
//
// 판정 대상은 "지금부터 뒤로 W초"다. 경계에 맞춘 부분 창이 아니다.
//
// 예전에는 정렬된 창이 열린 뒤 경과분으로 나눠 속도를 외삽했다. 1분
// 프레임은 10초만 지나면 판정을 시작했으므로 그 10초에 6을 곱한 값을
// 완결 창들의 중앙값과 비교한 셈이다. 10초 표본의 분산이 훨씬 커서 평범한
// 거래가 상시 이상치로 읽혔다 — 실측으로 경과 10초에서 배수가 완결 봉
// 대비 4배 부풀려졌고, 그래서 차트로는 아무 일도 없는 자리에 알림이 갔다.
//
// 기준선은 여전히 경계 정렬 창을 쓴다. 둘 다 "꽉 찬 W초 구간의 분당
// 거래대금"이라 단위가 같고, 정렬 창은 서로 겹치지 않아 중앙값이 안정적이다.

import {
  LOOKBACK_WINDOW_COUNT,
  TIMEFRAMES,
  TIMEFRAME_MINUTES,
} from "@flare-alert/core";
import type { Timeframe } from "@flare-alert/core";

/** 가장 긴 프레임의 길이(초). 1d = 86400. */
const LONGEST_WINDOW_SECONDS = Math.max(
  ...TIMEFRAMES.map((tf) => TIMEFRAME_MINUTES[tf] * 60),
);

/**
 * 초별 거래대금 링 버퍼의 크기.
 *
 * 가장 긴 창보다 1 크게 잡는다. 같으면 지금 쓰려는 칸과 빠져나갈 칸의
 * 인덱스가 겹쳐서, 빼기 전에 덮어써 버린다.
 */
const HISTORY_SIZE = LONGEST_WINDOW_SECONDS + 1;

/** 특정 시점에 잘라낸 프레임 하나의 상태. */
export interface FrameSlice {
  timeframe: Timeframe;
  /** 트레일링 창이 시작하는 시각 (epoch ms) */
  openedAtMs: number;
  /** 창 길이(초). 트레일링이라 늘 프레임 길이와 같다. */
  windowSeconds: number;
  /** 최근 windowSeconds 동안의 거래대금 */
  quoteVolume: number;
  /** v = 거래대금 / 창 분수 */
  velocity: number;
  /** 기준선 계산용 직전 완결 정렬 창들의 속도. 시간 순. */
  velocities: number[];
}

interface FrameState {
  timeframe: Timeframe;
  windowSeconds: number;
  lookback: number;
  /** 최근 windowSeconds 동안의 거래대금. 매 초 증분으로 갱신한다. */
  trailing: number;
  /** 현재 정렬 창의 서수. 아직 창이 안 열렸으면 -1. */
  ordinal: number;
  /** 현재 정렬 창에 쌓인 거래대금. 기준선 표본을 만드는 데만 쓴다. */
  windowVolume: number;
  /** 완결된 정렬 창들의 속도. 링 버퍼. */
  velocities: Float64Array;
  writeIndex: number;
  /** 지금까지 완결된 정렬 창의 총 개수 */
  completed: number;
}

function createFrame(timeframe: Timeframe): FrameState {
  const lookback = LOOKBACK_WINDOW_COUNT[timeframe];
  return {
    timeframe,
    windowSeconds: TIMEFRAME_MINUTES[timeframe] * 60,
    lookback,
    trailing: 0,
    ordinal: -1,
    windowVolume: 0,
    velocities: new Float64Array(lookback),
    writeIndex: 0,
    completed: 0,
  };
}

/**
 * 한 종목의 집계기.
 *
 * 시간은 되돌릴 수 없다. feed는 반드시 시간 순으로 불러야 한다.
 */
export class SymbolAggregator {
  readonly symbol: string;
  readonly #frames: FrameState[];
  /** 초별 거래대금. 인덱스는 absSecond % HISTORY_SIZE. */
  readonly #history = new Float64Array(HISTORY_SIZE);
  /** 아직 창에 반영되지 않은 초별 거래대금. 키는 절대 초. */
  readonly #pending = new Map<number, number>();
  #lastPrice = 0;
  #currentSecond = -1;
  #firstSecond = -1;

  constructor(symbol: string) {
    this.symbol = symbol;
    this.#frames = TIMEFRAMES.map(createFrame);
  }

  get lastPrice(): number {
    return this.#lastPrice;
  }

  get currentSecond(): number {
    return this.#currentSecond;
  }

  /**
   * 체결 하나를 버퍼에 담는다.
   *
   * 바로 창에 넣지 않는 이유는 그 초가 아직 안 끝났기 때문이다. 초가 끝나기
   * 전에 창을 평가하면 절반만 찬 거래대금을 그 초의 값으로 굳히게 된다.
   * 실제 반영은 시계가 그 초를 지날 때 한다.
   */
  ingest(timestampMs: number, price: number, quoteVolume: number): void {
    const second = Math.floor(timestampMs / 1000);

    // 이미 지나간 초의 체결은 버린다. 늦게 온 체결을 소급 반영하면
    // 같은 창을 두 번 다른 값으로 평가하게 된다.
    if (second <= this.#currentSecond) {
      return;
    }

    this.#pending.set(second, (this.#pending.get(second) ?? 0) + quoteVolume);

    if (price > 0) {
      this.#lastPrice = price;
    }
  }

  /**
   * 버퍼에 담긴 이 초의 거래대금을 창에 반영하고 시계를 옮긴다.
   *
   * 체결이 하나도 없어도 반드시 매 초 불러야 한다. 안 부르면 조용한 구간이
   * 창에서 빠져 속도가 부풀려진다.
   */
  advanceSecond(absSecond: number): void {
    const volume = this.#pending.get(absSecond) ?? 0;
    this.#pending.delete(absSecond);
    this.#commit(absSecond, volume);
    this.#currentSecond = absSecond;
    this.#prunePending();
  }

  /**
   * 1분치를 한 번에 반영한다. 과거 봉으로 채울 때 쓴다.
   *
   * 1분 안에서 어떻게 분포했는지는 봉 데이터로 알 수 없으므로 60초에 고르게
   * 편다. 트레일링 창이 분 경계에 걸칠 때 실제와 조금 달라지지만, 봉 하나가
   * 통째로 들어오고 나가는 것보다는 실제에 가깝다.
   */
  feedMinute(startSecond: number, quoteVolume: number, close: number): void {
    const perSecond = quoteVolume / 60;
    for (let k = 0; k < 60; k += 1) {
      this.#commit(startSecond + k, perSecond);
    }
    this.#currentSecond = startSecond + 59;
    this.#prunePending();

    if (close > 0) {
      this.#lastPrice = close;
    }
  }

  /**
   * 한 초를 확정한다.
   *
   * 링 버퍼에 쓰는 것은 모든 프레임이 빠져나갈 값을 읽은 "뒤"여야 한다.
   * HISTORY_SIZE가 가장 긴 창보다 크므로 두 인덱스는 겹치지 않는다.
   */
  #commit(second: number, volume: number): void {
    if (this.#firstSecond < 0) {
      this.#firstSecond = second;
    }

    for (const frame of this.#frames) {
      frame.trailing += volume;

      const leaving = second - frame.windowSeconds;
      if (leaving >= this.#firstSecond) {
        frame.trailing -= this.#history[leaving % HISTORY_SIZE] ?? 0;
      }

      // 정렬 창은 기준선 표본을 만드는 데만 쓴다.
      const ordinal = Math.floor(second / frame.windowSeconds);
      if (frame.ordinal !== ordinal) {
        if (frame.ordinal >= 0) {
          this.#closeWindow(frame);
        }
        frame.ordinal = ordinal;
        frame.windowVolume = 0;
      }
      frame.windowVolume += volume;
    }

    this.#history[second % HISTORY_SIZE] = volume;
  }

  #closeWindow(frame: FrameState): void {
    const minutes = frame.windowSeconds / 60;
    frame.velocities[frame.writeIndex] = frame.windowVolume / minutes;
    frame.writeIndex = (frame.writeIndex + 1) % frame.lookback;
    frame.completed += 1;
  }

  /**
   * 시계보다 뒤처진 버퍼를 버린다.
   *
   * 없으면 재연결 직후처럼 오래된 체결이 몰려올 때 맵이 무한히 자란다.
   */
  #prunePending(): void {
    if (this.#pending.size < 120) {
      return;
    }
    for (const second of this.#pending.keys()) {
      if (second <= this.#currentSecond) {
        this.#pending.delete(second);
      }
    }
  }

  /**
   * 지금 시점의 프레임별 창. 아직 판정할 수 없는 프레임은 빠진다.
   *
   * 빠지는 이유는 두 가지다. 기준선을 만들 완결 창이 모자라거나,
   * 트레일링 창이 아직 꽉 차지 않았거나.
   */
  slices(): FrameSlice[] {
    const atSecond = this.#currentSecond;
    if (atSecond < 0) {
      return [];
    }

    const fedSeconds = atSecond - this.#firstSecond + 1;
    const result: FrameSlice[] = [];

    for (const frame of this.#frames) {
      if (frame.completed < frame.lookback) {
        continue;
      }
      if (fedSeconds < frame.windowSeconds) {
        continue;
      }

      result.push({
        timeframe: frame.timeframe,
        openedAtMs: (atSecond + 1 - frame.windowSeconds) * 1000,
        windowSeconds: frame.windowSeconds,
        quoteVolume: frame.trailing,
        velocity: frame.trailing / (frame.windowSeconds / 60),
        velocities: this.#recentVelocities(frame),
      });
    }

    return result;
  }

  /** 링 버퍼를 시간 순 배열로 편다. */
  #recentVelocities(frame: FrameState): number[] {
    const out: number[] = [];
    for (let i = 0; i < frame.lookback; i += 1) {
      const index = (frame.writeIndex + i) % frame.lookback;
      out.push(frame.velocities[index] ?? 0);
    }
    return out;
  }

  /** 진단용. 프레임별로 완결 창이 몇 개 쌓였는지. */
  warmupState(): Record<Timeframe, { completed: number; lookback: number }> {
    const state = {} as Record<
      Timeframe,
      { completed: number; lookback: number }
    >;
    for (const frame of this.#frames) {
      state[frame.timeframe] = {
        completed: frame.completed,
        lookback: frame.lookback,
      };
    }
    return state;
  }
}
