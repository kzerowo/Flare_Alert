import {
  CHANNEL_RATE_CURVE,
  DEFAULT_SCALE,
  FRAME_RATE_CURVE_POSITIONS,
  RATIO_AT_SLIDER_MAX,
  RATIO_AT_SLIDER_MIN,
  SCALE_RATE_CURVES,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
  SENSITIVITY_RATE_FLOOR,
  SENSITIVITY_SCALES,
} from "./constants.js";
import type { SensitivityScale } from "./constants.js";
import type { Sensitivity, Timeframe } from "./types.js";

// ---------------------------------------------------------------------------
// 슬라이더 위치와 백분위 임계의 변환
//
// 알고리즘은 백분위로 계산한다. 하지만 백분위를 그대로 슬라이더에 올리면
// 방향이 직관과 반대가 된다. 값이 클수록(99.9) 더 드문 사건만 통과하므로
// 알림이 줄어드는데, "민감도가 높다"는 말은 자주 울린다는 뜻으로 읽힌다.
//
// 그래서 UI는 1~100 정수 위치를 쓰고, 오른쪽으로 갈수록 자주 울린다.
// 변환은 이 파일에서만 한다. core의 나머지와 detector는 백분위만 다룬다.
//
// 축은 로그다. 유효 구간의 꼬리 비율이 0.01%에서 10%까지 세 자릿수를
// 가로지르기 때문에, 선형으로 나누면 한쪽 끝이 통째로 뭉개진다.
// ---------------------------------------------------------------------------

export const SLIDER_MIN = 1;
export const SLIDER_MAX = 100;

// ---------------------------------------------------------------------------
// 스케일 축 — 지금 쓰는 민감도 축
//
// 슬라이더가 정하는 것은 "어느 길이의 봉으로 보는가"다. 배수는 거기서
// 따라 나온다. 아래 백분위·배수 변환은 옛 축이고, 저장된 값을 옮기는
// 경로와 백테스트 비교에만 남아 있다.
// ---------------------------------------------------------------------------

/** 스케일 슬라이더의 양 끝. 0이 가장 조용하고 커질수록 잦다. */
export const SCALE_MIN = 0;
export const SCALE_MAX = SENSITIVITY_SCALES.length - 1;

// ---------------------------------------------------------------------------
// 연속 민감도 축 (1~100)
//
// 다섯 칸은 너무 성겼다. 4.2회/일에서 10회/일로 한 칸에 2.4배가 뛰는데,
// 그 사이를 원하는 사용자가 갈 곳이 없었다.
//
// 그래서 슬라이더를 1~100으로 열되, 봉 길이는 여전히 다섯 개 중 하나로
// 붙인다. 집계기가 종목당 여섯 프레임만 계산하고 판정이 그 중 하나를
// 정확히 찾아 쓰기 때문이다(decisions.md 10번의 "비싼 계산은 종목당 한 번").
// 임의 길이 창을 허용하면 그 공유 구조가 깨진다.
//
// 대신 배수가 연속으로 움직인다. 알림 빈도를 실제로 정하는 것은 배수이므로,
// 사용자가 보는 값(하루 몇 회)은 슬라이더 전 구간에서 연속이다.
//
// 구간은 20칸씩 다섯 개다.
//
//   1~20   4h    21~40  1h    41~60  15m    61~80  5m    81~100  1m
//
// 각 구간의 오른쪽 끝(20/40/60/80/100)이 SENSITIVITY_SCALES의 실측 앵커다.
// 즉 옛 다섯 칸은 그대로 도달 가능한 자리로 남고, 나머지가 채워진 것이다.
//
// 구간 안에서 배수는 앵커 배수까지만 내려간다. 앵커 배수가 그 봉에서
// 검증된 가장 느슨한 값이고, 그 아래는 측정 구간(배수 3.0 이상) 밖으로
// 나가기 때문이다. 더 조용하게 가려면 배수를 올린다 — 늘 측정 안쪽이다.
// ---------------------------------------------------------------------------

/** 연속 민감도 슬라이더의 양 끝. 작을수록 조용하다. */
export const SENSITIVITY_LEVEL_MIN = 1;
export const SENSITIVITY_LEVEL_MAX = 100;

