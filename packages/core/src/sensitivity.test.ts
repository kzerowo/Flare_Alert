import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_SCALE,
  FRAME_SCALE_PERCENTILE,
  RATIO_AT_SLIDER_MAX,
  RATIO_AT_SLIDER_MIN,
  RATIO_DEFAULT,
  SENSITIVITY_DEFAULT,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
  SCALE_RATE_CURVES,
  SENSITIVITY_SCALES,
  TIMEFRAMES,
} from "./constants.js";
import {
  DEFAULT_SENSITIVITY_LEVEL,
  SCALE_MAX,
  SCALE_MIN,
  SENSITIVITY_LEVEL_MAX,
  SENSITIVITY_LEVEL_MIN,
  SLIDER_MAX,
  SLIDER_MIN,
  levelForScale,
  sensitivityAt,
  estimateAlertsPerDay,
  describeAlertRate,
  isScaleTimeframe,
  percentileToScale,
  percentileToSlider,
  ratioToSlider,
  scaleAlertsPerDay,
  scaleAt,
  scaleIndexOf,
  scaleRatio,
  sliderToPercentile,
  sliderToRatio,
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

  it("기본값이 판정 배수 4배에 놓인다", () => {
    // 사용자가 15분봉 차트에 직접 표시한 기준이다. 근거는 constants.ts의
    // SENSITIVITY_DEFAULT 주석.
    const slider = percentileToSlider(SENSITIVITY_DEFAULT);
    assert.equal(Math.round(sliderToRatio(slider)), RATIO_DEFAULT);
  });
});

describe("sliderToRatio", () => {
  it("양 끝이 배수 범위와 맞는다", () => {
    assert.equal(sliderToRatio(SLIDER_MIN), RATIO_AT_SLIDER_MIN);
    assert.equal(sliderToRatio(SLIDER_MAX), RATIO_AT_SLIDER_MAX);
  });

  it("오른쪽으로 갈수록 배수가 낮아진다 (= 자주 울린다)", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let position = SLIDER_MIN; position <= SLIDER_MAX; position += 1) {
      const ratio = sliderToRatio(position);
      assert.ok(ratio < previous, `위치 ${position}에서 역전`);
      previous = ratio;
    }
  });

  it("왕복해도 위치가 유지된다", () => {
    for (let position = SLIDER_MIN; position <= SLIDER_MAX; position += 1) {
      assert.equal(
        ratioToSlider(sliderToRatio(position)),
        position,
        `위치 ${position}에서 어긋남`,
      );
    }
  });

  it("범위를 벗어난 배수도 안전하게 자른다", () => {
    assert.equal(ratioToSlider(999), SLIDER_MIN);
    assert.equal(ratioToSlider(0), SLIDER_MAX);
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
    // 1일봉급은 왼쪽 끝에 붙는다. 그 규모 사건은 하루 0.3회인데
    // 슬라이더가 도달 가능한 최저치가 0.64회라 더 왼쪽이 없다.
    for (const timeframe of TIMEFRAMES) {
      const position = percentileToSlider(FRAME_SCALE_PERCENTILE[timeframe]);
      assert.ok(
        position >= SLIDER_MIN && position < SLIDER_MAX,
        `${timeframe} → ${position}`,
      );
    }
  });

  // 눈금이 "그 봉 차트에서 눈에 띌 규모를 잡는다"는 뜻이던 시절의 검사는
  // 뺐다. 판정이 15분 창 하나로 고정되면서 그 의미가 사라졌다 — 이제
  // 슬라이더가 정하는 것은 규모가 아니라 배수다. FRAME_SCALE_PERCENTILE은
  // 아직 남아 있지만 판정에는 쓰이지 않는다.
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

