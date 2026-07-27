import { SENSITIVITY_MAX, SENSITIVITY_MIN } from "./constants.js";
import type { Sensitivity } from "./types.js";

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

/** 백분위 임계 → 슬라이더 위치. 표시용 눈금을 놓을 때 쓴다. */
export function percentileToSlider(percentile: Sensitivity): number {
  const tail = clamp(100 - percentile, TAIL_AT_MIN, TAIL_AT_MAX);
  const ratio =
    Math.log(tail / TAIL_AT_MIN) / Math.log(TAIL_AT_MAX / TAIL_AT_MIN);

  return Math.round(SLIDER_MIN + ratio * (SLIDER_MAX - SLIDER_MIN));
}

/**
 * 사용자에게 보여줄 꼬리 비율 문구.
 * 0.1%와 0.01%는 실제로 10배 차이인데 반올림하면 같아 보인다.
 */
export function formatTail(percentile: Sensitivity): string {
  // 100 - 99.9는 0.09999...로 나온다. 그대로 비교하면 0.1이 0.1 미만으로
  // 판정돼 자릿수 분기가 어긋난다.
  const tail = Math.round((100 - percentile) * 10_000) / 10_000;

  if (tail >= 1) {
    return `상위 ${Math.round(tail)}%`;
  }
  if (tail >= 0.1) {
    return `상위 ${tail.toFixed(1)}%`;
  }
  return `상위 ${tail.toFixed(2)}%`;
}
