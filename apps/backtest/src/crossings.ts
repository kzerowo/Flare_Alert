// 임계 교차 스트림.
//
// S 계산과 퍼센타일 환산은 쿨다운·병합 파라미터와 아무 상관이 없다.
// 그런데 그게 전체 실행 시간의 대부분(종목당 100초)을 차지한다.
// 파라미터 조합을 수십 개 훑으려면 이 부분을 한 번만 하고 결과를 캐시해야 한다.
//
// 여기서는 "가장 낮은 민감도라도 넘긴 (초, 프레임)"만 뽑아 저장한다.
// 그 아래는 어떤 파라미터를 넣어도 알림이 될 수 없으므로 버려도 안전하다.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface CrossingStream {
  symbol: string;
  /** 첫 초의 시각 (epoch ms) */
  startMs: number;
  /** 측정 구간 길이(일) */
  measuredDays: number;
  /** 측정 구간에서 백분위가 나온 (초, 프레임) 조합의 총 수 */
  scoredEvaluations: number;
  /** 이 스트림에 담긴 최소 백분위 */
  minPercentile: number;

  /** 교차 시점의 초 오프셋 (startMs 기준) */
  seconds: Int32Array;
  /** TIMEFRAMES 안에서의 프레임 위치 */
  frames: Uint8Array;
  /** 교차 시점의 백분위 */
  percentiles: Float32Array;
  /**
   * 교차 시점의 창 누적 거래대금.
   *
   * 거래대금 하한(MIN_QUOTE_VOLUME)을 추출 단계에서 걸러 버리면 그 값이
   * 옳았는지 되물을 수가 없다. 걸러내지 않고 같이 담아, 하한을 뒤 단계에서
   * 훑을 수 있게 한다.
   */
  quoteVolumes: Float32Array;
}

// 포맷이 바뀌면 올린다. 예전 캐시를 조용히 읽으면 결과가 통째로 틀어진다.
const MAGIC = "FLARE-CROSSINGS-3";

export async function saveCrossings(
  dir: string,
  stream: CrossingStream,
): Promise<void> {
  await mkdir(dir, { recursive: true });

  const meta = {
    magic: MAGIC,
    symbol: stream.symbol,
    startMs: stream.startMs,
    measuredDays: stream.measuredDays,
    scoredEvaluations: stream.scoredEvaluations,
    minPercentile: stream.minPercentile,
    count: stream.seconds.length,
  };

  await writeFile(
    path.join(dir, `${stream.symbol}.json`),
    `${JSON.stringify(meta)}\n`,
  );

  // 배열 세 개를 한 파일에 이어붙인다. 길이는 meta.count로 알 수 있다.
  //
  // frames는 1바이트 배열이라 개수가 4의 배수가 아니면 뒤따르는
  // Float32Array의 시작 위치가 4바이트 정렬을 깨뜨린다. 패딩을 넣어 맞춘다.
  const framePadding = (4 - (stream.frames.byteLength % 4)) % 4;

  const buffer = Buffer.concat([
    Buffer.from(
      stream.seconds.buffer,
      stream.seconds.byteOffset,
      stream.seconds.byteLength,
    ),
    Buffer.from(
      stream.frames.buffer,
      stream.frames.byteOffset,
      stream.frames.byteLength,
    ),
    Buffer.alloc(framePadding),
    Buffer.from(
      stream.percentiles.buffer,
      stream.percentiles.byteOffset,
      stream.percentiles.byteLength,
    ),
    Buffer.from(
      stream.quoteVolumes.buffer,
      stream.quoteVolumes.byteOffset,
      stream.quoteVolumes.byteLength,
    ),
  ]);

  await writeFile(path.join(dir, `${stream.symbol}.bin`), buffer);
}

export async function loadCrossings(
  dir: string,
  symbol: string,
  expectedMinPercentile: number,
): Promise<CrossingStream | null> {
  let meta: {
    magic: string;
    symbol: string;
    startMs: number;
    measuredDays: number;
    scoredEvaluations: number;
    minPercentile: number;
    count: number;
  };

  try {
    const raw = await readFile(path.join(dir, `${symbol}.json`), "utf8");
    meta = JSON.parse(raw) as typeof meta;
  } catch {
    return null;
  }

  // 캐시가 다른 조건으로 만들어졌으면 쓰지 않는다.
  // 조용히 재사용하면 스윕 결과가 통째로 틀어진다.
  if (meta.magic !== MAGIC || meta.minPercentile !== expectedMinPercentile) {
    return null;
  }

  const raw = await readFile(path.join(dir, `${symbol}.bin`));
  const count = meta.count;

  // readFile이 주는 Buffer는 내부 풀에서 잘라낸 조각이라 byteOffset이
  // 임의의 값이다. 그대로 TypedArray를 얹으면 정렬 제약에 걸린다.
  // 시작이 0인 새 ArrayBuffer로 옮긴다.
  const bytes = new Uint8Array(raw.byteLength);
  bytes.set(raw);
  const backing = bytes.buffer;

  let offset = 0;
  const seconds = new Int32Array(backing, offset, count);
  offset += count * 4;
  const frames = new Uint8Array(backing, offset, count);
  offset += count + ((4 - (count % 4)) % 4);
  const percentiles = new Float32Array(backing, offset, count);
  offset += count * 4;
  const quoteVolumes = new Float32Array(backing, offset, count);

  return {
    symbol: meta.symbol,
    startMs: meta.startMs,
    measuredDays: meta.measuredDays,
    scoredEvaluations: meta.scoredEvaluations,
    minPercentile: meta.minPercentile,
    seconds,
    frames,
    percentiles,
    quoteVolumes,
  };
}

/** 길이를 미리 모를 때 쓰는 증가형 버퍼. */
export class CrossingCollector {
  #seconds = new Int32Array(1 << 16);
  #frames = new Uint8Array(1 << 16);
  #percentiles = new Float32Array(1 << 16);
  #quoteVolumes = new Float32Array(1 << 16);
  #count = 0;

  push(
    second: number,
    frame: number,
    percentile: number,
    quoteVolume: number,
  ): void {
    if (this.#count === this.#seconds.length) {
      this.#grow();
    }
    this.#seconds[this.#count] = second;
    this.#frames[this.#count] = frame;
    this.#percentiles[this.#count] = percentile;
    this.#quoteVolumes[this.#count] = quoteVolume;
    this.#count += 1;
  }

  get count(): number {
    return this.#count;
  }

  toArrays(): {
    seconds: Int32Array;
    frames: Uint8Array;
    percentiles: Float32Array;
    quoteVolumes: Float32Array;
  } {
    return {
      seconds: this.#seconds.slice(0, this.#count),
      frames: this.#frames.slice(0, this.#count),
      percentiles: this.#percentiles.slice(0, this.#count),
      quoteVolumes: this.#quoteVolumes.slice(0, this.#count),
    };
  }

  #grow(): void {
    const nextSize = this.#seconds.length * 2;

    const seconds = new Int32Array(nextSize);
    seconds.set(this.#seconds);
    this.#seconds = seconds;

    const frames = new Uint8Array(nextSize);
    frames.set(this.#frames);
    this.#frames = frames;

    const percentiles = new Float32Array(nextSize);
    percentiles.set(this.#percentiles);
    this.#percentiles = percentiles;

    const quoteVolumes = new Float32Array(nextSize);
    quoteVolumes.set(this.#quoteVolumes);
    this.#quoteVolumes = quoteVolumes;
  }
}
