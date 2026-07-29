// 백테스트 진입점.
//
// 1단계: 1초 시계열을 리플레이해서 임계 교차를 뽑아 캐시한다 (무겁다).
// 2단계: 캐시된 교차에 쿨다운·병합 파라미터 조합을 훑는다 (가볍다).
//
// 사용법: pnpm --filter @flare-alert/backtest start

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DETECTION_TIMEFRAME,
  EVENT_GAP_SECONDS,
  FRAME_SCALE_PERCENTILE,
  MIN_QUOTE_VOLUME,
  SENSITIVITY_DEFAULT,
  TIMEFRAMES,
  percentileToSlider,
  sliderToPercentile,
  sliderToRatio,
} from "@flare-alert/core";

import { loadCrossings, saveCrossings } from "./crossings.js";
import type { CrossingStream } from "./crossings.js";
import { evaluate } from "./engine.js";
import { measureChannelCurve, measureScaleMarkers } from "./event-scale.js";
import { loadManifest, loadPrices, loadSymbol, symbolsIn } from "./data.js";
import { HORIZONS, buildBaseline, measureQuality } from "./quality.js";
import { measureTurnover } from "./turnover.js";
import { buildHourlyBaseline, measureHourMatched } from "./hour-matched.js";
import {
  LABEL_RATIO,
  buildLabelEvents,
  measureFit,
  measureTrailingReference,
} from "./label-fit.js";
import type { LabelEvent } from "./label-fit.js";
import type { Baseline } from "./quality.js";
import { extractCrossings } from "./replay.js";

/** 스윕에서 쓸 가장 낮은 민감도. 교차 스트림은 이 아래를 담지 않는다. */
const MIN_PERCENTILE = 89;

/**
 * 추출 단계에서는 거래대금으로 거르지 않는다.
 *
 * MIN_QUOTE_VOLUME은 근거 없이 정해진 값이라 되물을 수 있어야 한다.
 * 여기서 걸러 버리면 그 아래가 어땠는지 영영 볼 수 없다. 전부 담아 두고
 * 필요한 곳에서 훑는다.
 */
const EXTRACT_MIN_QUOTE_VOLUME = 0;

/**
 * 배수가 이 값 이상이면 백분위가 낮아도 담는다.
 *
 * 사용자 기준이 4배라 그 아래로 여유를 둔다. 백분위와 배수는 기준선의
 * MAD가 클 때 서로 어긋나므로, 백분위로만 거르면 "배수는 큰데 점수는
 * 평범한" 구간이 통째로 사라져 배수 판정을 측정할 수 없게 된다.
 */
const EXTRACT_MIN_RATIO = 3;

// 99 위쪽을 같이 본다. 초 단위 평가에서는 상위 1%도 하루 5천 번 넘게
// 발생하므로, 실제로 쓸 만한 구간이 99~100 사이에 몰려 있을 수 있다.
const SENSITIVITIES = [95, 99, 99.5, 99.9];
const WARMUP_DAYS = 30;

