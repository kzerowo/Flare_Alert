// 체결을 1초 버킷에 모으고, 프레임별 롤링 창을 잘라낸다.
//
// 백테스트(apps/backtest/src/replay.ts)와 같은 창을 만들어야 한다. 거기서
// 잰 파라미터를 여기서 쓰기 때문이다. 다른 점은 방향뿐이다 — 백테스트는
// 전체 기간을 미리 알고 누적합을 만들어 두지만, 여기서는 미래를 모르므로
// 창마다 진행 중인 합을 들고 간다.

import {
  LOOKBACK_WINDOW_COUNT,
  MIN_ELAPSED_SECONDS,
  TIMEFRAMES,
  TIMEFRAME_MINUTES,
} from "@flare-alert/core";
import type { Timeframe } from "@flare-alert/core";

/** 특정 시점에 잘라낸 프레임 하나의 상태. */
export interface FrameSlice {
  timeframe: Timeframe;
  /** 창이 열린 시각 (epoch ms) */
  openedAtMs: number;
  /** 창이 열린 뒤 경과한 초 */
  elapsedSeconds: number;
  /** 창 누적 거래대금 */
  quoteVolume: number;
  /** v = 거래대금 / 경과분 */
  velocity: number;
  /** 기준선 계산용 직전 완결 창들의 속도. 시간 순. */
  velocities: number[];
}

interface FrameState {
  timeframe: Timeframe;
  windowSeconds: number;
  minElapsedSeconds: number;
  lookback: number;
  /** 현재 창의 서수. 아직 창이 안 열렸으면 -1. */
  ordinal: number;
  /** 현재 창에 쌓인 거래대금 */
  windowVolume: number;
  /** 완결된 창들의 속도. 링 버퍼. */
  velocities: Float64Array;
  writeIndex: number;
  /** 지금까지 완결된 창의 총 개수 */
  completed: number;
}

function createFrame(timeframe: Timeframe): FrameState {
  const lookback = LOOKBACK_WINDOW_COUNT[timeframe];
  return {
    timeframe,
    windowSeconds: TIMEFRAME_MINUTES[timeframe] * 60,
    minElapsedSeconds: MIN_ELAPSED_SECONDS[timeframe],
    lookback,
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
  /** 아직 창에 반영되지 않은 초별 거래대금. 키는 절대 초. */
  readonly #pending = new Map<number, number>();
  #lastPrice = 0;
  #currentSecond = -1;

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
   * 전에 창을 평가하면 절반만 찬 거래대금으로 속도를 계산하게 된다.
   * 실제 반영은 시계가 그 초를 지날 때 feed에서 한다.
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
    this.#feed(absSecond, 1, volume);
  }

  /**
   * 1분치를 한 번에 반영한다. 과거 봉으로 채울 때 쓴다.
   *
   * 초 단위로 60번 도는 것과 결과가 같다. 모든 프레임의 창 경계가 60의
   * 배수라서 1분 안에서는 경계를 넘지 않기 때문이다.
   */
  feedMinute(startSecond: number, quoteVolume: number, close: number): void {
    this.#feed(startSecond, 60, quoteVolume);
    if (close > 0) {
      this.#lastPrice = close;
    }
  }

  #feed(startSecond: number, spanSeconds: number, quoteVolume: number): void {
    for (const frame of this.#frames) {
      const ordinal = Math.floor(startSecond / frame.windowSeconds);

      if (frame.ordinal !== ordinal) {
        if (frame.ordinal >= 0) {
          this.#closeWindow(frame);
        }
        frame.ordinal = ordinal;
        frame.windowVolume = 0;
      }

      frame.windowVolume += quoteVolume;
    }

    this.#currentSecond = startSecond + spanSeconds - 1;
    this.#prunePending();
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
   * 빠지는 이유는 두 가지다. 완결 창이 모자라 기준선을 못 만들거나,
   * 창이 열린 지 얼마 안 돼 속도가 발산하거나.
   */
  slices(): FrameSlice[] {
    const atSecond = this.#currentSecond;
    if (atSecond < 0) {
      return [];
    }

    const result: FrameSlice[] = [];

    for (const frame of this.#frames) {
      if (frame.completed < frame.lookback) {
        continue;
      }

      const windowStart = frame.ordinal * frame.windowSeconds;
      const elapsedSeconds = atSecond - windowStart + 1;

      if (elapsedSeconds < frame.minElapsedSeconds) {
        continue;
      }

      result.push({
        timeframe: frame.timeframe,
        openedAtMs: windowStart * 1000,
        elapsedSeconds,
        quoteVolume: frame.windowVolume,
        velocity: frame.windowVolume / (elapsedSeconds / 60),
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