/** 한 봉이 차지하는 슬라이더 칸 수. */
const LEVELS_PER_BAND =
  (SENSITIVITY_LEVEL_MAX - SENSITIVITY_LEVEL_MIN + 1) /
  SENSITIVITY_SCALES.length;

/**
 * 기본 민감도. 15분봉 앵커 자리다.
 *
 * 사용자가 15분봉 차트에 직접 표시한 기준이 여기고, 라벨로 채점하면
 * 재현율 64% · 정밀도 74%가 나온다. 연속 축으로 바뀌어도 기본값은
 * 그 검증된 자리를 그대로 가리켜야 한다.
 */
export const DEFAULT_SENSITIVITY_LEVEL = 60;

/** 슬라이더 한 자리가 뜻하는 설정 전부. */
export interface SensitivitySetting {
  /** 슬라이더 위치 (1~100) */
  level: number;
  /** 판정에 쓰는 창 길이. 규모 라벨의 최소값이기도 하다. */
  timeframe: Timeframe;
  /** 그 창의 거래대금이 직전 창들 중앙값의 몇 배면 알리는가 */
  ratio: number;
  /** 대형주 코인 1개당 하루 알림 수. 실측 곡선에서 읽는다. */
  alertsPerDay: number;
}

/**
 * 측정 곡선에서 배수 → 빈도를 읽는다. 로그-로그 보간이다.
 *
 * 양 축 모두 자릿수를 가로지른다(배수 3~23, 빈도 0.005~124). 선형으로
 * 보간하면 왼쪽 끝이 통째로 뭉개진다.
 */
function rateAtRatio(timeframe: Timeframe, ratio: number): number {
  const curve = SCALE_RATE_CURVES[timeframe];
  if (curve === undefined || curve.length === 0) {
    return 0;
  }

  const first = curve[0];
  const last = curve[curve.length - 1];
  if (first === undefined || last === undefined) {
    return 0;
  }

  // 측정 구간 밖은 가장 가까운 끝값으로 둔다. 곡선을 연장해 추정하면
  // 화면의 숫자가 측정 근거를 잃는다.
  if (ratio <= first[0]) {
    return first[1];
  }
  if (ratio >= last[0]) {
    return last[1];
  }

  for (let i = 1; i < curve.length; i += 1) {
    const right = curve[i];
    const left = curve[i - 1];
    if (right === undefined || left === undefined) {
      break;
    }
    if (ratio > right[0]) {
      continue;
    }

    // 빈도 0은 로그를 못 취한다. 그 구간은 선형으로 잇는다.
    if (left[1] <= 0 || right[1] <= 0) {
      const span = right[0] - left[0];
      const weight = span === 0 ? 0 : (ratio - left[0]) / span;
      return left[1] + (right[1] - left[1]) * weight;
    }

    const t =
      Math.log(ratio / left[0]) / Math.log(right[0] / left[0]);
    return Math.exp(
      Math.log(left[1]) + t * (Math.log(right[1]) - Math.log(left[1])),
    );
  }

  return last[1];
}

/** 곡선을 거꾸로 읽는다. 목표 빈도를 내는 배수를 찾는다. */
function ratioForRate(timeframe: Timeframe, perDay: number): number {
  const curve = SCALE_RATE_CURVES[timeframe];
  if (curve === undefined || curve.length === 0) {
    return SENSITIVITY_SCALES[0]?.ratio ?? 3;
  }

  const first = curve[0];
  const last = curve[curve.length - 1];
  if (first === undefined || last === undefined) {
    return 3;
  }

  // 곡선은 빈도가 내림차순이다(배수가 커질수록 조용해진다).
  if (perDay >= first[1]) {
    return first[0];
  }
  if (perDay <= last[1]) {
    return last[0];
  }

  for (let i = 1; i < curve.length; i += 1) {
    const right = curve[i];
    const left = curve[i - 1];
    if (right === undefined || left === undefined) {
      break;
    }
    if (perDay < right[1]) {
      continue;
    }

    if (left[1] <= 0 || right[1] <= 0) {
      const span = right[1] - left[1];
      const weight = span === 0 ? 0 : (perDay - left[1]) / span;
      return left[0] + (right[0] - left[0]) * weight;
    }

    const t =
      Math.log(perDay / left[1]) / Math.log(right[1] / left[1]);
    return Math.exp(
      Math.log(left[0]) + t * (Math.log(right[0]) - Math.log(left[0])),
    );
  }

  return last[0];
}