/** 훑을 파라미터 조합. */
const EVENT_GAPS = [60, 120, 300, 600, 900];
const COOLDOWN_SCALES = [1, 3, 10];
const TIGHTENING = 5;

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function padStart(text: string, width: number): string {
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

async function getStream(
  dataDir: string,
  cacheDir: string,
  symbol: string,
  manifest: Awaited<ReturnType<typeof loadManifest>>,
): Promise<CrossingStream> {
  const cached = await loadCrossings(cacheDir, symbol, MIN_PERCENTILE);
  if (cached !== null) {
    console.log(
      `  ${pad(symbol, 10)} 캐시 사용 (교차 ${cached.seconds.length.toLocaleString()}건)`,
    );
    return cached;
  }

  const series = await loadSymbol(dataDir, symbol, manifest);
  const result = extractCrossings(series, {
    minPercentile: MIN_PERCENTILE,
    minRatio: EXTRACT_MIN_RATIO,
    minQuoteVolume: EXTRACT_MIN_QUOTE_VOLUME,
    warmupDays: WARMUP_DAYS,
  });

  await saveCrossings(cacheDir, result.stream);

  const turnoverCut = Object.values(result.perFrame).reduce(
    (sum, s) => sum + s.rejectedTurnover,
    0,
  );

  console.log(
    `  ${pad(symbol, 10)} 추출 ${(result.elapsedMs / 1000).toFixed(0)}초, ` +
      `교차 ${result.stream.seconds.length.toLocaleString()}건, ` +
      `거래대금컷 ${turnoverCut.toLocaleString()}건`,
  );

  return result.stream;
}

function sweep(streams: readonly CrossingStream[]): void {
  for (const sensitivity of SENSITIVITIES) {
    console.log("");
    console.log("═".repeat(76));
    console.log(`민감도 ${sensitivity} · 종목당 하루 알림 수`);
    console.log("");

    const header =
      pad("사건간격", 9) +
      pad("쿨다운", 9) +
      streams.map((s) => padStart(s.symbol.replace("USDT", ""), 9)).join("") +
      padStart("평균", 9);
    console.log(header);

    for (const eventGap of EVENT_GAPS) {
      for (const scale of COOLDOWN_SCALES) {
        const results = streams.map((stream) =>
          evaluate(stream, {
            sensitivity,
            eventGapSeconds: eventGap,
            cooldownScale: scale,
            tightening: TIGHTENING,
          }),
        );

        const average =
          results.reduce((sum, r) => sum + r.alertsPerDay, 0) / results.length;

        console.log(
          pad(`${eventGap}초`, 9) +
            pad(`×${scale}`, 9) +
            results
              .map((r) => padStart(r.alertsPerDay.toFixed(1), 9))
              .join("") +
            padStart(average.toFixed(1), 9),
        );
      }
    }
  }
}

/**
 * 사건 규모별로 필요한 민감도. 슬라이더 눈금의 근거다.
 *
 * 분위수를 낮출수록 그 규모 사건을 더 많이 잡아 눈금이 오른쪽으로 간다.
 * 어느 분위수가 실제 차트 감각과 맞는지 보려고 여러 개를 같이 뽑는다.
 */
function scaleMarkers(streams: readonly CrossingStream[]): void {
  for (const reference of [99, 98.5, 98, 97, 96]) {
    console.log("");
    console.log("=".repeat(76));
    console.log(`사건 규모별 눈금 · 사건 기준선 ${reference}`);
    console.log("");
    console.log(
      pad("규모", 10) +
        padStart("사건/일", 10) +
        padStart("슬라이더", 10) +
        padStart("실제/일", 10) +
        padStart("사건 수", 10),
    );

    for (const marker of measureScaleMarkers(streams, reference)) {
      const actual = measureChannelCurve(streams, [marker.sliderPosition])[0];
      console.log(
        pad(marker.timeframe, 10) +
          padStart(marker.targetPerDay.toFixed(1), 10) +
          padStart(String(marker.sliderPosition), 10) +
          padStart((actual?.perDay ?? 0).toFixed(1), 10) +
          padStart(marker.eventCount.toLocaleString(), 10),
      );
    }
  }
}

/** 슬라이더 위치별 채널 알림 수. 알림은 채널당 하나다. */
function channelCurve(streams: readonly CrossingStream[]): void {
  const positions: number[] = [];
  for (let p = 5; p <= 100; p += 5) {
    positions.push(p);
  }

  console.log("");
  console.log("═".repeat(76));
  console.log("슬라이더 위치별 채널 하루 알림 수 (코인 1개 기준, 종목 평균)");
  console.log("");
  console.log(pad("위치", 8) + padStart("백분위", 10) + padStart("하루", 10));

  const rows = measureChannelCurve(streams, positions);
  for (const row of rows) {
    console.log(
      pad(String(row.position), 8) +
        padStart(row.percentile.toFixed(2), 10) +
        padStart(row.perDay.toFixed(2), 10),
    );
  }

  console.log("");
  console.log("상수로 넣을 형태:");
  console.log(
    JSON.stringify(rows.map((r) => Math.round(r.perDay * 100) / 100)),
  );
}

/**
 * 알림 품질.
 *
 * 지금까지 재던 "얼마나 자주 울리는가"와는 다른 질문이다.
 * 울린 뒤 실제로 가격이 움직였는지, 아무 때나 찍은 시점보다 더 움직였는지를 본다.
 */
async function alertQuality(
  dataDir: string,
  streams: readonly CrossingStream[],
  manifest: Awaited<ReturnType<typeof loadManifest>>,
): Promise<void> {
  console.log("");
  console.log("═".repeat(76));
  console.log(
    `알림 품질 · 민감도 ${SENSITIVITY_DEFAULT} (기본값, 슬라이더 ${percentileToSlider(SENSITIVITY_DEFAULT)})`,
  );
  console.log("");
  console.log("배수 = 알림 후 이동폭 ÷ 무작위 시점 이동폭. 1.0이면 정보 없음.");
  console.log("적중률 = 무작위 상위 10% 기준을 넘긴 알림 비율. 무작위면 10%.");
  console.log("상승 = 지평 끝에서 오른 비율. 50%면 방향성 없음.");

  const totals = HORIZONS.map(() => ({ lift: 0, hit: 0, up: 0, n: 0 }));

  /** 종목별 기준선. 민감도와 무관하므로 한 번만 만들어 재사용한다. */
  const cached = new Map<
    string,
    { prices: Float32Array; baseline: Baseline; count: number }
  >();

  for (const stream of streams) {
    const prices = await loadPrices(dataDir, stream.symbol, manifest);
    const built = buildBaseline(prices, WARMUP_DAYS * 86_400, 20_000, 20260729);
    cached.set(stream.symbol, {
      prices,
      baseline: built.baseline,
      count: built.count,
    });
  }

  for (const stream of streams) {
    const entry = cached.get(stream.symbol);
    if (entry === undefined) {
      continue;
    }

    const report = measureQuality(
      stream,
      entry.prices,
      entry.baseline,
      entry.count,
      {
        sensitivity: SENSITIVITY_DEFAULT,
        eventGapSeconds: EVENT_GAP_SECONDS,
        cooldownScale: 1,
        tightening: TIGHTENING,
      },
    );

    console.log("");
    console.log(
      `${stream.symbol.replace("USDT", "")} · 알림 ${report.alertCount}건, ` +
        `기준선 표본 ${report.baselineCount.toLocaleString()}건`,
    );
    console.log(
      pad("지평", 8) +
        padStart("알림", 10) +
        padStart("무작위", 10) +
        padStart("배수", 8) +
        padStart("분위", 8) +
        padStart("적중률", 9) +
        padStart("상승", 8),
    );

    for (let h = 0; h < report.perHorizon.length; h += 1) {
      const row = report.perHorizon[h];
      if (row === undefined) {
        continue;
      }

      const bucket = totals[h];
      // 배수를 낼 수 없는 종목은 평균에서 뺀다. 0으로 세면 평균이 눌린다.
      if (bucket !== undefined && row.lift !== null) {
        bucket.lift += row.lift;
        bucket.hit += row.hitRate;
        bucket.up += row.upFraction;
        bucket.n += 1;
      }

      console.log(
        pad(`${row.horizonSeconds / 60}분`, 8) +
          padStart(`${(row.alertMove * 100).toFixed(2)}%`, 10) +
          padStart(`${(row.baselineMove * 100).toFixed(2)}%`, 10) +
          padStart(row.lift === null ? "—" : `${row.lift.toFixed(2)}x`, 8) +
          padStart(`${row.percentileRank.toFixed(0)}%`, 8) +
          padStart(`${(row.hitRate * 100).toFixed(0)}%`, 9) +
          padStart(`${(row.upFraction * 100).toFixed(0)}%`, 8),
      );
    }
  }

  console.log("");
  console.log("─".repeat(76));
  console.log("종목 평균");
  console.log(
    pad("지평", 8) + padStart("배수", 10) + padStart("적중률", 10) + padStart("상승", 10),
  );

  for (let h = 0; h < HORIZONS.length; h += 1) {
    const bucket = totals[h];
    if (bucket === undefined || bucket.n === 0) {
      continue;
    }
    console.log(
      pad(`${(HORIZONS[h] ?? 0) / 60}분`, 8) +
        padStart(`${(bucket.lift / bucket.n).toFixed(2)}x`, 10) +
        padStart(`${((bucket.hit / bucket.n) * 100).toFixed(0)}%`, 10) +
        padStart(`${((bucket.up / bucket.n) * 100).toFixed(0)}%`, 10),
    );
  }

  /*
   * 민감도를 올리면 품질이 좋아지는가.
   *
   * 이게 갈림길이다. 임계를 조일수록 배수가 뚜렷이 오르면 신호는 진짜이고
   * 기본값만 느슨한 것이다. 아무리 조여도 평평하면 신호 자체가 약한 것이다.
   *
   * 대형주만 평균한다. ANKR·ONE은 61일 동안 알림이 20건뿐이라 어떤 숫자가
   * 나와도 표본으로 쓸 수 없다.
   */
  const MAJORS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "LINKUSDT"];

  console.log("");
  console.log("═".repeat(76));
  console.log("민감도별 품질 (대형주 4종목 평균 배수)");
  console.log("");
  console.log(
    pad("슬라이더", 10) +
      padStart("백분위", 11) +
      padStart("알림/일", 9) +
      HORIZONS.map((h) => padStart(`${h / 60}분`, 9)).join(""),
  );

  for (const timeframe of TIMEFRAMES) {
    const sensitivity = FRAME_SCALE_PERCENTILE[timeframe];
    const sums = HORIZONS.map(() => ({ lift: 0, n: 0 }));
    let alertsPerDay = 0;
    let counted = 0;

    for (const stream of streams) {
      if (!MAJORS.includes(stream.symbol)) {
        continue;
      }
      const entry = cached.get(stream.symbol);
      if (entry === undefined) {
        continue;
      }

      const report = measureQuality(
        stream,
        entry.prices,
        entry.baseline,
        entry.count,
        {
          sensitivity,
          eventGapSeconds: EVENT_GAP_SECONDS,
          cooldownScale: 1,
          tightening: TIGHTENING,
        },
      );

      alertsPerDay += report.alertCount / stream.measuredDays;
      counted += 1;

      for (let h = 0; h < report.perHorizon.length; h += 1) {
        const row = report.perHorizon[h];
        const bucket = sums[h];
        if (row?.lift != null && bucket !== undefined) {
          bucket.lift += row.lift;
          bucket.n += 1;
        }
      }
    }

    console.log(
      pad(String(percentileToSlider(sensitivity)), 10) +
        padStart(sensitivity.toFixed(4), 11) +
        padStart((alertsPerDay / Math.max(counted, 1)).toFixed(1), 9) +
        sums
          .map((s) =>
            padStart(s.n > 0 ? `${(s.lift / s.n).toFixed(2)}x` : "—", 9),
          )
          .join(""),
    );
  }
}

