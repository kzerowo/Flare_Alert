// 사용자가 차트에 표시한 구간을 분 단위로 펼쳐 본다.
//
// 라벨 작업은 스크린샷으로 온다. 15분 눈금 사이의 표시가 몇 분인지 픽셀로
// 추측하면 1분봉 채점에서 통째로 다른 봉을 채점하게 되므로, 실제 데이터를
// 불러와 표로 만들고 그 위에서 맞춘다.
//
// 왜 REST인가: 백테스트 데이터(data/prepared)는 월별 덤프라 이번 달치가
// 없다. 바이낸스 공개 REST는 인증 없이 최근 봉을 바로 준다. 1분봉 라벨을
// 채점하는 데는 1분 해상도면 충분하다.
//
// 두 가지 기준선을 나란히 낸다. 어느 쪽이 사용자의 표시와 맞는지가
// 이 도구의 존재 이유다.
//
//   중앙값60 — 지금 알고리즘. 직전 60분의 중앙값. 한 시간 내내 거의 안 움직인다.
//   이동평균20 — 차트가 그려 주는 선. 최근 20분 평균. 계속 오르내린다.
//
// 사용법:
//   node scripts/label-window.mjs --start "2026-07-30T04:29:00Z" --before 60 --after 75
//   node scripts/label-window.mjs --start "2026-07-30 13:29 KST" --before 60 --after 75

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// USD-M 선물. 현물이 아니다 — 사용자가 보는 차트가 선물이다.
const API = "https://fapi.binance.com/fapi/v1/klines";

/** 직전 몇 분으로 중앙값 기준선을 만드는가. LOOKBACK_WINDOW_COUNT["1m"]와 맞춘다. */
const MEDIAN_LOOKBACK = 60;

/** 차트의 거래량 이동평균 기간. 트레이딩뷰 기본값이 20이다. */
const MA_LOOKBACK = 20;

function parseArgs(argv) {
  const args = {
    symbol: "BTCUSDT",
    start: null,
    before: MEDIAN_LOOKBACK,
    after: 75,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) {
      continue;
    }
    if (flag === "--symbol") {
      args.symbol = value.toUpperCase();
      i += 1;
    } else if (flag === "--start") {
      args.start = value;
      i += 1;
    } else if (flag === "--before") {
      args.before = Number(value);
      i += 1;
    } else if (flag === "--after") {
      args.after = Number(value);
      i += 1;
    }
  }

  return args;
}

