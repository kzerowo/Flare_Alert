// 백테스트 진입점.
//
// 1단계: 1초 시계열을 리플레이해서 임계 교차를 뽑아 캐시한다 (무겁다).
// 2단계: 캐시된 교차에 쿨다운·병합 파라미터 조합을 훑는다 (가볍다).
//
// 사용법: pnpm --filter @flare-alert/backtest start

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FRAME_MERGE_WINDOW_SECONDS,
  FRAME_SCALE_PERCENTILE,
  MIN_QUOTE_VOLUME,
  SENSITIVITY_DEFAULT,
  TIMEFRAMES,
  percentileToSlider,
} from "@flare-alert/core";

import { loadCrossings, saveCrossings } from "./crossings.js";
import type { CrossingStream } from "./crossings.js";
import { evaluate } from "./engine.js";
import { measureChannelCurve, measureScaleMarkers } from "./event-scale.js";
import { loadManifest, loadPrices, loadSymbol, symbolsIn } from "./data.js";
import { HORIZONS, buildBaseline, measureQuality } from "./quality.js";
import { measureTurnover } from "./turnover.js";
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

// 99 위쪽을 같이 본다. 초 단위 평가에서는 상위 1%도 하루 5천 번 넘게
// 발생하므로, 실제로 쓸 만한 구간이 99~100 사이에 몰려 있을 수 있다.
const SENSITIVITIES = [95, 99, 99.5, 99.9];
const WARMUP_DAYS = 30;

/** 훑을 파라미터 조합. */
const MERGE_WINDOWS = [60, 300, 900, 1800];
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
      pad("병합창", 9) +
      pad("쿨다운", 9) +
      streams.map((s) => padStart(s.symbol.replace("USDT", ""), 9)).join("") +
      padStart("평균", 9);
    console.log(header);

    for (const mergeWindow of MERGE_WINDOWS) {
      for (const scale of COOLDOWN_SCALES) {
        const results = streams.map((stream) =>
          evaluate(stream, {
            sensitivity,
            mergeWindowSeconds: mergeWindow,
            cooldownScale: scale,
            tightening: TIGHTENING,
          }),
        );

        const average =
          results.reduce((sum, r) => sum + r.alertsPerDay, 0) / results.length;

        console.log(
          pad(`${mergeWindow}초`, 9) +
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
        mergeWindowSeconds: FRAME_MERGE_WINDOW_SECONDS,
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
          mergeWindowSeconds: FRAME_MERGE_WINDOW_SECONDS,
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
): Promise<void> {
  console.log("");
  console.log("═".repeat(76));
  console.log("거래대금 하한 · 구간별 알림 품질 (1분 지평)");
  console.log("");
  console.log(
    `현재 값 ${MIN_QUOTE_VOLUME.binance.toLocaleString()} USDT는 근거 없이 정해진 값이다.`,
  );
  console.log("배수가 1.0 근처인 구간은 알림에 정보가 없다는 뜻이다.");

  // 구간별 합계. 종목을 가로질러 모은다.
  const totals = new Map<string, { alerts: number; lift: number; n: number }>();

  for (const stream of streams) {
    const prices = await loadPrices(dataDir, stream.symbol, manifest);
    const built = buildBaseline(prices, WARMUP_DAYS * 86_400, 20_000, 20260729);

    const report = measureTurnover(stream, prices, built.baseline, {
      sensitivity: SENSITIVITY_DEFAULT,
      mergeWindowSeconds: FRAME_MERGE_WINDOW_SECONDS,
      cooldownScale: 3,
      tightening: TIGHTENING,
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


  await alertQuality(dataDir, streams, manifest);
  await turnoverFloor(dataDir, streams, manifest);
}

main().catch((error: unknown) => {
  console.error("백테스트 실패", error);
  process.exit(1);
});
