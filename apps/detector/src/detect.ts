// 창을 점수로, 점수를 백분위로 바꾸는 단계.
//
// 여기까지는 채널과 무관하다. 점수 S와 백분위는 종목·프레임의 성질이지
// 사용자 설정의 함수가 아니다. 그래서 종목당 한 번만 계산하고, 채널별
// 임계는 그 결과에 각각 적용한다 (docs/decisions.md 10번).

import {
  HistogramPercentileEstimator,
  MIN_QUOTE_VOLUME,
  computeBaseline,
  computeScore,
  ratioToMedian,
} from "@flare-alert/core";
import type { SeriesKey, Timeframe } from "@flare-alert/core";

import { SymbolAggregator } from "./aggregator.js";
import type { FrameSlice } from "./aggregator.js";

const EXCHANGE = "binance" as const;

/** 한 프레임이 지금 내놓은 신호. */
export interface FrameSignal {
  timeframe: Timeframe;
  score: number;
  percentile: number;
  quoteVolume: number;
  velocity: number;
  /** 표시용 배수 (v / M). 중앙값이 0이면 낼 수 없다. */
  ratioToMedian: number | null;
}

/** 판정을 시도했지만 신호가 안 나온 이유들. 진단에 쓴다. */
export interface DetectStats {
  evaluated: number;
  scoreUndefined: number;
  insufficientHistory: number;
  rejectedTurnover: number;
}

export interface DetectOptions {
  /**
   * 백분위 분포에 표본을 쌓기만 하고 신호는 내지 않는다.
   *
   * 과거 봉으로 채우는 동안 쓴다. 그때 나온 신호로 알림을 보내면
   * 이미 지나간 급등을 지금 일어난 것처럼 알리게 된다.
   */
  silent?: boolean;
  /**
   * 이 프레임들은 아예 건드리지 않는다. 분포에도 넣지 않는다.
   *
   * 분 단위 재생이 실제 분포를 왜곡하는 프레임을 빼는 데 쓴다.
   * 이유는 backfill.ts 머리말 참고.
   */
  skip?: ReadonlySet<Timeframe>;
}

/**
 * 여러 종목을 함께 보는 감지기.
 *
 * 백분위 추정기는 종목·프레임별로 내부에서 나뉘므로 하나만 둔다.
 */
export class Detector {
  readonly #estimator = new HistogramPercentileEstimator();
  readonly #aggregators = new Map<string, SymbolAggregator>();
  readonly #stats: DetectStats = {
    evaluated: 0,
    scoreUndefined: 0,
    insufficientHistory: 0,
    rejectedTurnover: 0,
  };

  aggregator(symbol: string): SymbolAggregator {
    const existing = this.#aggregators.get(symbol);
    if (existing !== undefined) {
      return existing;
    }
    const created = new SymbolAggregator(symbol);
    this.#aggregators.set(symbol, created);
    return created;
  }

  get symbols(): string[] {
    return [...this.#aggregators.keys()];
  }

  get stats(): Readonly<DetectStats> {
    return this.#stats;
  }

  /** 해당 종목·프레임에 쌓인 백분위 표본 수. */
  sampleCount(symbol: string, timeframe: Timeframe): number {
    return this.#estimator.sampleCount({
      exchange: EXCHANGE,
      symbol,
      timeframe,
    });
  }

  /**
   * 지금 시점의 신호를 낸다.
   *
   * 집계기의 시계를 옮기는 것은 호출부 책임이다. 실시간은 매 초,
   * 과거 채우기는 매 분 옮긴다.
   */
  evaluate(
    symbol: string,
    atMs: number,
    options: DetectOptions = {},
  ): FrameSignal[] {
    const aggregator = this.#aggregators.get(symbol);
    if (aggregator === undefined) {
      return [];
    }

    const signals: FrameSignal[] = [];

    for (const slice of aggregator.slices()) {
      if (options.skip?.has(slice.timeframe) === true) {
        continue;
      }
      const signal = this.#evaluateFrame(symbol, slice, atMs, options);
      if (signal !== null) {
        signals.push(signal);
      }
    }

    return signals;
  }

  #evaluateFrame(
    symbol: string,
    slice: FrameSlice,
    atMs: number,
    options: DetectOptions,
  ): FrameSignal | null {
    const key: SeriesKey = {
      exchange: EXCHANGE,
      symbol,
      timeframe: slice.timeframe,
    };

    const baseline = computeBaseline(slice.velocities);

    const window = {
      key,
      openedAtMs: slice.openedAtMs,
      evaluatedAtMs: atMs,
      elapsedMinutes: slice.elapsedSeconds / 60,
      quoteVolume: slice.quoteVolume,
      velocity: slice.velocity,
    };

    if (!options.silent) {
      this.#stats.evaluated += 1;
    }

    const score = computeScore(window, baseline);
    if (score === null) {
      if (!options.silent) {
        this.#stats.scoreUndefined += 1;
      }
      return null;
    }

    // 백분위는 "과거" 분포 기준이어야 한다. 지금 관측치가 자기 자신의
    // 순위에 끼면 아무리 큰 값도 100에 닿지 못한다. 조회 먼저, 반영은 그 다음.
    const percentile = this.#estimator.toPercentile(key, score);
    this.#estimator.observe(key, score, atMs);

    if (options.silent) {
      return null;
    }

    if (percentile === null) {
      this.#stats.insufficientHistory += 1;
      return null;
    }

    // 잡코인이 1만원에서 20만원이 되면 S는 폭발하지만 실제로 못 들어간다.
    if (slice.quoteVolume < MIN_QUOTE_VOLUME[EXCHANGE]) {
      this.#stats.rejectedTurnover += 1;
      return null;
    }

    return {
      timeframe: slice.timeframe,
      score,
      percentile,
      quoteVolume: slice.quoteVolume,
      velocity: slice.velocity,
      ratioToMedian: ratioToMedian(window, baseline),
    };
  }
}
