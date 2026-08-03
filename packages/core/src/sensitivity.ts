import {
  CHANNEL_RATE_CURVE,
  DEFAULT_SCALE,
  FRAME_RATE_CURVE_POSITIONS,
  RATIO_AT_SLIDER_MAX,
  RATIO_AT_SLIDER_MIN,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
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
