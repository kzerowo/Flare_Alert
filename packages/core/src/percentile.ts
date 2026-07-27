import {
  MIN_PERCENTILE_SAMPLES,
  PERCENTILE_HISTORY_DAYS,
} from "./constants.js";
import type { PercentileEstimator, SeriesKey } from "./types.js";

// ---------------------------------------------------------------------------
// 히스토그램 설계
//
// S를 그대로 선형 구간에 담으면 안 된다. 분포가 오른쪽으로 심하게 치우쳐서
// 대부분의 표본이 0 근처 몇 개 구간에 뭉치고, 정작 우리가 신경 쓰는
// 상위 1~5% 구간은 해상도가 거의 없는 채로 뭉뚱그려진다.
//
// asinh(S)를 구간 축으로 쓴다. 0 근처에서는 선형처럼 동작하고 꼬리로 갈수록
// 로그처럼 압축된다. 음수도 그대로 받으므로 v < M 인 구간을 따로 처리할
// 필요가 없다. (log는 음수를 못 받아 오프셋이 필요하다.)
//
// asinh(-27) ≈ -4.0, asinh(1490) ≈ 8.0 이므로 아래 범위면 실전에서
// 넘칠 일이 거의 없고, 넘치더라도 언더/오버플로 구간에 안전하게 쌓인다.
// ---------------------------------------------------------------------------

const AXIS_MIN = -4;
const AXIS_MAX = 8;
const BIN_WIDTH = 0.01;
const BIN_COUNT = Math.round((AXIS_MAX - AXIS_MIN) / BIN_WIDTH);

const MS_PER_DAY = 86_400_000;

/** S를 구간 인덱스로. 범위를 벗어나면 양 끝 구간에 몰아넣는다. */
function toBinIndex(score: number): number {
  const axis = Math.asinh(score);

  if (axis <= AXIS_MIN) {
    return 0;
  }
  if (axis >= AXIS_MAX) {
    return BIN_COUNT - 1;
  }

  return Math.floor((axis - AXIS_MIN) / BIN_WIDTH);
}

function serializeKey(key: SeriesKey): string {
  return `${key.exchange}:${key.symbol}:${key.timeframe}`;
}

/**
 * 펜윅 트리 (Binary Indexed Tree).
 *
 * 백분위를 구하려면 "특정 구간보다 아래에 표본이 몇 개인가"를 알아야 한다.
 * 구간을 처음부터 훑으면 조회 한 번에 최대 1200번 덧셈이 필요한데,
 * 리플레이는 이 조회를 억 단위로 한다. 펜윅 트리면 갱신도 조회도
 * log(1200) ≈ 11번이면 끝난다.
 */
class FenwickTree {
  readonly #tree: Float64Array;
  readonly #size: number;

  constructor(size: number) {
    this.#size = size;
    this.#tree = new Float64Array(size + 1);
  }

  add(index: number, delta: number): void {
    let i = index + 1;
    while (i <= this.#size) {
      this.#tree[i] = (this.#tree[i] ?? 0) + delta;
      i += i & -i;
    }
  }

  /** [0, index] 구간의 합. index가 음수면 0. */
  prefixSum(index: number): number {
    let i = index + 1;
    let sum = 0;
    while (i > 0) {
      sum += this.#tree[i] ?? 0;
      i -= i & -i;
    }
    return sum;
  }
}

/** 하루치 히스토그램. 날짜 단위로 통째로 버리기 위해 나눠 담는다. */
interface DailyHistogram {
  dayIndex: number;
  counts: Uint32Array;
  total: number;
}

interface SeriesState {
  days: DailyHistogram[];
  tree: FenwickTree;
  total: number;
}

/**
 * 심볼·프레임별 과거 S 분포에서 백분위를 추정한다.
 *
 * 모든 표본을 배열로 들고 있으면 정확하지만, detector는 1초마다 심볼 수 ×
 * 프레임 수만큼 관측을 만들어낸다. 14일이면 키 하나당 백만 단위가 되어
 * 메모리로 감당이 안 된다. 고정 구간 히스토그램은 키 하나당 크기가
 * 일정하고, 백분위 추정에 필요한 정밀도는 충분히 나온다.
 *
 * 오래된 표본은 하루 단위로 버린다. 항상 최근 historyDays 일치만 유지한다.
 */
