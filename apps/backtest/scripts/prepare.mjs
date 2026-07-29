// 내려받은 1초 kline zip을 리플레이용 이진 형식으로 변환한다.
//
// CSV를 매번 파싱하면 리플레이 한 번에 수 분이 걸린다. 파라미터를 바꿔가며
// 수십 번 돌려야 하므로, 필요한 값(초당 거래대금) 하나만 뽑아 고정 길이
// 배열로 저장해둔다. 종목·월당 Float64 배열 하나다.
//
// 사용법: node scripts/prepare.mjs

import { mkdir, readdir, writeFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openZipEntryStream } from "./lib/zip.mjs";

// kline CSV 컬럼: 0=open_time 1=open 2=high 3=low 4=close ... 7=quote_volume
const CLOSE_COLUMN = 4;
const QUOTE_VOLUME_COLUMN = 7;

/** open_time이 마이크로초인지 밀리초인지 자동 판별한다. */
function normalizeToMs(rawTimestamp) {
  // 밀리초라면 13자리(약 1.7e12), 마이크로초라면 16자리(약 1.7e15).
  if (rawTimestamp > 1e14) {
    return Math.floor(rawTimestamp / 1000);
  }
  return rawTimestamp;
}

function monthBounds(month) {
  const [yearText, monthText] = month.split("-");
  const year = Number.parseInt(yearText, 10);
  const monthIndex = Number.parseInt(monthText, 10) - 1;

  const startMs = Date.UTC(year, monthIndex, 1);
  const endMs = Date.UTC(year, monthIndex + 1, 1);

  return { startMs, endMs, seconds: (endMs - startMs) / 1000 };
}

/**
 * 한 줄에서 타임스탬프·종가·거래대금을 뽑는다.
 * split(",")으로 12개 문자열을 만들면 4700만 줄에서 그 비용이 그대로
 * 쌓이므로, 필요한 컬럼까지만 인덱스로 훑는다.
 */
function parseLine(line) {
  const firstComma = line.indexOf(",");
  if (firstComma < 0) {
    return null;
  }

  const timestamp = Number(line.slice(0, firstComma));
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  let cursor = firstComma;
  let column = 1;
  let close = Number.NaN;

  // 루프 진입 시 cursor는 column 바로 앞의 쉼표를 가리킨다.
  while (column < QUOTE_VOLUME_COLUMN) {
    const next = line.indexOf(",", cursor + 1);
    if (next < 0) {
      return null;
    }
    if (column === CLOSE_COLUMN) {
      close = Number(line.slice(cursor + 1, next));
    }
    cursor = next;
    column += 1;
  }

  const nextComma = line.indexOf(",", cursor + 1);
  let quoteVolumeText;
  if (nextComma < 0) {
    quoteVolumeText = line.slice(cursor + 1);
  } else {
    quoteVolumeText = line.slice(cursor + 1, nextComma);
  }

  const quoteVolume = Number(quoteVolumeText);
  if (!Number.isFinite(quoteVolume)) {
    return null;
  }

  if (!Number.isFinite(close) || close <= 0) {
    return null;
  }

  return { timestamp, close, quoteVolume };
}

async function prepareOne(zipPath, outputDir) {
  const fileName = path.basename(zipPath, ".zip");
  const match = /^(.+)-1s-(\d{4}-\d{2})$/.exec(fileName);
  if (match === null) {
    throw new Error(`파일명 형식을 알 수 없습니다: ${fileName}`);
  }

  const symbol = match[1];
  const month = match[2];
  const bounds = monthBounds(month);

  const volumes = new Float64Array(bounds.seconds);
  // 가격은 Float32로 충분하다. 유효숫자 7자리라 BTC(1e5)든 SHIB(1e-5)든
  // 상대 정밀도가 1e-7 수준인데, 우리가 재는 이동폭은 1e-3 이상이다.
  // Float64로 두면 파일만 두 배가 된다.
  const prices = new Float32Array(bounds.seconds);

  const { stream } = await openZipEntryStream(zipPath);
  const reader = createInterface({ input: stream, crlfDelay: Infinity });

  let rows = 0;
  let skipped = 0;
  let outOfRange = 0;

  for await (const line of reader) {
    if (line.length === 0) {
      continue;
    }

    const parsed = parseLine(line);
    if (parsed === null) {
      // 헤더 행이 붙어 있는 덤프도 있어서 조용히 넘긴다.
      skipped += 1;
      continue;
    }

    const ms = normalizeToMs(parsed.timestamp);
    const index = Math.floor((ms - bounds.startMs) / 1000);

    if (index < 0 || index >= volumes.length) {
      outOfRange += 1;
      continue;
    }

    volumes[index] = parsed.quoteVolume;
    prices[index] = parsed.close;
    rows += 1;
  }

  /*
   * 체결이 없던 초를 직전 가격으로 메운다.
   *
   * 거래량은 없으면 0이 맞다. 가격은 아니다 — 0으로 두면 그 초를 기준으로
   * 수익률을 계산할 때 -100%나 무한대가 나온다. 체결이 없었다는 건 값이
   * 0이 됐다는 뜻이 아니라 직전 값 그대로라는 뜻이다.
   *
   * 첫 체결 이전 구간은 채울 값이 없으므로 0으로 남긴다. 읽는 쪽에서
   * 0을 "가격 없음"으로 보고 건너뛴다.
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

  const nonZero = volumes.reduce((count, v) => (v > 0 ? count + 1 : count), 0);
  const coverage = ((rows / bounds.seconds) * 100).toFixed(1);
  const activity = ((nonZero / bounds.seconds) * 100).toFixed(1);

  console.log(
    `  ${symbol} ${month}: ${rows.toLocaleString()}행 (커버리지 ${coverage}%, 거래발생 ${activity}%)` +
      (filled > 0 ? `, 가격보간 ${filled.toLocaleString()}` : "") +
      (skipped > 0 ? `, 건너뜀 ${skipped}` : "") +
      (outOfRange > 0 ? `, 범위밖 ${outOfRange}` : ""),
  );

  return {
    symbol,
    month,
    startMs: bounds.startMs,
    seconds: bounds.seconds,
    rows,
    nonZeroSeconds: nonZero,
    file: path.basename(binPath),
    priceFile: path.basename(priceBinPath),
  };
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const klineDir = path.resolve(here, "../../../data/klines");
  const outputDir = path.resolve(here, "../../../data/prepared");

  await mkdir(outputDir, { recursive: true });

  const entries = await readdir(klineDir);
  const zips = entries.filter((f) => f.endsWith(".zip")).sort();

  if (zips.length === 0) {
    console.error(`zip이 없습니다. 먼저 pnpm fetch를 실행하세요: ${klineDir}`);
    process.exit(1);
  }

  console.log(`변환 대상 ${zips.length}개`);
  console.log("");

  const started = Date.now();
  const manifest = [];

  for (const zip of zips) {
    manifest.push(await prepareOne(path.join(klineDir, zip), outputDir));
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