describe("describeAlertRate", () => {
  it("빈도에 따라 표현을 바꾼다", () => {
    assert.deepEqual(describeAlertRate(0.05), { kind: "never" });
    assert.deepEqual(describeAlertRate(0.5), { kind: "everyNDays", days: 2 });
    assert.deepEqual(describeAlertRate(2.5), { kind: "perDay", value: "2.5" });
    assert.deepEqual(describeAlertRate(19), { kind: "perDay", value: "19" });
  });

  it("하루 1회 근처를 '1일에 1회'로 바꾸지 않는다", () => {
    assert.deepEqual(describeAlertRate(0.9), { kind: "perDay", value: "0.9" });
  });

  it("하루 1회 미만은 며칠에 한 번으로 읽어준다", () => {
    assert.deepEqual(describeAlertRate(0.33), { kind: "everyNDays", days: 3 });
  });

  it("10회를 넘으면 소수점을 버린다", () => {
    // 하루 23.4회라는 표기는 있지도 않은 정밀도를 주장한다.
    assert.deepEqual(describeAlertRate(23.4), { kind: "perDay", value: "23" });
  });
});

// ---------------------------------------------------------------------------
// 스케일 축 — 슬라이더가 봉 길이를 정한다
// ---------------------------------------------------------------------------

describe("스케일 축", () => {
  it("왼쪽이 조용하고 오른쪽이 잦다", () => {
    // 슬라이더의 방향이 뒤집히면 사용자가 조용히 두려다 30배 시끄러워진다.
    for (let i = 1; i <= SCALE_MAX; i += 1) {
      const previous = scaleAt(i - 1);
      const current = scaleAt(i);
      assert.ok(
        current.alertsPerDay > previous.alertsPerDay,
        `${previous.timeframe} → ${current.timeframe} 에서 빈도가 늘지 않았다`,
      );
    }
  });

  it("짧은 봉일수록 배수가 높다", () => {
    // 짧은 봉이 원래 더 튀므로, 같은 배수를 주면 1분봉만 시끄러워진다.
    for (let i = 1; i <= SCALE_MAX; i += 1) {
      assert.ok(scaleAt(i).ratio >= scaleAt(i - 1).ratio);
    }
  });

  it("1일봉은 슬라이더에 올라오지 않는다", () => {
    // 하루치 거래대금은 평소의 3배가 되는 일이 없다. 눈금으로 두면
    // 영영 울리지 않는 자리를 사용자에게 파는 셈이다.
    assert.equal(isScaleTimeframe("1d"), false);
    assert.ok(SENSITIVITY_SCALES.every((s) => s.timeframe !== "1d"));
  });

  it("위치와 봉 길이가 서로를 되돌린다", () => {
    for (const scale of SENSITIVITY_SCALES) {
      assert.equal(scaleAt(scaleIndexOf(scale.timeframe)).timeframe, scale.timeframe);
      assert.equal(scaleRatio(scale.timeframe), scale.ratio);
      assert.equal(scaleAlertsPerDay(scale.timeframe), scale.alertsPerDay);
    }
  });

  it("범위를 벗어난 위치도 안전하다", () => {
    assert.equal(scaleAt(-5).timeframe, scaleAt(SCALE_MIN).timeframe);
    assert.equal(scaleAt(99).timeframe, scaleAt(SCALE_MAX).timeframe);
  });

  it("모르는 봉은 기본 위치로 떨어진다", () => {
    // 1d를 저장한 옛 행이 남아 있어도 채널이 죽으면 안 된다.
    assert.equal(scaleAt(scaleIndexOf("1d")).timeframe, DEFAULT_SCALE);
  });
});

describe("percentileToScale", () => {
  it("기본 백분위가 기본 봉으로 옮겨진다", () => {
    // 옛 기본값(슬라이더 49)은 15분봉급 자리였다. 마이그레이션으로
    // 사용자 설정이 조용히 다른 곳으로 가면 안 된다.
    assert.equal(percentileToScale(SENSITIVITY_DEFAULT), DEFAULT_SCALE);
  });

  it("조용한 끝과 잦은 끝이 뒤집히지 않는다", () => {
    assert.equal(percentileToScale(SENSITIVITY_MAX), "4h");
    assert.equal(percentileToScale(SENSITIVITY_MIN), "1m");
  });

  it("경계값이 마이그레이션 SQL과 같다", () => {
    // supabase/migrations/0003_channel_scale.sql이 같은 경계를 박아 두었다.
    // 한쪽만 고치면 화면과 저장이 어긋난다.
    assert.equal(percentileToScale(99.9785), "4h");
    assert.equal(percentileToScale(99.9002), "1h");
    assert.equal(percentileToScale(99.536), "15m");
    assert.equal(percentileToScale(97.8454), "5m");
    assert.equal(percentileToScale(95), "1m");
  });
});

