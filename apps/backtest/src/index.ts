// 백테스트 진입점.
//
// 1단계: 1초 시계열을 리플레이해서 임계 교차를 뽑아 캐시한다 (무겁다).
// 2단계: 캐시된 교차에 쿨다운·병합 파라미터 조합을 훑는다 (가볍다).
//
// 사용법: pnpm --filter @flare-alert/backtest start

import path from "node:path";
import { fileURLToPath } from "node:url";

import { MIN_QUOTE_VOLUME, TIMEFRAMES } from "@flare-alert/core";

import { loadCrossings, saveCrossings } from "./crossings.js";
import type { CrossingStream } from "./crossings.js";
import { evaluate } from "./engine.js";
import { measureChannelCurve, measureScaleMarkers } from "./event-scale.js";
import { loadManifest, loadSymbol, symbolsIn } from "./data.js";
import { extractCrossings } from "./replay.js";

/** 스윕에서 쓸 가장 낮은 민감도. 교차 스트림은 이 아래를 담지 않는다. */
const MIN_PERCENTILE = 89;

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
    minQuoteVolume: MIN_QUOTE_VOLUME.binance,
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

/** 사건 규모별로 필요한 민감도. 슬라이더 눈금의 근거다. */
function scaleMarkers(streams: readonly CrossingStream[]): void {
  console.log("");
  console.log("═".repeat(76));
  console.log("사건 규모별 필요 민감도 (규모 = 이상치였던 가장 긴 프레임)");
  console.log("");
  console.log(
    pad("규모", 10) +
      padStart("필요 백분위", 14) +
      padStart("슬라이더", 10) +
      padStart("사건 수", 10),
  );

  for (const marker of measureScaleMarkers(streams)) {
    console.log(
      pad(marker.timeframe, 10) +
        padStart(marker.percentile.toFixed(3), 14) +
        padStart(String(marker.sliderPosition), 10) +
        padStart(marker.eventCount.toLocaleString(), 10),
    );
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

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = path.resolve(here, "../../../data/prepared");
  const cacheDir = path.resolve(here, "../../../data/crossings");

  const manifest = await loadManifest(dataDir);
  const symbols = symbolsIn(manifest);

  console.log(
    `1단계 · 교차 추출 (백분위 ${MIN_PERCENTILE} 이상, ` +
      `거래대금 하한 ${MIN_QUOTE_VOLUME.binance.toLocaleString()} USDT)`,
  );

  const streams: CrossingStream[] = [];
  for (const symbol of symbols) {
    streams.push(await getStream(dataDir, cacheDir, symbol, manifest));
  }

  console.log("");
  console.log(`2단계 · 파라미터 스윕 (${streams[0]?.measuredDays.toFixed(0)}일 측정)`);

  sweep(streams);
  scaleMarkers(streams);
  channelCurve(streams);
}

main().catch((error: unknown) => {
  console.error("백테스트 실패", error);
  process.exit(1);
});
