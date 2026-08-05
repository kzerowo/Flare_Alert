import { LOOKBACK_WINDOW_COUNT, SENSITIVITY_SCALES } from "./constants.js";
import { median } from "./math.js";
import {
  SENSITIVITY_LEVEL_MAX,
  SENSITIVITY_LEVEL_MIN,
  sensitivityAt,
} from "./sensitivity.js";
import type { Timeframe } from "./types.js";

// ---------------------------------------------------------------------------
// 민감도 테스트 — 사용자의 클릭에서 슬라이더 위치를 역산한다
//
// 슬라이더는 1~100으로 열려 있지만, 처음 온 사람은 자기 자리가 어딘지
// 모른다. "하루 4.8회"라는 숫자만으로는 그게 자기에게 많은지 적은지
// 판단할 수 없기 때문이다.
//
// 그래서 묻는 대신 보여준다. 실제 과거 거래량 차트를 띄우고 "여기서
// 울렸으면 좋겠다" 싶은 봉을 찍게 한 다음, 그 라벨을 재현하는 배수를
// 찾아 슬라이더 위치로 돌려준다.
//
// 이 절차는 3.5배라는 상수를 얻은 방법과 같다. 사용자가 5분봉 차트에
// 14개를 손으로 표시했고, 그 전부를 잡는 배수가 3.5였다. 여기서 하는
// 일은 그 측정을 사용자 각자의 몫으로 앱 안에서 돌리는 것이다.
//
// 봉 단위로 재는 이유: 실시간 판정은 1초 버킷 위의 트레일링 창이지만,
// 사람이 차트에서 찍는 것은 마감된 봉이다. 라벨의 단위와 채점의 단위가
// 어긋나면 사용자가 찍지 않은 것을 근거로 임계가 정해진다.
// ---------------------------------------------------------------------------

/** 차트에 그린 봉 하나. 배수는 이미 계산된 값이다. */
export interface LabeledBar {
  /** 직전 LOOKBACK_WINDOW_COUNT[봉]개 봉 거래대금 중앙값 대비 배수. */
  ratio: number;
  /** 사용자가 "여기서 울렸으면" 하고 찍었는가. */
  wanted: boolean;
}

/** 라벨을 채점한 결과. 화면에 그대로 올릴 수 있는 값만 담는다. */
export interface SensitivityFit {
  /** 추천 슬라이더 위치(1~100). 고른 봉의 구간 안이다. */
  level: number;
  /** 그 자리의 판정 배수. */
  ratio: number;
  timeframe: Timeframe;
  /** 대형주 코인 1개당 하루 알림 수. 실측 곡선에서 읽은 값이다. */
  alertsPerDay: number;
  /** 찍은 봉 중 이 설정이 잡는 비율. */
  recall: number;
  /** 이 설정이 울리는 봉 중 사용자가 찍은 비율. */
  precision: number;
  /** 찍은 봉 수. */
  wanted: number;
  /** 그 중 잡히는 수. */
  caught: number;
  /** 찍지 않았는데 울리는 수. */
  extra: number;
  /**
   * 구간의 끝에 붙었는가. 사용자의 기준이 그 봉으로 갈 수 있는 범위
   * 밖이라는 뜻이라, 화면에서 "여기가 한계다"라고 말해 줘야 한다.
   */
  clamped: "quiet" | "loud" | null;
}

/**
 * 라벨이 이만큼은 모여야 채점한다.
 *
 * 한두 개로도 배수는 나오지만 그 배수는 클릭 하나에 통째로 끌려다닌다.
 * 사용자는 실수로도 누르고, 같은 봉을 판마다 다르게 보기도 한다.
 */
export const MIN_LABELS_FOR_FIT = 3;

/**
 * 거래대금 배열 → 봉마다의 배수.
 *
 * 앞쪽 lookback개는 기준선을 만들 과거가 없어 null이다. 화면에는 배수가
 * 있는 구간만 클릭 가능하게 올린다.
 */
export function computeBarRatios(
  quoteVolumes: readonly number[],
  timeframe: Timeframe,
): (number | null)[] {
  const lookback = LOOKBACK_WINDOW_COUNT[timeframe];

  return quoteVolumes.map((volume, index) => {
    if (index < lookback) {
      return null;
    }

    const base = median(quoteVolumes.slice(index - lookback, index));

    // 중앙값이 0이면 배수가 발산한다. 거래가 아예 없던 구간이므로
    // 배수라는 말 자체가 성립하지 않는다 — score.ts의 MAD가 0일 때와 같다.
    if (base <= 0) {
      return null;
    }

    return volume / base;
  });
}

/** 그 봉이 슬라이더에서 차지하는 구간의 양 끝(포함). */
export function bandRange(timeframe: Timeframe): {
  min: number;
  max: number;
} {
  const index = SENSITIVITY_SCALES.findIndex(
    (scale) => scale.timeframe === timeframe,
  );
  const width =
    (SENSITIVITY_LEVEL_MAX - SENSITIVITY_LEVEL_MIN + 1) /
    SENSITIVITY_SCALES.length;

  if (index < 0) {
    return { min: SENSITIVITY_LEVEL_MIN, max: SENSITIVITY_LEVEL_MAX };
  }

  return {
    min: SENSITIVITY_LEVEL_MIN + index * width,
    max: SENSITIVITY_LEVEL_MIN + (index + 1) * width - 1,
  };
}

/**
 * 라벨을 가르는 자리 후보들.
 *
 * 임계는 어떤 값이든 될 수 있지만, 채점이 달라지는 자리는 유한하다 —
 * 봉 배수 사이를 지날 때만 울리는 개수가 바뀐다. 그래서 정렬한 배수
 * 사이의 기하 중점만 본다. 양 끝에는 "하나도 안 울리는" 자리와 "전부
 * 울리는" 자리를 하나씩 더 둔다.
 *
 * 산술 중점이 아니라 기하 중점인 이유는 축이 로그이기 때문이다.
 * 3배와 4배 사이는 멀고 30배와 31배 사이는 거의 붙어 있다.
 */
