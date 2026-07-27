// 통계 기본 함수들.
// 전부 순수 함수다. 상태를 갖지 않으므로 백테스트와 실시간에서 같은 코드가 돈다.

/**
 * 배열 인덱스 접근 헬퍼.
 * noUncheckedIndexedAccess 때문에 매번 undefined 검사가 필요한데,
 * 여기서 한 번만 하고 나머지 코드는 깨끗하게 유지한다.
 */
function at(values: readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) {
    throw new RangeError(`인덱스 범위를 벗어났습니다: ${index}`);
  }
  return value;
}

/** 오름차순 정렬된 복사본을 만든다. 원본은 건드리지 않는다. */
export function sortedCopy(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/** 이미 정렬된 배열의 중앙값. */
export function medianOfSorted(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n === 0) {
    throw new Error("빈 배열의 중앙값은 정의되지 않습니다");
  }

  const mid = n >> 1;

  if (n % 2 === 1) {
    return at(sorted, mid);
  }
  return (at(sorted, mid - 1) + at(sorted, mid)) / 2;
}

/** 중앙값. 입력 순서는 상관없다. */
export function median(values: readonly number[]): number {
  return medianOfSorted(sortedCopy(values));
}

/**
 * MAD (median absolute deviation).
 * center를 넘기지 않으면 values의 중앙값을 쓴다.
 *
 * 표준편차와 달리 편차를 제곱하지 않으므로 극단값 하나가 결과를 부풀리지 않는다.
 * 거래량처럼 오른쪽으로 심하게 치우친 분포에서 이 차이가 결정적이다.
 */
export function medianAbsoluteDeviation(
  values: readonly number[],
  center?: number,
): number {
  if (values.length === 0) {
    throw new Error("빈 배열의 MAD는 정의되지 않습니다");
  }

  let m: number;
  if (center === undefined) {
    m = median(values);
  } else {
    m = center;
  }

  const deviations = values.map((v) => Math.abs(v - m));
  return median(deviations);
}

/**
 * 정렬된 배열의 q분위수 (q는 0~1). 선형 보간을 쓴다.
 * q=0.5면 중앙값과 같은 값이 나온다.
 */
export function quantileOfSorted(sorted: readonly number[], q: number): number {
  const n = sorted.length;
  if (n === 0) {
    throw new Error("빈 배열의 분위수는 정의되지 않습니다");
  }
  if (q < 0 || q > 1 || Number.isNaN(q)) {
    throw new RangeError(`q는 0과 1 사이여야 합니다: ${q}`);
  }

  if (n === 1) {
    return at(sorted, 0);
  }

  const position = q * (n - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  if (lower === upper) {
    return at(sorted, lower);
  }

  const weight = position - lower;
  return at(sorted, lower) * (1 - weight) + at(sorted, upper) * weight;
}

/**
 * 정렬된 배열에서 value 미만인 원소의 개수.
 * 이진 탐색이므로 표본이 커져도 비용이 거의 늘지 않는다.
 */
export function countBelow(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (at(sorted, mid) < value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

/**
 * 정렬된 배열에서 value 이하인 원소의 개수.
 */
export function countAtOrBelow(
  sorted: readonly number[],
  value: number,
): number {
  let low = 0;
  let high = sorted.length;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (at(sorted, mid) <= value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

/**
 * value가 분포에서 차지하는 백분위 (0~100).
 *
 * 동일값이 여러 개일 때 "미만"과 "이하" 중 하나만 쓰면 백분위가 한쪽으로
 * 치우친다. 두 값의 중간을 쓰는 방식(mid-rank)으로 보정한다.
 * 거래가 거의 없어 v=0인 창이 무더기로 쌓이는 소형 종목에서 실제로 문제가 된다.
 */
export function percentileRank(
  sorted: readonly number[],
  value: number,
): number {
  const n = sorted.length;
  if (n === 0) {
    throw new Error("빈 분포에서는 백분위를 구할 수 없습니다");
  }

  const below = countBelow(sorted, value);
  const atOrBelow = countAtOrBelow(sorted, value);
  const midRank = (below + atOrBelow) / 2;

  return (midRank / n) * 100;
}
