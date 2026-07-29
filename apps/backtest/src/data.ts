import { readFile } from "node:fs/promises";
import path from "node:path";

/** prepare.mjs가 남긴 manifest 항목. */
export interface PreparedEntry {
  symbol: string;
  month: string;
  startMs: number;
  seconds: number;
  rows: number;
  nonZeroSeconds: number;
  file: string;
  /** 종가 파일. 알림 품질 측정에만 쓴다. */
  priceFile?: string;
}

/** 한 종목의 전체 기간을 이어붙인 초 단위 거래대금 시계열. */
export interface SymbolSeries {
  symbol: string;
  /** 첫 초의 시각 (epoch ms) */
  startMs: number;
  /** 인덱스 i = startMs + i초 시점의 거래대금 */
  volumes: Float64Array;
  months: string[];
}

/**
 * 한 종목의 초 단위 종가. volumes와 같은 인덱스를 쓴다.
 *
 * 거래량과 따로 읽는다. 파라미터 스윕은 가격이 필요 없는데, 같이 실으면
 * 종목당 180MB를 늘 지고 가게 된다.
 */
export async function loadPrices(
  dataDir: string,
  symbol: string,
  manifest: readonly PreparedEntry[],
): Promise<Float32Array> {
  const entries = manifest
    .filter((e) => e.symbol === symbol)
    .sort((a, b) => a.startMs - b.startMs);

  if (entries.length === 0) {
    throw new Error(`준비된 데이터가 없습니다: ${symbol}`);
  }

  let totalSeconds = 0;
  for (const entry of entries) {
    totalSeconds += entry.seconds;
  }

  const prices = new Float32Array(totalSeconds);
  let offset = 0;

  for (const entry of entries) {
    if (entry.priceFile === undefined) {
      throw new Error(
        `${symbol} ${entry.month}: 가격 파일이 없습니다. ` +
          `prepare:data를 다시 실행하세요.`,
      );
    }

    const buffer = await readFile(path.join(dataDir, entry.priceFile));

    // Buffer는 내부 풀에서 잘라낸 조각이라 byteOffset이 4의 배수가 아닐
    // 수 있다. 그대로 Float32Array를 얹으면 정렬 제약에 걸린다.
    const bytes = new Uint8Array(buffer.byteLength);
    bytes.set(buffer);
    const chunk = new Float32Array(bytes.buffer);

    if (chunk.length !== entry.seconds) {
      throw new Error(
        `${symbol} ${entry.month}: 가격 길이가 맞지 않습니다 ` +
          `(${chunk.length} vs ${entry.seconds})`,
      );
    }

    prices.set(chunk, offset);
    offset += entry.seconds;
  }

  return prices;
}

export async function loadManifest(dataDir: string): Promise<PreparedEntry[]> {
  const raw = await readFile(path.join(dataDir, "manifest.json"), "utf8");
  return JSON.parse(raw) as PreparedEntry[];
}

/**
 * 한 종목의 월별 파일을 시간 순으로 이어붙인다.
 *
 * 월 사이에 구멍이 있으면 던진다. 조용히 이어붙이면 없는 기간이
 * 거래량 0으로 둔갑해서 기준선이 통째로 내려앉는다.
 */
export async function loadSymbol(
  dataDir: string,
  symbol: string,
  manifest: readonly PreparedEntry[],
): Promise<SymbolSeries> {
  const entries = manifest
    .filter((e) => e.symbol === symbol)
    .sort((a, b) => a.startMs - b.startMs);

  if (entries.length === 0) {
    throw new Error(`준비된 데이터가 없습니다: ${symbol}`);
  }

  let totalSeconds = 0;
  for (const entry of entries) {
    totalSeconds += entry.seconds;
  }

  const volumes = new Float64Array(totalSeconds);
  let offset = 0;
  let expectedStartMs = entries[0]?.startMs ?? 0;

  for (const entry of entries) {
    if (entry.startMs !== expectedStartMs) {
      throw new Error(
        `${symbol}: ${entry.month} 앞에 빠진 기간이 있습니다 ` +
          `(예상 ${new Date(expectedStartMs).toISOString()}, ` +
          `실제 ${new Date(entry.startMs).toISOString()})`,
      );
    }

    const buffer = await readFile(path.join(dataDir, entry.file));
    const chunk = new Float64Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / 8,
    );

    if (chunk.length !== entry.seconds) {
      throw new Error(
        `${symbol} ${entry.month}: 길이가 맞지 않습니다 ` +
          `(${chunk.length} vs ${entry.seconds})`,
      );
    }

    volumes.set(chunk, offset);
    offset += entry.seconds;
    expectedStartMs += entry.seconds * 1000;
  }

  return {
    symbol,
    startMs: entries[0]?.startMs ?? 0,
    volumes,
    months: entries.map((e) => e.month),
  };
}

/** manifest에 들어 있는 심볼 목록. */
export function symbolsIn(manifest: readonly PreparedEntry[]): string[] {
  return [...new Set(manifest.map((e) => e.symbol))].sort();
}