function candidateThresholds(bars: readonly LabeledBar[]): number[] {
  const unique = [...new Set(bars.map((bar) => bar.ratio))].sort(
    (a, b) => b - a,
  );

  const highest = unique[0];
  const lowest = unique[unique.length - 1];
  if (highest === undefined || lowest === undefined) {
    return [];
  }

  const out = [highest * 1.5];
  for (let i = 1; i < unique.length; i += 1) {
    const upper = unique[i - 1];
    const lower = unique[i];
    if (upper === undefined || lower === undefined) {
      continue;
    }
    out.push(Math.sqrt(upper * lower));
  }
  out.push(lowest / 1.5);

  return out;
}

/**
 * 라벨에서 슬라이더 위치를 찾는다.
 *
 * 두 단계다. 먼저 구간을 잊고 라벨만 보고 임계 배수를 찾은 다음, 그 배수를
 * 고른 봉의 구간 안 위치로 스냅한다.
 *
 * 순서가 중요하다. 처음에는 구간의 스무 칸만 훑었는데, 사용자의 기준이 그
 * 구간이 갈 수 있는 범위 밖이면 스무 칸이 전부 같은 점수를 받아 버린다.
 * 예를 들어 5분봉 구간의 가장 느슨한 자리가 3.5배인데 사용자가 2배짜리
 * 봉들을 찍었다면, 어느 칸에서도 아무것도 울리지 않아 전부 0점 동점이 되고
 * 엉뚱하게 구간 한가운데가 뽑힌다. 정답은 가장 잦은 끝이다. 임계를 먼저
 * 자유롭게 찾으면 그 방향이 배수에 남아 있어서 스냅이 옳은 끝을 고른다.
 *
 * 점수는 F1이다. 찍은 것을 다 잡는 배수(최소 배수)를 그대로 쓰면 오클릭
 * 하나가 민감도를 통째로 끌어내린다 — 사용자는 실수로도 누르고, 판마다
 * 판단이 조금씩 다르다. F1은 놓친 것과 헛울림을 같이 보므로, 잡봉들 사이에
 * 섞인 오클릭 하나는 그것을 잡으려다 잃는 정밀도가 더 커서 버려진다.
 *
 * 동점이면 가운데를 고른다. 찍은 봉과 안 찍은 봉 사이가 벌어져 있으면 그
 * 사이의 모든 자리가 같은 점수를 받는데, 가장자리를 고르면 다음 판 라벨
 * 하나에 판정이 뒤집힌다. 가운데가 여백이 가장 크다.
 *
 * 라벨이 MIN_LABELS_FOR_FIT개 미만이면 null이다.
 */
export function fitSensitivity(
  bars: readonly LabeledBar[],
  timeframe: Timeframe,
): SensitivityFit | null {
  const wanted = bars.filter((bar) => bar.wanted).length;
  if (wanted < MIN_LABELS_FOR_FIT) {
    return null;
  }

  let bestScore = -1;
  const tied: number[] = [];

  for (const threshold of candidateThresholds(bars)) {
    let caught = 0;
    let fired = 0;
    for (const bar of bars) {
      if (bar.ratio < threshold) {
        continue;
      }
      fired += 1;
      if (bar.wanted) {
        caught += 1;
      }
    }

    const recall = caught / wanted;
    const precision = fired === 0 ? 0 : caught / fired;
    const score =
      recall + precision === 0
        ? 0
        : (2 * recall * precision) / (recall + precision);

    // 부동소수 잡음으로 동점을 놓치지 않게 여유를 둔다.
    if (score > bestScore + 1e-9) {
      bestScore = score;
      tied.length = 0;
      tied.push(threshold);
    } else if (score > bestScore - 1e-9) {
      tied.push(threshold);
    }
  }

  // 후보는 큰 배수부터 만들어졌으므로 동점 목록도 정렬되어 있다.
  const target = tied[Math.floor((tied.length - 1) / 2)];
  if (target === undefined) {
    return null;
  }

  // 구간 안에서 그 배수에 가장 가까운 자리로. 거리도 로그로 잰다.
  const { min, max } = bandRange(timeframe);
  let chosen = min;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let level = min; level <= max; level += 1) {
    const distance = Math.abs(Math.log(sensitivityAt(level).ratio / target));
    if (distance < bestDistance) {
      bestDistance = distance;
      chosen = level;
    }
  }

  const setting = sensitivityAt(chosen);

  let caught = 0;
  let fired = 0;
  for (const bar of bars) {
    if (bar.ratio < setting.ratio) {
      continue;
    }
    fired += 1;
    if (bar.wanted) {
      caught += 1;
    }
  }

  // 구간 끝에 붙었고 그 방향으로 더 갈 이유가 남아 있으면 잘린 것이다.
  // 조용한 쪽 끝인데 헛울림이 남았거나, 잦은 쪽 끝인데 놓친 것이 남았거나.
  let clamped: "quiet" | "loud" | null = null;
  if (chosen === min && fired > caught) {
    clamped = "quiet";
  } else if (chosen === max && caught < wanted) {
    clamped = "loud";
  }

  return {
    level: chosen,
    ratio: setting.ratio,
    timeframe: setting.timeframe,
    alertsPerDay: setting.alertsPerDay,
    recall: caught / wanted,
    precision: fired === 0 ? 0 : caught / fired,
    wanted,
    caught,
    extra: fired - caught,
    clamped,
  };
}