/**
 * 거래대금 하한을 잰다.
 *
 * MIN_QUOTE_VOLUME은 근거 없이 정해진 값이면서 소형주의 동작을 혼자
 * 결정한다. 구간별로 신호가 살아 있는지 보고 경계를 정한다.
 */
async function turnoverFloor(
  dataDir: string,
  streams: readonly CrossingStream[],
  manifest: Awaited<ReturnType<typeof loadManifest>>,
  horizonIndex: number,
): Promise<void> {
  const horizonSeconds = HORIZONS[horizonIndex] ?? 60;

  console.log("");
  console.log("═".repeat(76));
  console.log(
    `거래대금 하한 · 구간별 알림 품질 (${horizonSeconds / 60}분 지평)`,
  );
  console.log("");
  console.log(
    `현재 값 ${MIN_QUOTE_VOLUME.binance.toLocaleString()} USDT는 근거 없이 정해진 값이다.`,
  );
  console.log("배수가 1.0 근처인 구간은 알림에 정보가 없다는 뜻이다.");

  if (horizonIndex > 0) {
    // 1분 지평에서는 소형주의 기준선 중앙값이 0이라 배수를 낼 수 없다.
    // 지평을 늘리면 무작위 시점에서도 가격이 움직여 비교가 가능해진다.
    console.log(
      "지평을 늘리면 소형주(ANKR/ONE)도 측정된다. 1분에서는 기준선이 0이라 불가능하다.",
    );
  }

  // 구간별 합계. 종목을 가로질러 모은다.
  const totals = new Map<string, { alerts: number; lift: number; n: number }>();

  for (const stream of streams) {
    const prices = await loadPrices(dataDir, stream.symbol, manifest);
    const built = buildBaseline(prices, WARMUP_DAYS * 86_400, 20_000, 20260729);

    const report = measureTurnover(stream, prices, built.baseline, {
      sensitivity: SENSITIVITY_DEFAULT,
      eventGapSeconds: EVENT_GAP_SECONDS,
      cooldownScale: 3,
      tightening: TIGHTENING,
      horizonIndex,
    });

    console.log("");
    console.log(
      `── ${stream.symbol} (알림 ${report.totalAlerts.toLocaleString()}건)`,
    );
    console.log(
      `   ${pad("거래대금", 14)}${padStart("알림", 8)}${padStart("배수", 10)}`,
    );

    for (const bucket of report.buckets) {
      if (bucket.alerts === 0) {
        continue;
      }
      const lift = bucket.lift === null ? "—" : `${bucket.lift.toFixed(2)}x`;
      console.log(
        `   ${pad(bucket.label, 14)}${padStart(bucket.alerts.toLocaleString(), 8)}${padStart(lift, 10)}`,
      );

      const entry = totals.get(bucket.label) ?? { alerts: 0, lift: 0, n: 0 };
      entry.alerts += bucket.alerts;
      if (bucket.lift !== null) {
        entry.lift += bucket.lift;
        entry.n += 1;
      }
      totals.set(bucket.label, entry);
    }
  }

  console.log("");
  console.log("─".repeat(76));
  console.log("전 종목 합계");
  console.log(
    `   ${pad("거래대금", 14)}${padStart("알림", 8)}${padStart("평균 배수", 12)}`,
  );

  for (const [label, entry] of totals) {
    const average = entry.n > 0 ? `${(entry.lift / entry.n).toFixed(2)}x` : "—";
    console.log(
      `   ${pad(label, 14)}${padStart(entry.alerts.toLocaleString(), 8)}${padStart(average, 12)}`,
    );
  }
}

