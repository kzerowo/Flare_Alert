// 최소 ZIP 리더.
//
// 바이낸스 덤프는 zip 하나에 CSV 하나가 들어 있는 단순한 구조라서
// 라이브러리를 붙이지 않고 직접 읽는다. 중앙 디렉터리에서 크기와 오프셋을
// 정확히 읽어오므로 data descriptor 방식으로 압축된 파일도 문제없다.

import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** 파일 끝에서 EOCD(End Of Central Directory) 레코드를 찾는다. */
async function findEndOfCentralDirectory(handle, fileSize) {
  // EOCD는 최소 22바이트, 주석이 붙으면 최대 65535바이트 더 길어진다.
  const maxScan = Math.min(fileSize, 22 + 0xffff);
  const buffer = Buffer.alloc(maxScan);
  await handle.read(buffer, 0, maxScan, fileSize - maxScan);

  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      return {
        entryCount: buffer.readUInt16LE(i + 10),
        centralDirOffset: buffer.readUInt32LE(i + 16),
      };
    }
  }

  throw new Error("ZIP 구조가 아닙니다 (EOCD를 찾지 못함)");
}

/** 중앙 디렉터리의 첫 항목을 읽는다. 바이낸스 덤프는 항상 항목이 하나다. */
async function readFirstCentralEntry(handle, offset) {
  const header = Buffer.alloc(46);
  await handle.read(header, 0, 46, offset);

  if (header.readUInt32LE(0) !== CENTRAL_SIGNATURE) {
    throw new Error("중앙 디렉터리 시그니처가 맞지 않습니다");
  }

  const nameLength = header.readUInt16LE(28);
  const nameBuffer = Buffer.alloc(nameLength);
  await handle.read(nameBuffer, 0, nameLength, offset + 46);

  return {
    method: header.readUInt16LE(10),
    compressedSize: header.readUInt32LE(20),
    uncompressedSize: header.readUInt32LE(24),
    localHeaderOffset: header.readUInt32LE(42),
    name: nameBuffer.toString("utf8"),
  };
}

/** 로컬 헤더를 읽어 실제 압축 데이터가 시작하는 바이트 위치를 구한다. */
async function findDataStart(handle, localHeaderOffset) {
  const header = Buffer.alloc(30);
  await handle.read(header, 0, 30, localHeaderOffset);

  if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new Error("로컬 헤더 시그니처가 맞지 않습니다");
  }

  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);

  return localHeaderOffset + 30 + nameLength + extraLength;
}

/**
 * zip 안의 첫 번째 파일을 압축 해제 스트림으로 연다.
 *
 * 전체를 메모리에 올리지 않는다. 1초 kline 한 달치는 압축 해제하면
 * 500MB가 넘어서, 통째로 읽으면 종목 몇 개만 돌려도 힙이 터진다.
 */
export async function openZipEntryStream(zipPath) {
  const handle = await open(zipPath, "r");

  try {
    const { size } = await handle.stat();
    const eocd = await findEndOfCentralDirectory(handle, size);

    if (eocd.entryCount === 0) {
      throw new Error("zip이 비어 있습니다");
    }

    const entry = await readFirstCentralEntry(handle, eocd.centralDirOffset);
    const dataStart = await findDataStart(handle, entry.localHeaderOffset);

    if (entry.method !== METHOD_DEFLATE && entry.method !== METHOD_STORED) {
      throw new Error(`지원하지 않는 압축 방식입니다: ${entry.method}`);
    }

    const raw = createReadStream(zipPath, {
      start: dataStart,
      end: dataStart + entry.compressedSize - 1,
    });

    let stream;
    if (entry.method === METHOD_STORED) {
      stream = raw;
    } else {
      stream = raw.pipe(createInflateRaw());
    }

    return { stream, entry };
  } finally {
    await handle.close();
  }
}