export class HistogramPercentileEstimator implements PercentileEstimator {
  readonly #series = new Map<string, SeriesState>();
  readonly #historyDays: number;
  readonly #minSamples: number;

  constructor(options: { historyDays?: number; minSamples?: number } = {}) {
    this.#historyDays = options.historyDays ?? PERCENTILE_HISTORY_DAYS;
    this.#minSamples = options.minSamples ?? MIN_PERCENTILE_SAMPLES;
  }

  observe(key: SeriesKey, score: number, atMs: number): void {
    if (!Number.isFinite(score)) {
      return;
    }

    const state = this.#stateFor(key);
    const dayIndex = Math.floor(atMs / MS_PER_DAY);
    const day = this.#dayFor(state, dayIndex);
    const bin = toBinIndex(score);

    day.counts[bin] = (day.counts[bin] ?? 0) + 1;
    day.total += 1;

    state.tree.add(bin, 1);
    state.total += 1;
  }

  toPercentile(key: SeriesKey, score: number): number | null {
    if (!Number.isFinite(score)) {
      return null;
    }

    const state = this.#series.get(serializeKey(key));
    if (state === undefined || state.total < this.#minSamples) {
      return null;
    }

    const targetBin = toBinIndex(score);

    const below = state.tree.prefixSum(targetBin - 1);
    const atOrBelow = state.tree.prefixSum(targetBin);

    // 같은 구간 안에서는 균등 분포로 보고 절반만 아래쪽으로 친다.
    // 구간 경계 때문에 백분위가 계단식으로 튀는 것을 완화한다.
    const midRank = (below + atOrBelow) / 2;

    return (midRank / state.total) * 100;
  }

  /** 해당 시리즈에 현재 쌓인 총 표본 수. 진단과 테스트용. */
  sampleCount(key: SeriesKey): number {
    return this.#series.get(serializeKey(key))?.total ?? 0;
  }

  #stateFor(key: SeriesKey): SeriesState {
    const id = serializeKey(key);
    const existing = this.#series.get(id);
    if (existing !== undefined) {
      return existing;
    }

    const created: SeriesState = {
      days: [],
      tree: new FenwickTree(BIN_COUNT),
      total: 0,
    };
    this.#series.set(id, created);
    return created;
  }

  #dayFor(state: SeriesState, dayIndex: number): DailyHistogram {
    // 대부분의 호출은 가장 최근 날짜에 들어온다. 뒤에서부터 찾는다.
    for (let i = state.days.length - 1; i >= 0; i -= 1) {
      const day = state.days[i];
      if (day !== undefined && day.dayIndex === dayIndex) {
        return day;
      }
    }

    const created: DailyHistogram = {
      dayIndex,
      counts: new Uint32Array(BIN_COUNT),
      total: 0,
    };
    state.days.push(created);

    this.#pruneOldDays(state, dayIndex);

    return created;
  }

  /**
   * 보관 기간을 벗어난 날짜를 버린다.
   *
   * 기준은 "지금까지 본 가장 큰 dayIndex"다. 백테스트에서 과거 데이터를
   * 순서대로 흘릴 때도 실시간과 같은 방식으로 동작해야 하므로,
   * 시스템 시각이 아니라 데이터의 시각을 쓴다.
   */
  #pruneOldDays(state: SeriesState, newestDayIndex: number): void {
    const cutoff = newestDayIndex - this.#historyDays + 1;

    const kept: DailyHistogram[] = [];
    for (const day of state.days) {
      if (day.dayIndex >= cutoff) {
        kept.push(day);
        continue;
      }

      // 버리는 날짜의 표본을 집계에서도 빼준다.
      for (let bin = 0; bin < BIN_COUNT; bin += 1) {
        const count = day.counts[bin] ?? 0;
        if (count > 0) {
          state.tree.add(bin, -count);
        }
      }
      state.total -= day.total;
    }

    state.days = kept;
  }
}

/** 테스트와 진단에서 구간 설계를 확인할 때 쓴다. */
export const PERCENTILE_HISTOGRAM_INTERNALS = {
  AXIS_MIN,
  AXIS_MAX,
  BIN_WIDTH,
  BIN_COUNT,
  toBinIndex,
} as const;