/**
 * 시간대 교란을 보정한 품질 측정.
 *
 * 알림은 거래가 활발한 시간대에 몰리는데 기준선은 24시간 균등이었다.
 * 활발한 시간대는 원래 더 움직이므로 배수의 일부가 신호가 아니라
 * 시간대일 수 있었다. 같은 시각대끼리 비교해 얼마나 부풀려졌는지 본다.
 */
async function hourConfound(
  dataDir: string,
  streams: readonly CrossingStream[],
  manifest: Awaited<ReturnType<typeof loadManifest>>,
): Promise<void> {
  console.log("");
  console.log("═".repeat(76));
  console.log("시간대 교란 보정 · 같은 UTC 시각대끼리 비교");
  console.log("");
  console.log("보정 전 = 24시간 균등 기준선 (기존 방식)");
  console.log("보정 후 = 알림이 뜬 시각대의 기준선과만 비교");

  const totals = HORIZONS.map(() => ({
    matched: 0,
    naive: 0,
    n: 0,
  }));

  for (const stream of streams) {
    const prices = await loadPrices(dataDir, stream.symbol, manifest);
    const startAbsSecond = Math.floor(stream.startMs / 1000);
    const warmupSeconds = WARMUP_DAYS * 86_400;

    // 시각대별로 나누면 표본이 24분의 1이 된다. 전체를 늘려 시각대당
    // 2,000개쯤 남게 한다.
    const hourly = buildHourlyBaseline(
      prices,
      startAbsSecond,
      warmupSeconds,
      48_000,
      20260729,
    );
    const flat = buildBaseline(prices, warmupSeconds, 20_000, 20260729);

    const report = measureHourMatched(
      stream,
      prices,
      hourly.baseline,
      flat.baseline,
      startAbsSecond,
      {
        sensitivity: SENSITIVITY_DEFAULT,
        eventGapSeconds: EVENT_GAP_SECONDS,
        cooldownScale: 3,
        tightening: TIGHTENING,
      },
    );

    if (report.alertCount === 0) {
      continue;
    }

    console.log("");
    console.log(`── ${stream.symbol} (알림 ${report.alertCount}건)`);
    console.log(
      `   ${pad("지평", 8)}${padStart("보정 전", 10)}${padStart("보정 후", 10)}`,
    );

    for (let h = 0; h < report.perHorizon.length; h += 1) {
      const row = report.perHorizon[h];
      if (row === undefined) {
        continue;
      }
      const label = `${row.horizonSeconds / 60}분`;
      const naive = row.naiveLift === null ? "—" : `${row.naiveLift.toFixed(2)}x`;
      const matched =
        row.matchedLift === null ? "—" : `${row.matchedLift.toFixed(2)}x`;

      console.log(
        `   ${pad(label, 8)}${padStart(naive, 10)}${padStart(matched, 10)}`,
      );

      const total = totals[h];
      if (total !== undefined && row.naiveLift !== null && row.matchedLift !== null) {
        total.naive += row.naiveLift;
        total.matched += row.matchedLift;
        total.n += 1;
      }
    }
  }

  console.log("");
  console.log("─".repeat(76));
  console.log("전 종목 평균");
  console.log(
    `   ${pad("지평", 8)}${padStart("보정 전", 10)}${padStart("보정 후", 10)}${padStart("차이", 10)}`,
  );

  for (let h = 0; h < HORIZONS.length; h += 1) {
    const total = totals[h];
    const horizon = HORIZONS[h];
    if (total === undefined || horizon === undefined || total.n === 0) {
      continue;
    }
    const naive = total.naive / total.n;
    const matched = total.matched / total.n;
    const delta = ((matched / naive - 1) * 100).toFixed(0);

    console.log(
      `   ${pad(`${horizon / 60}분`, 8)}${padStart(`${naive.toFixed(2)}x`, 10)}${padStart(`${matched.toFixed(2)}x`, 10)}${padStart(`${delta}%`, 10)}`,
    );
  }
}

