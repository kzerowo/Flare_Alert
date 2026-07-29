// 과거 봉으로 냉시동을 메운다.
//
// 갓 켠 프로세스에는 과거가 없다. 필요한 게 두 가지인데 둘 다 시간이 든다.
//
//   1. 기준선: 프레임별로 완결된 창이 LOOKBACK_WINDOW_COUNT개 필요하다.
//      1일봉이면 14일이다. 실시간만 기다리면 2주 동안 못 쓴다.
//   2. 백분위 분포: "지금이 과거 분포에서 몇 등인가"를 답하려면 표본이
//      충분해야 한다. 기본 민감도 99.9659를 분해하려면 표본이 최소
//      3,000개쯤 있어야 하고, 그 아래에서는 백분위가 임계에 닿지 못해
//      알림이 아예 안 나간다.
//
// 1분봉을 받아 1분 해상도로 재생하면 둘 다 채워진다. 실시간은 1초
// 해상도지만, 분 단위 재생은 같은 분포에서 1/60로 성기게 뽑은 표본이라
// 분포의 모양은 보존된다.
//
// 예외가 1분 프레임이다. 1분 창을 1분 간격으로 평가하면 항상 완결된
// 창(경과 60초)만 보게 된다. 실시간은 경과 10~60초의 부분 창을 훨씬 많이
// 보는데, 부분 창은 표본이 적어 속도가 더 크게 흔들린다. 즉 이렇게 채운
// 1분 분포는 실제보다 좁고, 그 좁은 분포에 실시간 점수를 대면 백분위가
// 부풀려져 알림이 과하게 나간다. 그래서 1분 프레임만 분포를 채우지 않고
// 실시간으로 쌓게 둔다. 기준선은 완결 창 기준이라 그대로 채워도 된다.

import { PERCENTILE_HISTORY_DAYS, TIMEFRAMES } from "@flare-alert/core";
import type { Timeframe } from "@flare-alert/core";

import { fetchMinuteKlines } from "./binance.js";
import type { Detector } from "./detect.js";

/**
 * 1분 프레임은 분포를 채우지 않는다. 위 주석 참고.
 *
 * 대신 실시간으로 쌓인다. 초당 표본 하나씩이라 임계를 분해할 만큼
 * 모이는 데 한 시간쯤 걸린다. 그동안 1분 프레임은 조용하다.
 */
const SKIP_DISTRIBUTION: ReadonlySet<Timeframe> = new Set<Timeframe>(["1m"]);

/**
 * 며칠치를 받을 것인가.
 *
 * 1일봉 기준선에 14일이 필요하고(LOOKBACK_WINDOW_COUNT["1d"]), 그 뒤로도
 * 분포를 쌓을 기간이 남아야 한다. 20일이면 1일 프레임에 6일치 표본
 * (8,640개)이 남아 기본 민감도를 분해할 수 있다.
 *
 * 더 길게 받아도 되지만 PERCENTILE_HISTORY_DAYS를 넘으면 추정기가
 * 어차피 버린다.
 */
export const BACKFILL_DAYS = Math.max(20, PERCENTILE_HISTORY_DAYS + 6);

export interface BackfillResult {
  symbol: string;
  minutes: number;
  /** 마지막으로 반영한 분의 시작 절대 초 */
  lastMinuteSecond: number;
  elapsedMs: number;
}

/**
 * 한 종목의 과거를 채운다.
 *
 * endMs는 "여기까지 채운다"는 뜻이고, 보통 지금 진행 중인 분의 시작이다.
 * 진행 중인 분은 아직 안 끝났으므로 거래대금이 덜 찬 상태라 넣으면 안 된다.
 */
export async function backfillSymbol(
  detector: Detector,
  symbol: string,
  endMs: number,
  days: number = BACKFILL_DAYS,
): Promise<BackfillResult> {
  const started = Date.now();
  const startMs = endMs - days * 86_400_000;

  const klines = await fetchMinuteKlines(symbol, startMs, endMs);
  const aggregator = detector.aggregator(symbol);

  let lastMinuteSecond = Math.floor(startMs / 1000);

  for (const kline of klines) {
    const minuteSecond = Math.floor(kline.openTimeMs / 1000);

    // 진행 중인 분은 거래대금이 덜 찼다. 넣으면 그 창이 조용해 보인다.
    if (kline.openTimeMs >= endMs) {
      break;
    }

    aggregator.feedMinute(minuteSecond, kline.quoteVolume, kline.close);
    lastMinuteSecond = minuteSecond;

    // 이 분의 끝 시각으로 평가한다. 신호는 버리고 분포만 쌓는다.
    const atMs = kline.openTimeMs + 59_000;
    detector.evaluate(symbol, atMs, { silent: true, skip: SKIP_DISTRIBUTION });
  }

  return {
    symbol,
    minutes: klines.length,
    lastMinuteSecond,
    elapsedMs: Date.now() - started,
  };
}

/**
 * 스트림이 끊겨 있던 구간을 메운다.
 *
 * 그냥 두면 그 구간이 거래대금 0으로 남는다. 창이 조용해 보이는 것으로
 * 끝나지 않고, 그 창이 완결되면 기준선 중앙값까지 끌어내려 한참 뒤에
 * 엉뚱한 알림을 만든다.
 *
 * 분 단위로만 메울 수 있어 초 단위 정확도는 잃는다. 그래도 0으로 두는
 * 것보다는 낫다.
 */
export async function backfillGap(
  detector: Detector,
  symbol: string,
  fromSecond: number,
  toMs: number,
): Promise<number> {
  const startMs = fromSecond * 1000;
  if (startMs >= toMs) {
    return 0;
  }

  const klines = await fetchMinuteKlines(symbol, startMs, toMs);
  const aggregator = detector.aggregator(symbol);

  let applied = 0;
  for (const kline of klines) {
    if (kline.openTimeMs >= toMs) {
      break;
    }
    const minuteSecond = Math.floor(kline.openTimeMs / 1000);
    if (minuteSecond <= aggregator.currentSecond) {
      continue;
    }

    aggregator.feedMinute(minuteSecond, kline.quoteVolume, kline.close);
    detector.evaluate(symbol, kline.openTimeMs + 59_000, {
      silent: true,
      skip: SKIP_DISTRIBUTION,
    });
    applied += 1;
  }

  return applied;
}

/** 프레임별로 분포가 임계를 분해할 만큼 쌓였는지. 부팅 로그에 쓴다. */
export function distributionReadiness(
  detector: Detector,
  symbol: string,
  sensitivity: number,
): { timeframe: Timeframe; samples: number; ready: boolean }[] {
  // 백분위가 임계에 닿으려면 표본이 최소 1/(1 - p/100)개는 있어야 한다.
  // 그보다 적으면 가장 큰 관측치도 임계 아래에 머문다.
  const needed = Math.ceil(1 / (1 - sensitivity / 100));

  return TIMEFRAMES.map((timeframe) => {
    const samples = detector.sampleCount(symbol, timeframe);
    return { timeframe, samples, ready: samples >= needed };
  });
}
