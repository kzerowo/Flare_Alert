import { LOOKBACK_WINDOW_COUNT, TIMEFRAME_MINUTES, computeBarRatios } from "@flare-alert/core";
import type { Timeframe } from "@flare-alert/core";

// ---------------------------------------------------------------------------
// 민감도 테스트에 쓸 과거 차트를 가져온다
//
// 실시간 REST다. 문제은행을 박아 두면 재도전할 때 같은 차트가 나오고,
// 데이터를 갱신하려면 빌드를 다시 해야 한다. Binance 공개 엔드포인트는
// 키가 필요 없고 CORS도 열려 있어서 브라우저가 직접 부를 수 있다.
//
// 선물이다. 현물이 아니다 — 현물 거래량으로 라벨을 채점하면 사용자가
// 표시하지 않은 봉이 그 날의 1위가 되는 일이 실제로 있었다(2026-08-03
// 16:05). 감지도 선물이므로 테스트도 선물이어야 한다.
// ---------------------------------------------------------------------------

const FUTURES_REST = "https://fapi.binance.com/fapi/v1/klines";

/** 한 판에 보여 줄 봉 수. 사용자가 한눈에 훑고 판단할 수 있는 정도. */
export const DISPLAY_BARS = 100;

/**
 * 어디까지 거슬러 올라가 표본을 뽑는가(일).
 *
 * 긴 봉일수록 한 판이 잡아먹는 기간이 길어서 더 멀리 가야 겹치지 않는다.
 * 4시간봉 한 판은 그 자체로 20일이다.
 */
const HISTORY_DAYS: Record<string, number> = {
  "1m": 60,
  "5m": 180,
  "15m": 365,
  "1h": 730,
  "4h": 1095,
};

/** 사용자가 클릭해 라벨을 붙이는 봉 하나. */
export interface TestBar {
  openTime: number;
  quoteVolume: number;
  /** 직전 봉들 중앙값 대비 배수. 화면에 올리는 봉은 전부 값이 있다. */
  ratio: number;
}

/** 한 판. */
export interface TestChart {
  symbol: string;
  timeframe: Timeframe;
  bars: TestBar[];
}

export class TestChartError extends Error {}

/**
 * 판이 쓸모 있으려면 고를 것이 있어야 한다.
 *
 * 아무 일도 없던 구간을 띄우면 사용자가 누를 봉이 없어서 그 판은 정보를
 * 하나도 주지 않는다. 반대로 전부 튀는 구간도 가르는 힘이 없다.
 * 그래서 뚜렷한 급등이 하나는 있고, 애매한 중간 봉도 몇 개는 있어야 한다.
 */
function isDiscriminating(bars: readonly TestBar[]): boolean {
  const notable = bars.filter((bar) => bar.ratio >= 3).length;
  const big = bars.filter((bar) => bar.ratio >= 5).length;

  return big >= 1 && notable >= 2 && notable <= DISPLAY_BARS / 4;
}

async function fetchWindow(
  symbol: string,
  timeframe: Timeframe,
  endTime: number,
  signal: AbortSignal,
): Promise<TestChart | null> {
  const lookback = LOOKBACK_WINDOW_COUNT[timeframe];
  const limit = lookback + DISPLAY_BARS;

  const url = `${FUTURES_REST}?symbol=${symbol}&interval=${timeframe}&endTime=${endTime}&limit=${limit}`;

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new TestChartError(`Binance ${response.status}`);
  }

  const raw: unknown = await response.json();
  if (!Array.isArray(raw) || raw.length < limit) {
    // 상장 전 구간을 짚었거나 데이터가 비었다. 이 표본은 버린다.
    return null;
  }

  const openTimes: number[] = [];
  const quoteVolumes: number[] = [];
  for (const row of raw) {
    if (!Array.isArray(row)) {
      return null;
    }
    openTimes.push(Number(row[0]));
    // 7번이 거래대금(quote asset volume)이다. 5번 거래량은 코인 개수라
    // 종목끼리 비교가 안 되고, 알고리즘이 보는 값도 아니다.
    quoteVolumes.push(Number(row[7]));
  }

  const ratios = computeBarRatios(quoteVolumes, timeframe);

  const bars: TestBar[] = [];
  for (let i = lookback; i < quoteVolumes.length; i += 1) {
    const ratio = ratios[i];
    const openTime = openTimes[i];
    const quoteVolume = quoteVolumes[i];
    // 기준선이 0이라 배수가 없는 봉이 하나라도 있으면 그 판은 쓰지 않는다.
    // 거래가 멈춰 있던 구간이라 판단 자체가 성립하지 않는다.
    if (ratio == null || openTime === undefined || quoteVolume === undefined) {
      return null;
    }
    bars.push({ openTime, quoteVolume, ratio });
  }

  return { symbol, timeframe, bars };
}

/**
 * 서로 겹치지 않는 과거 구간 여럿을 한꺼번에 받아 온다.
 *
 * 판마다 하나씩 그때그때 부르지 않는 이유는 두 가지다. 사용자가 다음
 * 차트를 기다리지 않아도 되고, 쓸 만한 구간이 나올 때까지 다시 뽑는
 * 일을 화면 뒤에서 한 번에 끝낼 수 있다.
 *
 * 구간이 겹치지 않게 하려고 전체 기간을 후보 수만큼 균등하게 나누고
 * 칸마다 한 점씩 뽑는다. 무작위로 뽑아 놓고 겹치는지 검사하는 것보다
 * 간단하고, 같은 급등을 두 판에서 다시 보는 일이 없다.
 */
export async function fetchTestCharts(
  symbol: string,
  timeframe: Timeframe,
  count: number,
  signal: AbortSignal,
): Promise<TestChart[]> {
  const lookback = LOOKBACK_WINDOW_COUNT[timeframe];
  const spanMs =
    (lookback + DISPLAY_BARS) * TIMEFRAME_MINUTES[timeframe] * 60_000;

  const now = Date.now();
  const oldest = now - (HISTORY_DAYS[timeframe] ?? 365) * 86_400_000;
  const newest = now - spanMs;

  // 쓸 만하지 않은 구간이 섞여 나오므로 넉넉히 뽑는다.
  const attempts = count * 2;
  const slot = (newest - oldest) / attempts;

  const settled = await Promise.allSettled(
    Array.from({ length: attempts }, (_, i) => {
      const endTime = Math.floor(oldest + slot * (i + Math.random()));
      return fetchWindow(symbol, timeframe, endTime, signal);
    }),
  );

  const usable: TestChart[] = [];
  const fallback: TestChart[] = [];
  let failures = 0;

  for (const result of settled) {
    if (result.status === "rejected") {
      failures += 1;
      continue;
    }
    if (result.value === null) {
      continue;
    }
    if (isDiscriminating(result.value.bars)) {
      usable.push(result.value);
    } else {
      fallback.push(result.value);
    }
  }

  // 전부 실패했다면 네트워크나 지역 차단이다. 조용히 빈 배열을 주면
  // 화면이 "차트가 없다"고만 말하게 되어 원인을 알 수 없다.
  if (failures === settled.length) {
    throw new TestChartError("모든 요청이 실패했습니다");
  }

  // 가르는 힘이 있는 구간을 먼저 쓰고, 모자라면 나머지로 채운다.
  // 판 수를 채우지 못하는 것보다는 밋밋한 차트라도 보여주는 편이 낫다.
  const charts = [...usable, ...fallback].slice(0, count);
  charts.sort((a, b) => (a.bars[0]?.openTime ?? 0) - (b.bars[0]?.openTime ?? 0));

  return charts;
}
