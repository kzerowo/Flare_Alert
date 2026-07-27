// 바이낸스 공개 데이터 덤프에서 1초 kline 월별 zip을 내려받는다.
//
// 실시간 감지는 aggTrade를 쓰지만, 과거 데이터는 1초 kline이 같은 해상도를
// 훨씬 싸게 준다 (BTCUSDT 기준 월 68MB vs aggTrade 475MB).
//
// 사용법:
//   node scripts/fetch-klines.mjs
//   node scripts/fetch-klines.mjs --symbols BTCUSDT,ETHUSDT --months 2026-06

import { createWriteStream } from "node:fs";
import { mkdir, stat, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://data.binance.vision/data/spot/monthly/klines";

// 유동성 스펙트럼을 넓게 잡는다. 같은 민감도 설정이 종목 규모와 무관하게
// 작동하는지 보려면 대형만 모아두면 안 된다.
const DEFAULT_SYMBOLS = [
  "BTCUSDT", // 대형
  "ETHUSDT", // 대형
  "SOLUSDT", // 중형
  "LINKUSDT", // 중형
  "ANKRUSDT", // 소형
  "ONEUSDT", // 소형
];

const DEFAULT_MONTHS = ["2026-04", "2026-05", "2026-06"];

const DOWNLOAD_CONCURRENCY = 3;

function parseArgs(argv) {
  const args = { symbols: DEFAULT_SYMBOLS, months: DEFAULT_MONTHS };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) {
      continue;
    }
    if (flag === "--symbols") {
      args.symbols = value.split(",").map((s) => s.trim().toUpperCase());
      i += 1;
    } else if (flag === "--months") {
      args.months = value.split(",").map((s) => s.trim());
      i += 1;
    }
  }

  return args;
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 이미 받아둔 파일이면 건너뛴다. 중간에 끊긴 파일은 지우고 다시 받는다. */
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
    if (!response.ok) {
      return null;
    }
    const raw = response.headers.get("content-length");
    if (raw === null) {
      return null;
    }
    return Number.parseInt(raw, 10);
  } catch {
    return null;
  }
}

async function downloadOne(job) {
  const { url, filePath, label } = job;

  const expectedSize = await headContentLength(url);

  if (await alreadyDownloaded(filePath, expectedSize)) {
    console.log(`  = ${label} (이미 있음)`);
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

  const { rename } = await import("node:fs/promises");
  await rename(tempPath, filePath);

  const info = await stat(filePath);
  console.log(`  + ${label} ${formatMb(info.size)}`);
  return { label, skipped: false, bytes: info.size };
}

/** 동시 실행 수를 제한한 워커 풀. 덤프 서버에 과하게 붙지 않기 위해서다. */
async function runPool(jobs, concurrency, worker) {
  const results = [];
  let cursor = 0;

  async function runWorker() {
    while (cursor < jobs.length) {
      const index = cursor;
      cursor += 1;
      const job = jobs[index];
      try {
        results.push(await worker(job));
      } catch (error) {
        console.error(`  ! ${job.label} 실패: ${error.message}`);
        results.push({ label: job.label, failed: true, bytes: 0 });
      }
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
  const { symbols, months } = parseArgs(process.argv.slice(2));

  const here = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = path.resolve(here, "../../../data/klines");
  await mkdir(dataDir, { recursive: true });

  const jobs = [];
  for (const symbol of symbols) {
    for (const month of months) {
      const fileName = `${symbol}-1s-${month}.zip`;
      jobs.push({
        label: fileName,
        url: `${BASE_URL}/${symbol}/1s/${fileName}`,
        filePath: path.join(dataDir, fileName),
      });
    }
  }

  console.log(`대상: ${symbols.length}종목 × ${months.length}개월 = ${jobs.length}개 파일`);
  console.log(`저장 위치: ${dataDir}`);
  console.log("");

  const started = Date.now();
  const results = await runPool(jobs, DOWNLOAD_CONCURRENCY, downloadOne);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const failed = results.filter((r) => r.failed === true);
  const totalBytes = results.reduce((sum, r) => sum + r.bytes, 0);

  console.log("");
  console.log(`완료: ${results.length - failed.length}/${jobs.length}, ${formatMb(totalBytes)}, ${elapsed}초`);

  if (failed.length > 0) {
    console.error(`실패 ${failed.length}건: ${failed.map((r) => r.label).join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("다운로드 실패", error);
  process.exit(1);
});