/**
 * 구간의 왼쪽 끝(가장 조용한 자리)에서 쓸 배수.
 *
 * 그 봉으로 "바로 앞 앵커의 빈도"를 내는 배수다. 이렇게 잡아야 구간을
 * 넘을 때 봉이 바뀌어도 빈도가 이어진다 — 사용자가 보는 값은 빈도이므로
 * 거기가 끊기면 안 된다. 배수는 그 자리에서 뛰지만 내부 값이다.
 *
 * 가장 조용한 구간(4h)에는 앞 앵커가 없어서 SENSITIVITY_RATE_FLOOR를 쓴다.
 */
function bandQuietRatio(bandIndex: number): number {
  const scale = SENSITIVITY_SCALES[bandIndex];
  if (scale === undefined) {
    return 3;
  }

  const previous = SENSITIVITY_SCALES[bandIndex - 1];

  // 앞 앵커의 빈도는 표에 적힌 반올림값이 아니라 곡선에서 읽은 값을 쓴다.
  // 표의 1.0과 곡선의 1.04처럼 조금만 어긋나도 구간 경계에서 빈도가
  // 뒤로 밀린다 — 슬라이더를 오른쪽으로 밀었는데 알림이 줄어 보인다.
  const target =
    previous === undefined
      ? SENSITIVITY_RATE_FLOOR
      : rateAtRatio(previous.timeframe, previous.ratio);

  const exact = ratioForRate(scale.timeframe, target);

  // 소수 둘째 자리에서 "내림"한다. 반올림하면 배수가 커질 수 있고, 배수가
  // 커지면 빈도가 앞 구간 끝보다 낮아져 슬라이더를 오른쪽으로 밀었는데
  // 알림이 줄어드는 자리가 생긴다. 내림은 늘 빈도를 같거나 높게 만든다.
  //
  // 자리수를 맞춰 두는 이유는 sensitivityAt이 최종 배수를 둘째 자리로
  // 반올림하기 때문이다. 여기서 미리 맞춰 두면 구간 시작점(t=0)에서
  // 그 반올림이 값을 건드리지 않는다.
  return Math.floor(exact * 100) / 100;
}

/** 슬라이더 위치 → 그 자리의 봉·배수·예상 빈도. */
export function sensitivityAt(level: number): SensitivitySetting {
  const clamped = Math.round(
    clamp(level, SENSITIVITY_LEVEL_MIN, SENSITIVITY_LEVEL_MAX),
  );

  const bandIndex = clamp(
    Math.floor((clamped - SENSITIVITY_LEVEL_MIN) / LEVELS_PER_BAND),
    0,
    SENSITIVITY_SCALES.length - 1,
  );

  const scale = SENSITIVITY_SCALES[bandIndex];
  if (scale === undefined) {
    throw new Error("민감도 스케일 표가 비어 있습니다");
  }

  const bandStart = SENSITIVITY_LEVEL_MIN + bandIndex * LEVELS_PER_BAND;
  // 구간의 마지막 칸에서 t = 1이 되어 앵커 배수와 정확히 맞아야 한다.
  const t = (clamped - bandStart) / (LEVELS_PER_BAND - 1);

  const quiet = bandQuietRatio(bandIndex);
  const loud = scale.ratio;

  // 로그 보간이다. 3배와 4배의 차이는 크고 16배와 17배는 거의 같다.
  const ratio =
    quiet <= 0 || loud <= 0
      ? loud
      : quiet * (loud / quiet) ** clamp(t, 0, 1);

  const rounded = Math.round(ratio * 100) / 100;

  return {
    level: clamped,
    timeframe: scale.timeframe,
    ratio: rounded,
    alertsPerDay: rateAtRatio(scale.timeframe, rounded),
  };
}

/**
 * 봉 길이 → 그 봉의 앵커 위치.
 *
 * 옛 다섯 칸 설정(channels.scale)을 연속 축으로 옮기는 경로다. 앵커는
 * 구간의 오른쪽 끝이므로 실측값이 그대로 재현된다.
 */