/**
 * 슬라이더 위치별 하루 알림 수. UI가 미리보기로 쓰는 곡선이다.
 *
 * 판정이 배수로 바뀌었으므로 옛 곡선(백분위 기준)은 통째로 못 쓴다.
 * 화면에 "하루 3회"라고 적어 놓고 실제로 30회가 오면 그건 거짓말이다.
 */
function ratioCurve(streams: readonly CrossingStream[]): void {
  console.log("");
  console.log("═".repeat(76));
  console.log("슬라이더 위치별 하루 알림 수 (배수 판정, 15분 창, 종목 평균)");
  console.log("");
  console.log(
    pad("위치", 8) + padStart("배수", 8) + padStart("하루", 9) + "   종목별",
  );

  const frame = TIMEFRAMES.indexOf(DETECTION_TIMEFRAME);
  const rows: { position: number; ratio: number; perDay: number }[] = [];

  for (let position = 5; position <= 100; position += 5) {
    const ratio = sliderToRatio(position);
    const perSymbol = streams.map((stream) => {
      const result = evaluate(stream, {
        sensitivity: 0,
        ratioThreshold: ratio,
        eventGapSeconds: EVENT_GAP_SECONDS,
        cooldownScale: 1,
        tightening: TIGHTENING,
        onlyFrame: frame,
      });
      return result.alertsPerDay;
    });

    const perDay = perSymbol.reduce((s, v) => s + v, 0) / perSymbol.length;
    rows.push({ position, ratio, perDay });

    console.log(
      pad(String(position), 8) +
        padStart(`${ratio}x`, 8) +
        padStart(perDay.toFixed(2), 9) +
        "   " +
        perSymbol.map((v) => v.toFixed(1).padStart(6)).join(""),
    );
  }

  console.log("");
  console.log("상수로 넣을 형태 (CHANNEL_RATE_CURVE):");
  console.log(
    JSON.stringify(rows.map((r) => Math.round(r.perDay * 100) / 100)),
  );
}

