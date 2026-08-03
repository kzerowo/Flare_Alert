// 바이낸스 USD-M 선물 aggTrades 일별 zip을 내려받는다.
//
// 현물이 아니라 선물을 쓰는 이유는 apps/detector/src/binance.ts 상단 주석 참고.
// 요약하면, 사용자가 직접 표시한 라벨을 현물 데이터로는 어떤 기준선으로도
// 재현할 수 없었고 선물로 바꾸자 전부 상위권에 들어왔다.
//
// 왜 aggTrades인가: 선물에는 1초 kline 덤프가 없다. 가장 잘게 나온 kline이
// 1분이라 60배 거칠어서, 매초 평가하는 판정을 재현할 수 없다. aggTrades는
// 체결 하나하나가 다 들어 있어 1초봉보다 오히려 해상도가 높고, detector가
// 실시간으로 받는 것과 같은 데이터다.
//
// 왜 일별인가: 월별 zip은 종목·월당 668MB인데 일별은 평균 7MB다. 나눠 받으면
// 중간에 끊겨도 그 날짜만 다시 받으면 되고, 진행 상황도 보인다.
//
// 사용법:
//   node scripts/fetch-futures.mjs
//   node scripts/fetch-futures.mjs --symbols BTCUSDT --from 2026-07-01 --to 2026-07-31

import { createWriteStream } from "node:fs";
import { mkdir, stat, rm, rename } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://data.binance.vision/data/futures/um/daily/aggTrades";

const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

// 완결된 달만 받는다. 달 중간까지만 받으면 나머지 날이 거래대금 0으로
// 남아, 기준선 중앙값이 실제보다 낮아지고 모든 배수가 부풀려진다.
const DEFAULT_FROM = "2026-06-01";
const DEFAULT_TO = "2026-07-31";

const DOWNLOAD_CONCURRENCY = 4;

function formatMb(bytes) {
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

function parseArgs(argv) {
  const args = {
    symbols: DEFAULT_SYMBOLS,
    from: DEFAULT_FROM,
    to: DEFAULT_TO,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) continue;
    if (flag === "--symbols") {
      args.symbols = value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      i += 1;
    } else if (flag === "--from") {
      args.from = value;
      i += 1;
    } else if (flag === "--to") {
      args.to = value;
      i += 1;
    }
  }

  return args;
}

/** from~to를 YYYY-MM-DD 문자열 배열로 편다. 양 끝 포함. */
function expandDates(from, to) {
  const out = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error(`날짜 형식이 잘못됐습니다: ${from} ~ ${to}`);
  }
  for (let t = start; t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

async function alreadyDownloaded(filePath, expectedSize) {
  try {
    const info = await stat(filePath);
    if (expectedSize !== null && info.size !== expectedSize) {
      await rm(filePath, { force: true });
      return false;
    }
    return info.size > 0;
  } catch {
    return false;
  }
}

async function headContentLength(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) return null;
    const raw = response.headers.get("content-length");
    return raw === null ? null : Number.parseInt(raw, 10);
  } catch {
    return null;
  }
}

async function downloadOne(job) {
  const { url, filePath, label } = job;

  const expectedSize = await headContentLength(url);

  if (await alreadyDownloaded(filePath, expectedSize)) {
    return { label, skipped: true, bytes: expectedSize ?? 0 };
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status}`);
  }
  if (response.body === null) {
    throw new Error(`${label}: 응답 본문이 비어 있습니다`);
  }

  // 중간에 죽어도 완성본으로 오인하지 않도록 임시 파일에 받고 마지막에 옮긴다.
  const tempPath = `${filePath}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath));
  await rename(tempPath, filePath);

  const info = await stat(filePath);
  return { label, skipped: false, bytes: info.size };
}

/** 동시 실행 수를 제한한 워커 풀. 덤프 서버에 과하게 붙지 않기 위해서다. */
async function runPool(jobs, concurrency, worker, onProgress) {
  const results = [];
  let cursor = 0;

  async function runWorker() {
    while (cursor < jobs.length) {
      const index = cursor;
      cursor += 1;
      let r;
      try {
        r = await worker(jobs[index]);
      } catch (error) {
        r = { label: jobs[index].label, failed: true, bytes: 0, error: error.message };
      }
      results.push(r);
      // 진행 표시에서 난 오류가 다운로드 실패로 둔갑하지 않도록 try 밖에 둔다.
      onProgress(results.length, jobs.length, r);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, jobs.length); i += 1) {
    workers.push(runWorker());
  }
  await Promise.all(workers);

  return results;
}

async function main() {
  const { symbols, from, to } = parseArgs(process.argv.slice(2));
  const dates = expandDates(from, to);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = path.resolve(here, "../../../data/futures-aggtrades");
  await mkdir(dataDir, { recursive: true });

  const jobs = [];
  for (const symbol of symbols) {
    for (const date of dates) {
      const fileName = `${symbol}-aggTrades-${date}.zip`;
      jobs.push({
        label: fileName,
        url: `${BASE_URL}/${symbol}/${fileName}`,
        filePath: path.join(dataDir, fileName),
      });
    }
  }

  console.log(
    `선물 aggTrades · ${symbols.length}종목 × ${dates.length}일 = ${jobs.length}개 파일`,
  );
  console.log(`구간: ${from} ~ ${to}`);
  console.log(`저장 위치: ${dataDir}`);
  console.log("");

  const started = Date.now();
  let lastReport = 0;
  let bytes = 0;

  const results = await runPool(jobs, DOWNLOAD_CONCURRENCY, downloadOne, (done, total, r) => {
    if (r.failed === true) {
      console.log(`  ! ${r.label} 실패: ${r.error}`);
      return;
    }
    bytes += r.bytes ?? 0;
    // 파일마다 한 줄씩 내면 수백 줄이 된다. 일정 간격으로 진행률만 낸다.
    const now = Date.now();
    if (done === total || now - lastReport > 15_000) {
      lastReport = now;
      const pct = ((done / total) * 100).toFixed(0);
      const elapsed = (now - started) / 1000;
      const eta = done > 0 ? (elapsed / done) * (total - done) : 0;
      console.log(
        `  ${String(done).padStart(4)}/${total}  ${pct.padStart(3)}%  ` +
          `${formatMb(bytes)}  경과 ${elapsed.toFixed(0)}초  남은시간 약 ${eta.toFixed(0)}초`,
      );
    }
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const failed = results.filter((r) => r.failed === true);
  const totalBytes = results.reduce((sum, r) => sum + (r.bytes ?? 0), 0);

  console.log("");
  console.log(
    `완료: ${results.length - failed.length}/${jobs.length}, ${formatMb(totalBytes)}, ${elapsed}초`,
  );
  if (failed.length > 0) {
    console.log(`실패 ${failed.length}개:`);
    for (const f of failed.slice(0, 20)) {
      console.log(`  ${f.label}: ${f.error}`);
    }
  }
}

main().catch((error) => {
  console.error("다운로드 실패", error);
  process.exit(1);
});
