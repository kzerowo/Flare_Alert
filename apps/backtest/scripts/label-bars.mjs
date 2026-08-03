// 사용자가 라벨링할 봉을 표로 펼친다. 1분봉 말고 임의의 봉 길이를 받는다.
//
// label-window.mjs가 1분봉 전용이라 5분·15분봉 라벨을 받을 수 없었다.
// 스크린샷의 봉 하나가 몇 시 몇 분인지 픽셀로 추측하면 통째로 다른 봉을
// 채점하게 되므로, 실제 데이터를 표로 만들고 그 위에서 맞춘다.
//
// 각 봉마다 "지금 알고리즘이 이 봉을 몇 배로 보는가"를 룩백별로 같이 낸다.
// 사용자가 ★를 찍은 줄의 배수를 보면, 임계를 얼마로 내려야 그 봉이 잡히는지
// 바로 읽을 수 있다.
//
// 세 가지 기준선을 나란히 낸다. 어느 쪽이 사용자의 표시와 맞는지가
// 이 도구의 존재 이유다.
//
//   중앙값N  — 지금 알고리즘. LOOKBACK_WINDOW_COUNT를 그대로 쓴다.
//   중앙값10 — 사용자가 말한 "직전 10봉".
//   이동평균10 — 차트가 그려 주는 선에 가까운 쪽.
//
// 사용법:
//   node scripts/label-bars.mjs --tf 5m --start "2026-08-03 20:00 KST" --bars 40
//   node scripts/label-bars.mjs --tf 5m --start "2026-08-03 20:00 KST" --bars 40 --csv

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// USD-M 선물. 현물이 아니다 — 사용자가 보는 차트가 선물이고, 라벨 채점에서
// 두 시장이 전혀 다른 답을 냈다 (apps/detector/src/binance.ts 상단 주석 참고).
const API = "https://fapi.binance.com/fapi/v1/klines";

/** packages/core의 LOOKBACK_WINDOW_COUNT와 맞춘다. */
const LOOKBACK = { "1m": 60, "5m": 48, "15m": 32, "1h": 24, "4h": 18 };

/** 사용자가 짐작한 표본 수. 비교 대상이다. */
const SHORT_LOOKBACK = 10;

const MINUTES = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240 };

function parseArgs(argv) {
  const args = { symbol: "BTCUSDT", tf: "5m", start: null, bars: 40, csv: false };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--csv") {
      args.csv = true;
      continue;
    }
    if (value === undefined) {
      continue;
    }
    if (flag === "--symbol") {
      args.symbol = value.toUpperCase();
      i += 1;
    } else if (flag === "--tf") {
      args.tf = value;
      i += 1;
    } else if (flag === "--start") {
      args.start = value;
      i += 1;
    } else if (flag === "--bars") {
      args.bars = Number(value);
      i += 1;
    }
  }

  return args;
}

/**
 * "2026-08-03 20:00 KST" 같은 형태도 받는다.
 *
 * 사용자는 한국시간으로 차트를 본다. UTC로 바꿔 적으라고 하면 그 변환에서
 * 실수가 나고, 그 실수는 조용히 결과에 섞인다.
 */
function parseStart(text) {
  const kst = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})\s*KST$/i.exec(text);
  if (kst !== null) {
    return Date.parse(`${kst[1]}T${kst[2]}:${kst[3]}:00+09:00`);
  }
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    throw new Error(`시각을 읽을 수 없습니다: ${text}`);
  }
  return parsed;
}

async function fetchKlines(symbol, interval, startMs, endMs) {
  const out = [];
  let cursor = startMs;

  // 한 번에 1000개가 상한이다. 구간이 길면 이어서 받는다.
  while (cursor < endMs) {
    const url = `${API}?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endMs}&limit=1000`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`바이낸스 응답 ${response.status}`);
    }
    const rows = await response.json();
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      out.push({ openMs: row[0], quoteVolume: Number(row[7]) });
    }
    const step = MINUTES[interval] * 60_000;
    cursor = rows[rows.length - 1][0] + step;
  }

  return out;
}

