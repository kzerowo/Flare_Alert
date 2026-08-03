// 선물 aggTrades 일별 zip을 리플레이용 이진 형식으로 변환한다.
//
// 출력 형식은 prepare.mjs(현물 1초봉)와 완전히 같다 — 종목·월당 초별
// 거래대금 Float64 배열 하나와 초별 종가 Float32 배열 하나. 그래서
// data.ts / replay.ts는 손대지 않아도 된다.
//
// 다른 점은 입력이다. 현물은 이미 1초로 묶인 kline이 오지만, 선물에는 그게
// 없어서 체결을 직접 1초 버킷에 넣어야 한다. 이 작업은 detector의
// aggregator.ts가 실시간으로 하는 일과 같다 — 즉 백테스트가 프로덕션
// 경로에 더 가까워진다.
//
// 완결되지 않은 달은 버린다. 달 중간까지만 있는 데이터로 배열을 만들면
// 나머지 날이 거래대금 0으로 남고, 그 0들이 기준선 중앙값을 끌어내려
// 모든 배수를 부풀린다. 조용히 틀린 숫자가 나오는 것이 가장 나쁘다.
//
// 사용법: node scripts/prepare-futures.mjs

import { mkdir, readdir, writeFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openZipEntryStream } from "./lib/zip.mjs";

// 선물 aggTrades CSV 컬럼:
//   0=agg_trade_id 1=price 2=quantity 3=first_trade_id
//   4=last_trade_id 5=transact_time 6=is_buyer_maker
const PRICE_COLUMN = 1;
const QUANTITY_COLUMN = 2;
const TIME_COLUMN = 5;

function daysInMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function monthBounds(month) {
  const [yearText, monthText] = month.split("-");
  const year = Number.parseInt(yearText, 10);
  const monthIndex = Number.parseInt(monthText, 10) - 1;

  const startMs = Date.UTC(year, monthIndex, 1);
  const endMs = Date.UTC(year, monthIndex + 1, 1);

  return { startMs, endMs, seconds: (endMs - startMs) / 1000 };
}

/** open_time이 마이크로초인지 밀리초인지 자동 판별한다. */
function normalizeToMs(raw) {
  // 밀리초라면 13자리(약 1.7e12), 마이크로초라면 16자리(약 1.7e15).
  return raw > 1e14 ? Math.floor(raw / 1000) : raw;
}

/**
 * 한 줄에서 가격·수량·시각을 뽑는다.
 *
 * split(",")으로 7개 문자열을 만들면 수천만 줄에서 그 비용이 그대로 쌓인다.
 * 필요한 컬럼까지만 인덱스로 훑는다.
 */
function parseLine(line) {
  let cursor = -1;
  let column = 0;
  let price = Number.NaN;
  let quantity = Number.NaN;

  while (column <= TIME_COLUMN) {
    const next = line.indexOf(",", cursor + 1);
    const end = next < 0 ? line.length : next;

    if (column === PRICE_COLUMN) {
      price = Number(line.slice(cursor + 1, end));
    } else if (column === QUANTITY_COLUMN) {
      quantity = Number(line.slice(cursor + 1, end));
    } else if (column === TIME_COLUMN) {
      const time = Number(line.slice(cursor + 1, end));
      if (!Number.isFinite(time) || !Number.isFinite(price) || !Number.isFinite(quantity)) {
        return null;
      }
      if (price <= 0 || quantity < 0) {
        return null;
      }
      return { timeMs: normalizeToMs(time), price, quantity };
    }

    if (next < 0) return null;
    cursor = next;
    column += 1;
  }

  return null;
}