// ---------------------------------------------------------------------------
// 연속 민감도 축 (1~100)
// ---------------------------------------------------------------------------

describe("sensitivityAt", () => {
  it("구간 오른쪽 끝이 실측 앵커를 정확히 재현한다", () => {
    // 앵커는 측정으로 얻은 유일한 자리다. 여기가 어긋나면 슬라이더 전체가
    // 근거를 잃는다. 20/40/60/80/100이 그 자리다.
    for (const scale of SENSITIVITY_SCALES) {
      const setting = sensitivityAt(levelForScale(scale.timeframe));
      assert.equal(setting.timeframe, scale.timeframe);
      assert.equal(setting.ratio, scale.ratio);
    }
  });

  it("빈도가 슬라이더를 따라 단조 증가한다", () => {
    // 오른쪽으로 밀었는데 알림이 줄면 슬라이더가 거짓말을 하는 것이다.
    // 구간 경계에서 봉이 바뀌므로 여기가 특히 깨지기 쉽다.
    let previous = -Infinity;
    for (
      let level = SENSITIVITY_LEVEL_MIN;
      level <= SENSITIVITY_LEVEL_MAX;
      level += 1
    ) {
      const { alertsPerDay } = sensitivityAt(level);
      assert.ok(
        alertsPerDay >= previous - 1e-9,
        `level ${level}에서 빈도가 뒤로 갔다: ${previous} → ${alertsPerDay}`,
      );
      previous = alertsPerDay;
    }
  });

  it("한 구간 안에서 배수가 단조 감소한다", () => {
    // 같은 봉 안에서는 오른쪽으로 갈수록 문턱이 낮아져야 한다.
    let previousRatio = Infinity;
    let previousFrame = "";

    for (
      let level = SENSITIVITY_LEVEL_MIN;
      level <= SENSITIVITY_LEVEL_MAX;
      level += 1
    ) {
      const { ratio, timeframe } = sensitivityAt(level);
      if (timeframe === previousFrame) {
        assert.ok(
          ratio <= previousRatio + 1e-9,
          `level ${level}(${timeframe})에서 배수가 올라갔다`,
        );
      }
      previousRatio = ratio;
      previousFrame = timeframe;
    }
  });

  it("배수가 측정 구간 안에 머문다", () => {
    // 곡선은 배수 3.0 아래를 담지 않는다(교차 캐시 하한). 그 밖으로
    // 나가면 화면의 빈도가 측정되지 않은 추정치가 된다.
    for (
      let level = SENSITIVITY_LEVEL_MIN;
      level <= SENSITIVITY_LEVEL_MAX;
      level += 1
    ) {
      const { ratio, timeframe } = sensitivityAt(level);
      const curve = SCALE_RATE_CURVES[timeframe];
      assert.ok(curve !== undefined && curve.length > 0);

      const lowest = curve[0]?.[0] ?? 0;
      const highest = curve[curve.length - 1]?.[0] ?? 0;
      assert.ok(
        ratio >= lowest - 1e-9 && ratio <= highest + 1e-9,
        `level ${level}의 배수 ${ratio}가 ${timeframe} 측정 구간(${lowest}~${highest}) 밖이다`,
      );
    }
  });

  it("구간마다 봉이 하나씩, 조용한 쪽에서 잦은 쪽 순이다", () => {
    const order = SENSITIVITY_SCALES.map((scale) => scale.timeframe);
    const seen: string[] = [];

    for (
      let level = SENSITIVITY_LEVEL_MIN;
      level <= SENSITIVITY_LEVEL_MAX;
      level += 1
    ) {
      const { timeframe } = sensitivityAt(level);
      if (seen[seen.length - 1] !== timeframe) {
        seen.push(timeframe);
      }
    }

    assert.deepEqual(seen, order);
  });

  it("범위 밖은 양 끝으로 잘린다", () => {
    assert.equal(sensitivityAt(-10).level, SENSITIVITY_LEVEL_MIN);
    assert.equal(sensitivityAt(9999).level, SENSITIVITY_LEVEL_MAX);
    assert.equal(
      sensitivityAt(0).timeframe,
      sensitivityAt(SENSITIVITY_LEVEL_MIN).timeframe,
    );
  });

  it("기본값이 사용자 라벨로 검증된 15분봉 자리다", () => {
    const setting = sensitivityAt(DEFAULT_SENSITIVITY_LEVEL);
    assert.equal(setting.timeframe, DEFAULT_SCALE);
    assert.equal(setting.ratio, scaleRatio(DEFAULT_SCALE));
  });
});