function median(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function kstLabel(ms) {
  const date = new Date(ms + 9 * 3_600_000);
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

function padStart(text, width) {
  const s = String(text);
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.start === null) {
    console.error("--start 가 필요합니다.");
    process.exit(1);
  }
  if (MINUTES[args.tf] === undefined) {
    console.error(`--tf 는 ${Object.keys(MINUTES).join(" / ")} 중 하나여야 합니다.`);
    process.exit(1);
  }

  const long = LOOKBACK[args.tf];
  const stepMs = MINUTES[args.tf] * 60_000;
  const startMs = parseStart(args.start);

  // 기준선을 만들려면 표시 구간 앞쪽으로 룩백만큼 더 받아야 한다.
  const fromMs = startMs - long * stepMs;
  const toMs = startMs + args.bars * stepMs;

  const bars = await fetchKlines(args.symbol, args.tf, fromMs, toMs);
  if (bars.length <= long) {
    console.error(`봉이 부족합니다 (${bars.length}개, 기준선에 ${long}개 필요)`);
    process.exit(1);
  }

  const rows = [];
  for (let i = long; i < bars.length; i += 1) {
    const bar = bars[i];
    if (bar.openMs < startMs) {
      continue;
    }
    const history = bars.slice(0, i).map((b) => b.quoteVolume);
    const longMed = median(history.slice(-long));
    const shortMed = median(history.slice(-SHORT_LOOKBACK));
    const shortAvg = mean(history.slice(-SHORT_LOOKBACK));

    rows.push({
      openMs: bar.openMs,
      quoteVolume: bar.quoteVolume,
      ratioLong: longMed > 0 ? bar.quoteVolume / longMed : 0,
      ratioShortMed: shortMed > 0 ? bar.quoteVolume / shortMed : 0,
      ratioShortAvg: shortAvg > 0 ? bar.quoteVolume / shortAvg : 0,
    });
  }

  if (args.csv) {
    console.log("time_kst,quote_volume,ratio_median_long,ratio_median_10,ratio_mean_10");
    for (const r of rows) {
      console.log(
        [
          kstLabel(r.openMs),
          Math.round(r.quoteVolume),
          r.ratioLong.toFixed(3),
          r.ratioShortMed.toFixed(3),
          r.ratioShortAvg.toFixed(3),
        ].join(","),
      );
    }
    return;
  }

  console.log(`${args.symbol} ${args.tf}봉 · ${rows.length}개 · 시각은 KST`);
  console.log("");
  console.log("표시할 봉의 시각을 알려 주세요. 배수는 참고용입니다 —");
  console.log("차트를 보고 정하시고, 이 숫자에 맞추려 하지 마세요.");
  console.log("");
  console.log(
    `  ${padStart("시각", 11)}  ${padStart("거래대금", 13)}  ` +
      `${padStart(`중앙값${long}`, 8)}  ${padStart("중앙값10", 8)}  ${padStart("평균10", 8)}   그래프`,
  );

  const peak = Math.max(...rows.map((r) => r.quoteVolume));

  for (const r of rows) {
    const bar = "█".repeat(Math.max(1, Math.round((r.quoteVolume / peak) * 34)));
    console.log(
      `  ${padStart(kstLabel(r.openMs), 11)}  ` +
        `${padStart(Math.round(r.quoteVolume).toLocaleString(), 13)}  ` +
        `${padStart(r.ratioLong.toFixed(2), 8)}  ` +
        `${padStart(r.ratioShortMed.toFixed(2), 8)}  ` +
        `${padStart(r.ratioShortAvg.toFixed(2), 8)}   ${bar}`,
    );
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(here, "..", "..", "..", "data", "labels");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(
    outDir,
    `${args.symbol}-${args.tf}-${new Date(startMs).toISOString().slice(0, 16).replace(/[:T]/g, "")}.json`,
  );
  await writeFile(
    outPath,
    JSON.stringify(
      { symbol: args.symbol, timeframe: args.tf, lookback: long, rows },
      null,
      2,
    ),
  );
  console.log("");
  console.log(`저장: ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