async function ingestDay(zipPath, bounds, volumes, prices) {
  const { stream } = await openZipEntryStream(zipPath);
  const reader = createInterface({ input: stream, crlfDelay: Infinity });

  let trades = 0;
  let skipped = 0;
  let outOfRange = 0;

  for await (const line of reader) {
    if (line.length === 0) continue;

    const parsed = parseLine(line);
    if (parsed === null) {
      // 헤더 행이 붙어 있는 덤프도 있어서 조용히 넘긴다.
      skipped += 1;
      continue;
    }

    const index = Math.floor((parsed.timeMs - bounds.startMs) / 1000);
    if (index < 0 || index >= volumes.length) {
      outOfRange += 1;
      continue;
    }

    volumes[index] += parsed.price * parsed.quantity;
    // 그 초의 마지막 체결가가 종가다. 파일이 시간순이라 덮어쓰면 된다.
    prices[index] = parsed.price;
    trades += 1;
  }

  return { trades, skipped, outOfRange };
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const inputDir = path.resolve(here, "../../../data/futures-aggtrades");
  const outputDir = path.resolve(here, "../../../data/prepared");

  await mkdir(outputDir, { recursive: true });

  let entries;
  try {
    entries = await readdir(inputDir);
  } catch {
    console.error(`데이터가 없습니다. 먼저 fetch-futures를 실행하세요: ${inputDir}`);
    process.exit(1);
  }

  // {symbol}-aggTrades-{YYYY-MM-DD}.zip 을 종목·월별로 모은다.
  const groups = new Map();
  for (const file of entries) {
    const m = /^(.+)-aggTrades-(\d{4})-(\d{2})-(\d{2})\.zip$/.exec(file);
    if (m === null) continue;
    const [, symbol, year, month, day] = m;
    const key = `${symbol}|${year}-${month}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ day: Number(day), file });
  }

  if (groups.size === 0) {
    console.error(`변환할 zip이 없습니다: ${inputDir}`);
    process.exit(1);
  }

  console.log(`대상 ${groups.size}개 (종목 × 월)`);
  console.log("");

  const started = Date.now();
  const manifest = [];
  const skippedMonths = [];

  for (const [key, days] of [...groups.entries()].sort()) {
    const [symbol, month] = key.split("|");
    const expected = daysInMonth(month);

    if (days.length !== expected) {
      // 완결되지 않은 달은 버린다. 빠진 날이 거래대금 0으로 남으면
      // 기준선이 내려가 모든 배수가 부풀려진다.
      skippedMonths.push(`${symbol} ${month} (${days.length}/${expected}일)`);
      continue;
    }

    const bounds = monthBounds(month);
    const volumes = new Float64Array(bounds.seconds);
    // 가격은 Float32로 충분하다. 유효숫자 7자리라 상대 정밀도가 1e-7인데
    // 우리가 재는 이동폭은 1e-3 이상이다. Float64로 두면 파일만 두 배가 된다.
    const prices = new Float32Array(bounds.seconds);

    let trades = 0;
    let skipped = 0;
    let outOfRange = 0;

    days.sort((a, b) => a.day - b.day);
    for (const d of days) {
      const r = await ingestDay(path.join(inputDir, d.file), bounds, volumes, prices);
      trades += r.trades;
      skipped += r.skipped;
      outOfRange += r.outOfRange;
    }

    /*
     * 체결이 없던 초를 직전 가격으로 메운다.
     *
     * 거래량은 없으면 0이 맞다. 가격은 아니다 — 0으로 두면 그 초를 기준으로
     * 수익률을 계산할 때 -100%나 무한대가 나온다. 체결이 없었다는 건 값이
     * 0이 됐다는 뜻이 아니라 직전 값 그대로라는 뜻이다.
     */
    let carried = 0;
    let filled = 0;
    for (let i = 0; i < prices.length; i += 1) {
      if (prices[i] > 0) {
        carried = prices[i];
      } else if (carried > 0) {
        prices[i] = carried;
        filled += 1;
      }
    }

    const binPath = path.join(outputDir, `${symbol}-${month}.bin`);
    await writeFile(binPath, Buffer.from(volumes.buffer));
    const priceBinPath = path.join(outputDir, `${symbol}-${month}.price.bin`);
    await writeFile(priceBinPath, Buffer.from(prices.buffer));

    let nonZero = 0;
    for (let i = 0; i < volumes.length; i += 1) {
      if (volumes[i] > 0) nonZero += 1;
    }
    const activity = ((nonZero / bounds.seconds) * 100).toFixed(1);

    console.log(
      `  ${symbol} ${month}: 체결 ${trades.toLocaleString()}건 → 거래발생 ${activity}%` +
        (filled > 0 ? `, 가격보간 ${filled.toLocaleString()}` : "") +
        (skipped > 0 ? `, 건너뜀 ${skipped}` : "") +
        (outOfRange > 0 ? `, 범위밖 ${outOfRange}` : ""),
    );

    manifest.push({
      symbol,
      month,
      startMs: bounds.startMs,
      seconds: bounds.seconds,
      rows: nonZero,
      nonZeroSeconds: nonZero,
      file: path.basename(binPath),
      priceFile: path.basename(priceBinPath),
    });
  }

  if (skippedMonths.length > 0) {
    console.log("");
    console.log("완결되지 않아 건너뛴 달:");
    for (const s of skippedMonths) console.log(`  ${s}`);
  }

  if (manifest.length === 0) {
    console.error("\n변환된 달이 하나도 없습니다. 완결된 달을 받아야 합니다.");
    process.exit(1);
  }

  const manifestPath = path.join(outputDir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const totalBytes = (
    await Promise.all(
      manifest.map((m) => stat(path.join(outputDir, m.file)).then((s) => s.size)),
    )
  ).reduce((a, b) => a + b, 0);

  console.log("");
  console.log(
    `완료: ${manifest.length}개, ${(totalBytes / 1048576).toFixed(0)}MB, ${elapsed}초`,
  );
}

main().catch((error) => {
  console.error("변환 실패", error);
  process.exit(1);
});