export function levelForScale(timeframe: Timeframe): number {
  const index = SENSITIVITY_SCALES.findIndex(
    (scale) => scale.timeframe === timeframe,
  );
  if (index < 0) {
    return DEFAULT_SENSITIVITY_LEVEL;
  }
  return SENSITIVITY_LEVEL_MIN + (index + 1) * LEVELS_PER_BAND - 1;
}

/** 위치(0~4) → 그 자리의 봉 길이·배수·예상 빈도. */
export function scaleAt(position: number): SensitivityScale {
  const index = Math.round(clamp(position, SCALE_MIN, SCALE_MAX));
  // 상수 배열이 비어 있을 수 없지만 인덱스 접근은 타입상 undefined다.
  const scale = SENSITIVITY_SCALES[index] ?? SENSITIVITY_SCALES[2];
  if (scale === undefined) {
    throw new Error("민감도 스케일 표가 비어 있습니다");
  }
  return scale;
}

/** 봉 길이 → 슬라이더 위치. 목록에 없으면 기본 위치. */
export function scaleIndexOf(timeframe: Timeframe): number {
  const index = SENSITIVITY_SCALES.findIndex(
    (scale) => scale.timeframe === timeframe,
  );
  if (index >= 0) {
    return index;
  }
  return scaleIndexOf(DEFAULT_SCALE);
}

/** 이 봉 길이에서 판정에 쓰는 배수. */
export function scaleRatio(timeframe: Timeframe): number {
  return scaleAt(scaleIndexOf(timeframe)).ratio;
}

/** 이 봉 길이에서 코인 1개당 하루 몇 번 울리는지. 대형주 실측값이다. */
export function scaleAlertsPerDay(timeframe: Timeframe): number {
  return scaleAt(scaleIndexOf(timeframe)).alertsPerDay;
}

/** 슬라이더에 올릴 수 있는 봉인가. 1일봉은 아니다. */
export function isScaleTimeframe(value: string): value is Timeframe {
  return SENSITIVITY_SCALES.some((scale) => scale.timeframe === value);
}

/**
 * 옛 백분위 설정을 스케일로 옮긴다.
 *
 * 저장된 값은 백분위였고, 슬라이더 1~100 위에서 로그 축으로 해석됐다.
 * 그 위치를 다섯 구간으로 나눠 봉에 대응시킨다. 사용자가 맞춰 둔 상대적
 * 위치(조용한 쪽인지 잦은 쪽인지)는 그대로 유지된다.
 *
 * 마이그레이션 SQL(0003)이 같은 경계를 쓴다. 한쪽만 고치면 화면과 저장이
 * 어긋나므로 함께 고쳐야 한다.
 */
export function percentileToScale(percentile: Sensitivity): Timeframe {
  const position = percentileToSlider(percentile);
  const band = Math.min(4, Math.floor((position - 1) / 20));
  return scaleAt(band).timeframe;
}

/** 슬라이더 양 끝에 대응하는 꼬리 비율(%). 왼쪽이 조용하다. */
const TAIL_AT_MIN = 100 - SENSITIVITY_MAX; // 0.01%
const TAIL_AT_MAX = 100 - SENSITIVITY_MIN; // 10%

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

/**
 * 슬라이더 위치(1~100) → 백분위 임계.
 * 위치가 커질수록 임계가 낮아지고 알림이 잦아진다.
 */
export function sliderToPercentile(position: number): Sensitivity {
  const clamped = clamp(position, SLIDER_MIN, SLIDER_MAX);
  const ratio = (clamped - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN);

  const tail = TAIL_AT_MIN * (TAIL_AT_MAX / TAIL_AT_MIN) ** ratio;

  // 부동소수 오차로 99.99000000001 같은 값이 나오지 않게 자른다.
  return Math.round((100 - tail) * 10_000) / 10_000;
}

/**
 * 슬라이더 위치(1~100) → 판정 배수.
 *
 * 위치가 커질수록 배수가 낮아지고 알림이 잦아진다. 축은 로그다 —
 * 1.5배와 2배의 차이는 크고 9배와 10배의 차이는 거의 없기 때문이다.
 *
 * 슬라이더 49가 기본값인 4배에 대응한다.
 */
