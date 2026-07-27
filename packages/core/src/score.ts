import { MAD_FLOOR_RATIO } from "./constants.js";
import { median, medianAbsoluteDeviation } from "./math.js";
import type { RollingWindow, VolatilityBaseline } from "./types.js";

/**
 * 직전 창들의 속도로 중앙값/MAD 기준선을 만든다.
 *
 * MAD에 하한을 두는 이유: 거래가 거의 없어 속도가 계속 비슷한 종목은
 * MAD가 0에 가까워지고, 그러면 S = (v - M) / D 가 발산한다.
 * 중앙값에 비례한 하한을 두면 "평소 규모 대비"라는 의미는 유지하면서
 * 분모가 0으로 붕괴하는 것만 막을 수 있다.
 */
export function computeBaseline(
  velocities: readonly number[],
): VolatilityBaseline {
  if (velocities.length === 0) {
    throw new Error("기준선을 만들려면 표본이 최소 1개는 필요합니다");
  }

  const m = median(velocities);
  const rawMad = medianAbsoluteDeviation(velocities, m);

  // 하한은 중앙값에 비례시킨다. 절대값으로 두면 종목 규모에 따라
  // 어떤 종목에서는 무의미하고 어떤 종목에서는 전부 눌려버린다.
  const floor = Math.abs(m) * MAD_FLOOR_RATIO;
  const mad = Math.max(rawMad, floor);

  return {
    median: m,
    mad,
    sampleCount: velocities.length,
  };
}

/**
 * S = (v - M) / D
 *
 * "평소 흔들리던 폭의 몇 배만큼 위로 벗어났는가".
 *
 * D가 0이면 null을 반환한다. 이건 표본이 전부 같은 값일 때만 생기는데,
 * 실질적으로는 거래가 아예 없어 속도가 계속 0이었던 종목이다.
 * 이 경우 점수로는 판단할 수 없고, 최소 거래대금 필터가 처리해야 한다.
 * 억지로 큰 수를 돌려주면 죽은 잡코인이 상시 최상위 알림으로 올라온다.
 */
export function computeScore(
  window: RollingWindow,
  baseline: VolatilityBaseline,
): number | null {
  if (baseline.mad <= 0) {
    return null;
  }

  const score = (window.velocity - baseline.median) / baseline.mad;

  if (!Number.isFinite(score)) {
    return null;
  }

  return score;
}

/**
 * 표시용 배수 (v / M).
 * 판정에는 쓰지 않는다. 사용자가 "평소의 몇 배인지" 감을 잡는 용도로만
 * 알림 카드에 같이 띄운다.
 */
export function ratioToMedian(
  window: RollingWindow,
  baseline: VolatilityBaseline,
): number | null {
  if (baseline.median <= 0) {
    return null;
  }
  return window.velocity / baseline.median;
}
