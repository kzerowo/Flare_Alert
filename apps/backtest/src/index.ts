// 백테스트 진입점.
//
// 1단계: 1초 시계열을 리플레이해서 임계 교차를 뽑아 캐시한다 (무겁다).
// 2단계: 캐시된 교차에 쿨다운·병합 파라미터 조합을 훑는다 (가볍다).
//
// 사용법: pnpm --filter @flare-alert/backtest start

import path from "node:path";
import { fileURLToPath } from "node:url";

import { MIN_QUOTE_VOLUME } from "@flare-alert/core";

import { loadCrossings, saveCrossings } from "./crossings.js";
import type { CrossingStream } from "./crossings.js";
import { evaluate } from "./engine.js";
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

/** 고른 설정에서 프레임별 분포와 신호 강도가 어떻게 나오는지 본다. */
function detail(
  streams: readonly CrossingStream[],
  mergeWindowSeconds: number,
  cooldownScale: number,
): void {
  console.log("");
  console.log("═".repeat(76));
  console.log(
    `선택 설정 상세 · 병합창 ${mergeWindowSeconds}초, 쿨다운 ×${cooldownScale}`,
  );
  console.log("");
  console.log(
    pad("종목", 10) +
      pad("민감도", 8) +
      padStart("하루", 8) +
      padStart("강도", 8) +
      "  대표 프레임",
  );

  for (const stream of streams) {
    for (const sensitivity of SENSITIVITIES) {
      const result = evaluate(stream, {
        sensitivity,
        mergeWindowSeconds,
        cooldownScale,
        tightening: TIGHTENING,
      });

      const frames = Object.entries(result.byPrimaryFrame)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([tf, count]) => {
          const share = (count / Math.max(result.alerts, 1)) * 100;
          return `${tf} ${share.toFixed(0)}%`;
        })
        .join(", ");

      console.log(
        pad(stream.symbol.replace("USDT", ""), 10) +
          pad(String(sensitivity), 8) +
          padStart(result.alertsPerDay.toFixed(1), 8) +
          padStart(result.averageStrength.toFixed(1), 8) +
          `  ${frames}`,
      );
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
  detail(streams, 900, 3);
  detail(streams, 1800, 3);
}

main().catch((error: unknown) => {
  console.error("백테스트 실패", error);
  process.exit(1);
});