describe("levelForScale", () => {
  it("봉 → 위치 → 봉이 그대로 돌아온다", () => {
    for (const scale of SENSITIVITY_SCALES) {
      assert.equal(
        sensitivityAt(levelForScale(scale.timeframe)).timeframe,
        scale.timeframe,
      );
    }
  });

  it("마이그레이션 0004가 쓰는 앵커와 같다", () => {
    // supabase/migrations/0004_channel_sensitivity_level.sql이 이 값을
    // 하드코딩한다. 한쪽만 고치면 저장된 설정의 뜻이 조용히 바뀐다.
    assert.equal(levelForScale("4h"), 20);
    assert.equal(levelForScale("1h"), 40);
    assert.equal(levelForScale("15m"), 60);
    assert.equal(levelForScale("5m"), 80);
    assert.equal(levelForScale("1m"), 100);
  });

  it("슬라이더에 없는 봉은 기본 위치로 간다", () => {
    assert.equal(levelForScale("1d"), DEFAULT_SENSITIVITY_LEVEL);
  });
});

describe("SCALE_RATE_CURVES", () => {
  it("슬라이더에 서는 다섯 봉을 모두 덮는다", () => {
    for (const scale of SENSITIVITY_SCALES) {
      const curve = SCALE_RATE_CURVES[scale.timeframe];
      assert.ok(
        curve !== undefined && curve.length > 0,
        `${scale.timeframe} 곡선이 없다`,
      );
    }
  });

  it("배수가 오름차순이고 빈도가 내림차순이다", () => {
    // 역으로 읽는 코드(ratioForRate)가 이 단조성을 전제한다.
    for (const scale of SENSITIVITY_SCALES) {
      const curve = SCALE_RATE_CURVES[scale.timeframe] ?? [];
      for (let i = 1; i < curve.length; i += 1) {
        const left = curve[i - 1];
        const right = curve[i];
        assert.ok(left !== undefined && right !== undefined);
        assert.ok(right[0] > left[0], `${scale.timeframe} 배수가 뒤집혔다`);
        assert.ok(right[1] <= left[1], `${scale.timeframe} 빈도가 뒤집혔다`);
      }
    }
  });

  it("앵커 배수에서 표의 실측 빈도가 나온다", () => {
    // 곡선과 SENSITIVITY_SCALES는 같은 백테스트에서 나온 값이다.
    // 서로 어긋나면 둘 중 하나가 낡은 것이다. 표는 반올림되어 있으므로
    // 10% 안쪽이면 같은 측정으로 본다.
    for (const scale of SENSITIVITY_SCALES) {
      const measured = sensitivityAt(
        levelForScale(scale.timeframe),
      ).alertsPerDay;
      const gap = Math.abs(measured - scale.alertsPerDay) / scale.alertsPerDay;
      assert.ok(
        gap < 0.1,
        `${scale.timeframe}: 표 ${scale.alertsPerDay}, 곡선 ${measured.toFixed(2)}`,
      );
    }
  });
});