/**
 * "2026-07-30 13:29 KST" 같은 형태도 받는다.
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

async function fetchKlines(symbol, startMs, endMs) {
  const out = [];
  let cursor = startMs;

  // 한 번에 1000개가 상한이다. 구간이 길면 이어서 받는다.
  while (cursor < endMs) {
    const url = `${API}?symbol=${symbol}&interval=1m&startTime=${cursor}&endTime=${endMs}&limit=1000`;
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
    cursor = rows[rows.length - 1][0] + 60_000;
  }

  return out;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) {
    return 0;
  }
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
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function pad(text, width) {
  const s = String(text);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
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

  const startMs = parseStart(args.start);
  // 기준선을 만들려면 표시 구간보다 앞을 더 받아야 한다. 여유로 10분 더.
  const fetchFrom = startMs - (args.before + MEDIAN_LOOKBACK + 10) * 60_000;
  const fetchTo = startMs + args.after * 60_000;

  console.log(
    `${args.symbol} · ${kstLabel(startMs)} KST (${new Date(startMs).toISOString()}) 기준`,
  );
  console.log(
    `표시 구간 ${args.before}분 전 ~ ${args.after}분 후, 기준선용으로 ${MEDIAN_LOOKBACK}분 더 받는다.`,
  );

  const klines = await fetchKlines(args.symbol, fetchFrom, fetchTo);
  console.log(`봉 ${klines.length}개 수신`);

  const volumes = klines.map((k) => k.quoteVolume);

  const rows = [];
  for (let i = MEDIAN_LOOKBACK; i < klines.length; i += 1) {
    const value = volumes[i];
    const med = median(volumes.slice(i - MEDIAN_LOOKBACK, i));
    const ma = mean(volumes.slice(i - MA_LOOKBACK, i));

    rows.push({
      openMs: klines[i].openMs,
      kst: kstLabel(klines[i].openMs),
      quoteVolume: value,
      medianBaseline: med,
      maBaseline: ma,
      ratioMedian: med > 0 ? value / med : 0,
      ratioMa: ma > 0 ? value / ma : 0,
    });
  }

  // 표시 구간만 남긴다. 앞쪽은 기준선을 만드는 데만 썼다.
  const visible = rows.filter(
    (r) => r.openMs >= startMs - 5 * 60_000 && r.openMs <= fetchTo,
  );

  // 두 기준의 순위를 매겨 둔다. 사용자가 표시한 것과 어느 쪽이 맞는지
  // 보려면 "이 구간에서 몇 번째로 큰가"가 배수 값보다 읽기 쉽다.
  const byMedian = [...visible].sort((a, b) => b.ratioMedian - a.ratioMedian);
  const byMa = [...visible].sort((a, b) => b.ratioMa - a.ratioMa);
  const rankMedian = new Map(byMedian.map((r, i) => [r.openMs, i + 1]));
  const rankMa = new Map(byMa.map((r, i) => [r.openMs, i + 1]));

  console.log("");
  console.log("═".repeat(72));
  console.log("분 단위 표 (KST). 라벨 대조용.");
  console.log("");
  console.log(
    pad("시각", 8) +
      padStart("거래대금", 14) +
      padStart("중앙값60배", 12) +
      padStart("순위", 6) +
      padStart("이평20배", 11) +
      padStart("순위", 6),
  );

  for (const row of visible) {
    console.log(
      pad(row.kst, 8) +
        padStart(Math.round(row.quoteVolume).toLocaleString(), 14) +
        padStart(`${row.ratioMedian.toFixed(2)}x`, 12) +
        padStart(String(rankMedian.get(row.openMs)), 6) +
        padStart(`${row.ratioMa.toFixed(2)}x`, 11) +
        padStart(String(rankMa.get(row.openMs)), 6),
    );
  }

  // 두 기준이 상위 N개로 서로 다른 봉을 고르는지 본다. 완전히 같다면
  // 기준선 논쟁 자체가 의미 없고, 갈린다면 그 갈린 봉들이 판정의 근거가 된다.
  console.log("");
  console.log("═".repeat(72));
  console.log("두 기준이 고르는 상위 10개 비교");
  console.log("");
  console.log(pad("순위", 6) + pad("중앙값60 기준", 22) + "이동평균20 기준");

  for (let i = 0; i < 10; i += 1) {
    const a = byMedian[i];
    const b = byMa[i];
    console.log(
      pad(String(i + 1), 6) +
        pad(a === undefined ? "" : `${a.kst}  ${a.ratioMedian.toFixed(2)}x`, 22) +
        (b === undefined ? "" : `${b.kst}  ${b.ratioMa.toFixed(2)}x`),
    );
  }

  const topMedian = new Set(byMedian.slice(0, 10).map((r) => r.kst));
  const topMa = new Set(byMa.slice(0, 10).map((r) => r.kst));
  const shared = [...topMedian].filter((k) => topMa.has(k));
  console.log("");
  console.log(`상위 10개 중 겹치는 것: ${shared.length}개 (${shared.join(", ")})`);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.resolve(here, "../../../data/labels");
  await mkdir(outDir, { recursive: true });

  const stamp = new Date(startMs).toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(outDir, `${args.symbol}-${stamp}.json`);
  await writeFile(
    outFile,
    `${JSON.stringify({ symbol: args.symbol, startMs, medianLookback: MEDIAN_LOOKBACK, maLookback: MA_LOOKBACK, rows: visible }, null, 2)}\n`,
  );

  console.log("");
  console.log(`저장: ${path.relative(process.cwd(), outFile)}`);
}

main().catch((error) => {
  console.error("실패:", error.message);
  process.exit(1);
});
