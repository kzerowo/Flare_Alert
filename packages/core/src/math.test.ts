import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countAtOrBelow,
  countBelow,
  median,
  medianAbsoluteDeviation,
  percentileRank,
  quantileOfSorted,
  sortedCopy,
} from "./math.js";

describe("median", () => {
  it("홀수 개면 가운데 값", () => {
    assert.equal(median([3, 1, 2]), 2);
  });

  it("짝수 개면 가운데 두 값의 평균", () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });

  it("원본 배열을 변형하지 않는다", () => {
    const input = [3, 1, 2];
    median(input);
    assert.deepEqual(input, [3, 1, 2]);
  });

  it("빈 배열이면 던진다", () => {
    assert.throws(() => median([]));
  });

  it("극단값 하나가 기준선을 끌고 가지 않는다", () => {
    // 이게 평균 대신 중앙값을 쓰는 이유 전부다.
    const quiet = [10, 11, 9, 10, 12];
    const withSpike = [10, 11, 9, 10, 12, 100_000];

    assert.equal(median(quiet), 10);
    // 100_000이 들어와도 중앙값은 거의 그대로다.
    assert.equal(median(withSpike), 10.5);

    // 같은 입력에서 평균은 통째로 무너진다.
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    assert.ok(mean(withSpike) > 16_000);
  });
});

describe("medianAbsoluteDeviation", () => {
  it("편차의 중앙값을 낸다", () => {
    // 중앙값 3, 편차 [2,1,0,1,2] -> 중앙값 1
    assert.equal(medianAbsoluteDeviation([1, 2, 3, 4, 5]), 1);
  });

  it("center를 넘기면 그 값을 기준으로 쓴다", () => {
    assert.equal(medianAbsoluteDeviation([1, 2, 3, 4, 5], 5), 2);
  });

  it("모든 값이 같으면 0", () => {
    assert.equal(medianAbsoluteDeviation([7, 7, 7]), 0);
  });

  it("극단값에 표준편차보다 훨씬 덜 반응한다", () => {
    const base = [10, 10, 10, 10, 10, 11, 9, 10, 10, 10, 11];
    const spiked = [...base, 50_000];

    const madBefore = medianAbsoluteDeviation(base);
    const madAfter = medianAbsoluteDeviation(spiked);

    // MAD는 사실상 그대로다.
    assert.ok(madAfter - madBefore <= 1);

    const stdev = (xs: number[]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(
        xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / xs.length,
      );
    };

    // 표준편차는 4자리수로 뛴다.
    assert.ok(stdev(spiked) / Math.max(stdev(base), 1e-9) > 1000);
  });
});

describe("quantileOfSorted", () => {
  it("q=0.5는 중앙값과 같다", () => {
    const sorted = sortedCopy([5, 1, 4, 2, 3]);
    assert.equal(quantileOfSorted(sorted, 0.5), median(sorted));
  });

  it("양 끝은 최소/최대", () => {
    const sorted = [1, 2, 3, 4];
    assert.equal(quantileOfSorted(sorted, 0), 1);
    assert.equal(quantileOfSorted(sorted, 1), 4);
  });

  it("중간값은 선형 보간", () => {
    // position = 0.25 * 3 = 0.75 -> 1과 2 사이 0.75 지점
    assert.equal(quantileOfSorted([1, 2, 3, 4], 0.25), 1.75);
  });

  it("원소가 하나면 그 값", () => {
    assert.equal(quantileOfSorted([42], 0.9), 42);
  });

  it("범위를 벗어난 q는 던진다", () => {
    assert.throws(() => quantileOfSorted([1, 2], 1.5));
    assert.throws(() => quantileOfSorted([1, 2], -0.1));
  });
});

describe("countBelow / countAtOrBelow", () => {
  const sorted = [1, 2, 2, 2, 3];

  it("미만과 이하를 구분한다", () => {
    assert.equal(countBelow(sorted, 2), 1);
    assert.equal(countAtOrBelow(sorted, 2), 4);
  });

  it("모든 원소보다 작으면 0, 크면 길이", () => {
    assert.equal(countBelow(sorted, 0), 0);
    assert.equal(countAtOrBelow(sorted, 99), sorted.length);
  });
});

describe("percentileRank", () => {
  it("최소값 근처는 낮고 최대값 근처는 높다", () => {
    const sorted = sortedCopy([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.ok(percentileRank(sorted, 1) < 10);
    assert.ok(percentileRank(sorted, 10) > 90);
  });

  it("동일값이 많아도 한쪽으로 치우치지 않는다", () => {
    // 0이 90개, 나머지가 10개. 소형 종목에서 실제로 나오는 모양이다.
    const sorted = sortedCopy([
      ...Array<number>(90).fill(0),
      ...Array.from({ length: 10 }, (_, i) => i + 1),
    ]);

    const rank = percentileRank(sorted, 0);

    // "미만"만 쓰면 0, "이하"만 쓰면 90. 중간값이라야 45 근처다.
    assert.ok(rank > 40 && rank < 50, `실제: ${rank}`);
  });

  it("분포를 벗어난 큰 값은 100에 가깝다", () => {
    const sorted = sortedCopy([1, 2, 3, 4, 5]);
    assert.equal(percentileRank(sorted, 999), 100);
  });

  it("빈 분포는 던진다", () => {
    assert.throws(() => percentileRank([], 1));
  });
});
