import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FRAME_STANDARD_PERCENTILE,
  SENSITIVITY_DEFAULT,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
  TIMEFRAMES,
} from "./constants.js";
import {
  SLIDER_MAX,
  SLIDER_MIN,
  formatTail,
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

  it("기본 민감도가 슬라이더 중앙 근처에 온다", () => {
    // 로그 축이라 0.01%~10% 구간에서 0.1%는 정확히 1/3 지점이다.
    const position = percentileToSlider(SENSITIVITY_DEFAULT);
    assert.equal(position, 34);
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

describe("프레임 표준 민감도", () => {
  it("모든 프레임에 값이 있다", () => {
    for (const timeframe of TIMEFRAMES) {
      assert.ok(FRAME_STANDARD_PERCENTILE[timeframe] > 0);
    }
  });

  it("짧은 프레임일수록 높은 임계가 필요하다", () => {
    // 1분봉은 같은 민감도에서 1일봉보다 훨씬 자주 울린다.
    // 그래서 같은 빈도를 내려면 임계가 더 높아야 한다.
    let previous = 100;
    for (const timeframe of TIMEFRAMES) {
      const percentile = FRAME_STANDARD_PERCENTILE[timeframe];
      assert.ok(percentile < previous, `${timeframe}에서 역전`);
      previous = percentile;
    }
  });

  it("전부 슬라이더 범위 안에 들어온다", () => {
    for (const timeframe of TIMEFRAMES) {
      const position = percentileToSlider(FRAME_STANDARD_PERCENTILE[timeframe]);
      assert.ok(position > SLIDER_MIN && position < SLIDER_MAX);
    }
  });
});

describe("formatTail", () => {
  it("자릿수에 따라 표현을 바꾼다", () => {
    assert.equal(formatTail(90), "상위 10%");
    assert.equal(formatTail(99), "상위 1%");
    assert.equal(formatTail(99.9), "상위 0.1%");
    assert.equal(formatTail(99.99), "상위 0.01%");
  });

  it("0.1%와 0.01%를 구분해서 보여준다", () => {
    // 실제로 10배 차이라 반올림해서 같아 보이면 안 된다.
    assert.notEqual(formatTail(99.9), formatTail(99.99));
  });
});