/**
 * 사용자 라벨을 정답으로 놓고 설정을 채점한다.
 *
 * 지금까지의 측정은 전부 알고리즘이 스스로 만든 잣대였다. 이건 처음으로
 * 바깥에서 온 기준이다 — 사용자가 차트에 직접 표시한 "이 정도면 알림".
 *
 * 고친 판정(사건 경계)과 옛 판정(고정 스로틀)을 나란히 낸다. 알림 수만
 * 보면 옛 쪽이 적어서 좋아 보일 수 있는데, 정작 무엇을 놓쳤는지는
 * 재현율에서만 드러난다.
 */
async function labelFit(
  dataDir: string,
  streams: readonly CrossingStream[],
  manifest: Awaited<ReturnType<typeof loadManifest>>,
): Promise<void> {
  console.log("");
  console.log("═".repeat(78));
  console.log(
    `라벨 기준 채점 · 정답 = 15분봉 거래대금 ≥ 직전 32봉 중앙값 ×${LABEL_RATIO}`,
  );

  const sliders = [1, 8, 16, 26, 36, 43, 56, 72];
  const events = new Map<string, LabelEvent[]>();
  const reference = new Map<string, ReturnType<typeof measureTrailingReference>>();

  console.log("");
  console.log("정답 사건 수 / 기준을 그대로 구현했을 때(상한)");
  console.log(
    pad("종목", 10) +
      padStart("사건", 7) +
      padStart("하루", 7) +
      "   │" +
      padStart("알림/일", 9) +
      padStart("재현율", 8) +
      padStart("정밀도", 8) +
      padStart("지연", 8),
  );

  for (const stream of streams) {
    const series = await loadSymbol(dataDir, stream.symbol, manifest);
    const list = buildLabelEvents(series.volumes);
    events.set(stream.symbol, list);

    // 사용자 기준을 중간 단계 없이 그대로 옮긴 규칙. 이게 못 잡는 것은
    // 우리 점수 방식을 고쳐도 못 잡는다.
    const ref = measureTrailingReference(series.volumes, list, stream.measuredDays, {
      ratioThreshold: LABEL_RATIO,
      eventGapSeconds: 300,
    });
    reference.set(stream.symbol, ref);

    console.log(
      pad(stream.symbol.replace("USDT", ""), 10) +
        padStart(String(list.length), 7) +
        padStart((list.length / stream.measuredDays).toFixed(2), 7) +
        "   │" +
        padStart(ref.alertsPerDay.toFixed(1), 9) +
        padStart(`${(ref.recall * 100).toFixed(0)}%`, 8) +
        padStart(`${(ref.precision * 100).toFixed(0)}%`, 8) +
        padStart(`${ref.latencyMedian.toFixed(0)}초`, 8),
    );
  }

  for (const stream of streams) {
    const list = events.get(stream.symbol);
    if (list === undefined || list.length === 0) {
      continue;
    }

    console.log("");
    console.log(`── ${stream.symbol} ──`);
    console.log(
      pad("슬라이더", 10) +
        pad("사건간격", 10) +
        padStart("알림/일", 9) +
        padStart("재현율", 9) +
        padStart("정밀도", 9) +
        padStart("놓친배수", 10) +
        padStart("지연", 9),
    );

    for (const slider of sliders) {
      const sensitivity = sliderToPercentile(slider);
      if (sensitivity < MIN_PERCENTILE) {
        continue;
      }

      for (const gap of EVENT_GAPS) {
        const fit = measureFit(stream, list, {
          sensitivity,
          eventGapSeconds: gap,
          cooldownScale: 1,
          tightening: TIGHTENING,
        });

        console.log(
          pad(String(slider), 10) +
            pad(`${gap}초`, 10) +
            padStart(fit.alertsPerDay.toFixed(1), 9) +
            padStart(`${(fit.recall * 100).toFixed(0)}%`, 9) +
            padStart(`${(fit.precision * 100).toFixed(0)}%`, 9) +
            padStart(fit.missedPeakMedian.toFixed(1), 10) +
            padStart(`${fit.latencyMedian.toFixed(0)}초`, 9),
        );
      }
    }
  }

  // ---- 배수 판정 ----
  //
  // 사용자가 쓰는 잣대를 그대로 판정 기준으로 놓아 본다. 프레임도 하나만
  // 쓴다 — 프레임 격리에서 15분 단독이 6프레임 최댓값보다 나았기 때문이다.
  console.log("");
  console.log("── 배수 판정 (프레임 격리, 사건간격 300초) ──");
  console.log(
    pad("종목", 9) +
      pad("프레임", 8) +
      pad("배수", 7) +
      padStart("알림/일", 9) +
      padStart("재현율", 9) +
      padStart("정밀도", 9) +
      padStart("지연", 9),
  );

  for (const stream of streams) {
    const list = events.get(stream.symbol);
    if (list === undefined || list.length === 0) {
      continue;
    }
    for (const frame of [1, 2, 3]) {
      for (const ratio of [3, 4, 5, 6]) {
        const fit = measureFit(stream, list, {
          sensitivity: 0,
          ratioThreshold: ratio,
          eventGapSeconds: 300,
          cooldownScale: 1,
          tightening: TIGHTENING,
          onlyFrame: frame,
        });
        console.log(
          pad(stream.symbol.replace("USDT", ""), 9) +
            pad(TIMEFRAMES[frame] ?? "?", 8) +
            pad(`${ratio}x`, 7) +
            padStart(fit.alertsPerDay.toFixed(1), 9) +
            padStart(`${(fit.recall * 100).toFixed(0)}%`, 9) +
            padStart(`${(fit.precision * 100).toFixed(0)}%`, 9) +
            padStart(`${fit.latencyMedian.toFixed(0)}초`, 9),
        );
      }
    }
  }

  // ---- 프레임별 적합도 ----
  //
  // 지금은 6개 프레임의 백분위 중 최댓값으로 판정한다. 프레임마다 점수가
  // 흔들리는 정도가 달라서, 같은 임계를 놓으면 가장 요동치는 프레임(1분)이
  // 늘 이긴다. 실제로 실시간 알림 10건의 규모가 전부 1분·5분이었다.
  //
  // 사용자 기준은 15분봉이다. 프레임을 하나씩 격리해서 어느 것이 그 기준과
  // 맞는지 본다. 15분 프레임 단독이 전체 최댓값보다 낫다면, 다중 프레임
  // 최댓값 자체가 문제라는 뜻이다.
  console.log("");
  console.log("── 프레임 격리 (BTC, 사건간격 300초) ──");
  console.log(
    pad("프레임", 9) +
      pad("슬라이더", 10) +
      padStart("알림/일", 9) +
      padStart("재현율", 9) +
      padStart("정밀도", 9),
  );

  const btc = streams.find((s) => s.symbol === "BTCUSDT");
  const btcEvents = btc === undefined ? undefined : events.get(btc.symbol);

  if (btc !== undefined && btcEvents !== undefined) {
    for (let frame = 0; frame < TIMEFRAMES.length; frame += 1) {
      for (const slider of [26, 43, 56, 72]) {
        const fit = measureFit(btc, btcEvents, {
          sensitivity: sliderToPercentile(slider),
          eventGapSeconds: 300,
          cooldownScale: 1,
          tightening: TIGHTENING,
          onlyFrame: frame,
        });
        console.log(
          pad(TIMEFRAMES[frame] ?? "?", 9) +
            pad(String(slider), 10) +
            padStart(fit.alertsPerDay.toFixed(1), 9) +
            padStart(`${(fit.recall * 100).toFixed(0)}%`, 9) +
            padStart(`${(fit.precision * 100).toFixed(0)}%`, 9),
        );
      }
    }
  }

  // ---- 고치기 전과의 비교 ----
  //
  // 옛 판정은 900초 스로틀이었으므로 그 값으로 재현해야 한다. 새 판정의
  // 사건 간격 300초와 숫자를 맞추면 비교가 되지 않는다.
  console.log("");
  console.log("── 판정 방식 비교 (옛=900초 스로틀 / 새=300초 사건간격) ──");
  console.log(
    pad("종목", 10) +
      pad("슬라이더", 10) +
      pad("방식", 12) +
      padStart("알림/일", 9) +
      padStart("재현율", 9) +
      padStart("정밀도", 9),
  );

  for (const stream of streams) {
    const list = events.get(stream.symbol);
    if (list === undefined || list.length === 0) {
      continue;
    }
    for (const slider of [26, 43]) {
      for (const legacy of [true, false]) {
        const fit = measureFit(stream, list, {
          sensitivity: sliderToPercentile(slider),
          eventGapSeconds: legacy ? 900 : 300,
          cooldownScale: 1,
          tightening: TIGHTENING,
          legacyThrottle: legacy,
        });
        console.log(
          pad(stream.symbol.replace("USDT", ""), 10) +
            pad(String(slider), 10) +
            pad(legacy ? "옛(스로틀)" : "새(사건)", 12) +
            padStart(fit.alertsPerDay.toFixed(1), 9) +
            padStart(`${(fit.recall * 100).toFixed(0)}%`, 9) +
            padStart(`${(fit.precision * 100).toFixed(0)}%`, 9),
        );
      }
    }
  }
}

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = path.resolve(here, "../../../data/prepared");
  const cacheDir = path.resolve(here, "../../../data/crossings");

  const manifest = await loadManifest(dataDir);
  const symbols = symbolsIn(manifest);

  console.log(
    `1단계 · 교차 추출 (백분위 ${MIN_PERCENTILE} 이상, 거래대금 하한 없음)`,
  );

  const streams: CrossingStream[] = [];
  for (const symbol of symbols) {
    streams.push(await getStream(dataDir, cacheDir, symbol, manifest));
  }

  console.log("");
  console.log(`2단계 · 파라미터 스윕 (${streams[0]?.measuredDays.toFixed(0)}일 측정)`);


  // 단계를 골라 돌릴 수 있게 한다. 전부 돌리면 오래 걸리는데, 판정 로직을
  // 고치는 동안에는 라벨 채점만 반복해서 보게 된다.
  //   pnpm --filter @flare-alert/backtest start label
  const stage = process.argv[2] ?? "all";

  if (stage === "all" || stage === "curve") {
    ratioCurve(streams);
  }
  if (stage === "all" || stage === "label") {
    await labelFit(dataDir, streams, manifest);
  }
  if (stage === "all" || stage === "quality") {
    await alertQuality(dataDir, streams, manifest);
  }
  if (stage === "all" || stage === "turnover") {
    // 1분과 5분을 같이 본다. 1분에서는 소형주의 기준선이 0이라 측정이
    // 안 되는데, 정작 거래대금 하한이 존재하는 이유가 그 소형주다.
    await turnoverFloor(dataDir, streams, manifest, 0);
    await turnoverFloor(dataDir, streams, manifest, 1);
  }
  if (stage === "all" || stage === "hour") {
    await hourConfound(dataDir, streams, manifest);
  }
}

main().catch((error: unknown) => {
  console.error("백테스트 실패", error);
  process.exit(1);
});