export function sliderToRatio(position: number): number {
  const clamped = clamp(position, SLIDER_MIN, SLIDER_MAX);
  const t = (clamped - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN);

  const ratio =
    RATIO_AT_SLIDER_MIN * (RATIO_AT_SLIDER_MAX / RATIO_AT_SLIDER_MIN) ** t;

  return Math.round(ratio * 100) / 100;
}

/** 판정 배수 → 슬라이더 위치. */
export function ratioToSlider(ratio: number): number {
  const clamped = clamp(ratio, RATIO_AT_SLIDER_MAX, RATIO_AT_SLIDER_MIN);
  const t =
    Math.log(clamped / RATIO_AT_SLIDER_MIN) /
    Math.log(RATIO_AT_SLIDER_MAX / RATIO_AT_SLIDER_MIN);

  return Math.round(SLIDER_MIN + t * (SLIDER_MAX - SLIDER_MIN));
}

/** 백분위 임계 → 슬라이더 위치. 표시용 눈금을 놓을 때 쓴다. */
export function percentileToSlider(percentile: Sensitivity): number {
  const tail = clamp(100 - percentile, TAIL_AT_MIN, TAIL_AT_MAX);
  const ratio =
    Math.log(tail / TAIL_AT_MIN) / Math.log(TAIL_AT_MAX / TAIL_AT_MIN);

  return Math.round(SLIDER_MIN + ratio * (SLIDER_MAX - SLIDER_MIN));
}

/**
 * 슬라이더 위치에서 채널이 코인 1개당 하루 몇 번 울릴지 추정한다.
 *
 * 알림은 채널당 하나이므로 프레임별로 나누지 않는다.
 * 백테스트 실측 곡선을 선형 보간한다. 6종목 평균이라 정확한 예측이
 * 아니고, 슬라이더를 옮길 때 "이쯤이면 몇 번" 감을 잡는 용도다.
 */
export function estimateAlertsPerDay(sliderPosition: number): number {
  const curve = CHANNEL_RATE_CURVE;
  const positions = FRAME_RATE_CURVE_POSITIONS;

  const clamped = clamp(sliderPosition, SLIDER_MIN, SLIDER_MAX);

  const first = positions[0] ?? 0;
  if (clamped <= first) {
    return curve[0] ?? 0;
  }

  for (let i = 1; i < positions.length; i += 1) {
    const right = positions[i];
    const left = positions[i - 1];
    if (right === undefined || left === undefined) {
      break;
    }

    if (clamped <= right) {
      const weight = (clamped - left) / (right - left);
      const lowValue = curve[i - 1] ?? 0;
      const highValue = curve[i] ?? 0;
      return lowValue + (highValue - lowValue) * weight;
    }
  }

  return curve[curve.length - 1] ?? 0;
}

/**
 * 알림 빈도를 어떤 식으로 읽어줄지.
 *
 * 문장은 core가 만들지 않는다. 언어마다 표현이 갈려서("3일에 1회" /
 * "once every 3 days") 여기서 한 언어를 고르면 다른 쪽이 틀린다.
 * 대신 "어느 표현을 쓸지"와 그 안에 들어갈 숫자만 정해서 넘긴다.
 * 그 판단(경계값 0.15 / 0.67 / 10)은 언어와 무관하므로 여기서 검증한다.
 *
 * 실제 문구는 apps/web/src/lib/i18n.tsx의 formatAlertsPerDay에 있다.
 */
export type AlertRateDescription =
  | { kind: "never" }
  | { kind: "everyNDays"; days: number }
  | { kind: "perDay"; value: string };

export function describeAlertRate(perDay: number): AlertRateDescription {
  if (perDay < 0.15) {
    return { kind: "never" };
  }

  // 하루 0.3회는 "사흘에 한 번"이 더 잘 읽힌다.
  // 다만 0.9회를 "1일에 1회"로 바꾸면 오히려 어색하므로 2일 이상만.
  if (perDay < 0.67) {
    return { kind: "everyNDays", days: Math.round(1 / perDay) };
  }

  // 10회를 넘어가면 소수점 한 자리가 정밀도를 가장한 잡음이 된다.
  if (perDay < 10) {
    return { kind: "perDay", value: perDay.toFixed(1) };
  }

  return { kind: "perDay", value: String(Math.round(perDay)) };
}
