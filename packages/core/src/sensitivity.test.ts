import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FRAME_SCALE_PERCENTILE,
  SENSITIVITY_DEFAULT,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
  TIMEFRAMES,
} from "./constants.js";
import {
  SLIDER_MAX,
  SLIDER_MIN,
  estimateAlertsPerDay,
  formatAlertsPerDay,
  percentileToSlider,
  sliderToPercentile,
} from "./sensitivity.js";

describe("sliderToPercentile", () => {
  it("양 끝이 민감도 범위와 맞는다", () => {
    assert.equal(sliderToPercentile(SLIDER_MIN), SENSITIVITY_MAX);
    assert.equal(sliderToPercentile(SLIDER_MAX), SENSITIVITY_MIN);
  });

  it("오른쪽으로 갈수록 임계가 낮아진다 (= 자주 울린다)", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let position = SLIDER_MIN; position <= SLIDER_MAX; position += 1) {
      const percentile = sliderToPercentile(position);
      assert.ok(percentile < previous, `위치 ${position}에서 역전`);
      previous = percentile;
    }
  });

  it("범위를 벗어난 위치는 양 끝으로 자른다", () => {
    assert.equal(sliderToPercentile(-50), SENSITIVITY_MAX);
    assert.equal(sliderToPercentile(9999), SENSITIVITY_MIN);
  });

  it("기본값이 15분봉급 눈금에 놓인다", () => {
    assert.equal(
      percentileToSlider(SENSITIVITY_DEFAULT),
      percentileToSlider(FRAME_SCALE_PERCENTILE["15m"]),
    );
  });
});

describe("percentileToSlider", () => {
  it("왕복해도 위치가 유지된다", () => {
    for (let position = SLIDER_MIN; position <= SLIDER_MAX; position += 1) {
      const roundTrip = percentileToSlider(sliderToPercentile(position));
      assert.equal(roundTrip, position, `위치 ${position}에서 어긋남`);
    }
  });

  it("범위를 벗어난 백분위도 안전하게 자른다", () => {
    assert.equal(percentileToSlider(100), SLIDER_MIN);
    assert.equal(percentileToSlider(0), SLIDER_MAX);
  });
});

describe("사건 규모 눈금", () => {
  it("모든 프레임에 값이 있다", () => {
    for (const timeframe of TIMEFRAMES) {
      assert.ok(FRAME_SCALE_PERCENTILE[timeframe] > 0);
    }
  });

  it("규모가 클수록 낮은 민감도로도 잡힌다", () => {
    // 크고 오래 가는 급등은 여러 프레임을 동시에 흔들어 신호가 강하다.
    // 그래서 더 엄격한 임계(높은 백분위)에서도 통과한다.
    let previous = 0;
    for (const timeframe of TIMEFRAMES) {
      const percentile = FRAME_SCALE_PERCENTILE[timeframe];
      assert.ok(percentile > previous, `${timeframe}에서 역전`);
      previous = percentile;
    }
  });

  it("1분봉급이 가장 오른쪽, 1일봉급이 가장 왼쪽에 온다", () => {
    // 사용자가 기대하는 방향이다. 짧은 급등일수록 민감해야 잡힌다.
    const shortest = percentileToSlider(FRAME_SCALE_PERCENTILE["1m"]);
    const longest = percentileToSlider(FRAME_SCALE_PERCENTILE["1d"]);

    assert.ok(shortest > longest, `1m ${shortest} vs 1d ${longest}`);

    let previous = SLIDER_MAX + 1;
    for (const timeframe of TIMEFRAMES) {
      const position = percentileToSlider(FRAME_SCALE_PERCENTILE[timeframe]);
      assert.ok(position < previous, `${timeframe} 위치가 역전`);
      previous = position;
    }
  });

  it("전부 슬라이더 범위 안에 들어온다", () => {
    for (const timeframe of TIMEFRAMES) {
      const position = percentileToSlider(FRAME_SCALE_PERCENTILE[timeframe]);
      assert.ok(position > SLIDER_MIN && position < SLIDER_MAX);
    }
  });
});

describe("estimateAlertsPerDay", () => {
  it("오른쪽으로 갈수록 자주 울린다", () => {
    let previous = -1;
    for (let position = SLIDER_MIN; position <= SLIDER_MAX; position += 1) {
      const rate = estimateAlertsPerDay(position);
      assert.ok(rate >= previous, `위치 ${position}에서 역전`);
      previous = rate;
    }
  });

  it("짧은 규모 눈금일수록 알림이 많다", () => {
    // 눈금과 곡선이 어긋나면 여기서 잡힌다.
    const atShortest = estimateAlertsPerDay(
      percentileToSlider(FRAME_SCALE_PERCENTILE["1m"]),
    );
    const atLongest = estimateAlertsPerDay(
      percentileToSlider(FRAME_SCALE_PERCENTILE["1d"]),
    );

    assert.ok(atShortest > atLongest * 3, `${atShortest} vs ${atLongest}`);
  });

  it("가장 왼쪽에서도 완전히 침묵하지는 않는다", () => {
    // 하루 0회면 슬라이더 왼쪽 끝이 쓸모없는 구간이 된다.
    assert.ok(estimateAlertsPerDay(SLIDER_MIN) > 0.5);
  });

  it("범위를 벗어난 위치도 안전하다", () => {
    assert.ok(estimateAlertsPerDay(-10) > 0);
    assert.ok(estimateAlertsPerDay(500) > 0);
  });
});

describe("formatAlertsPerDay", () => {
  it("빈도에 따라 표현을 바꾼다", () => {
    assert.equal(formatAlertsPerDay(0.05), "거의 안 울림");
    assert.equal(formatAlertsPerDay(0.5), "2일에 1회");
    assert.equal(formatAlertsPerDay(2.5), "하루 2.5회");
    assert.equal(formatAlertsPerDay(19), "하루 19회");
  });

  it("하루 1회 근처를 '1일에 1회'로 바꾸지 않는다", () => {
    assert.equal(formatAlertsPerDay(0.9), "하루 0.9회");
  });

  it("하루 1회 미만은 며칠에 한 번으로 읽어준다", () => {
    assert.equal(formatAlertsPerDay(0.33), "3일에 1회");
  });
});
