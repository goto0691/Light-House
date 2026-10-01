import { createHash } from "node:crypto";

export type ZipEntrySource = Uint8Array | string | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

export type StreamingZipEntry = Readonly<{
  path: string;
  source: ZipEntrySource;
  onComplete?: (result: { bytes: number; crc32: number; sha256: string }) => void;
}>;

type ZipCentralEntry = {
  pathBytes: Uint8Array;
  crc32: number;
  bytes: number;
  localOffset: number;
};

export class ZipContractError extends Error {
  readonly code = "zip_contract_invalid";

  constructor(message: string) {
    super(message);
    this.name = "ZipContractError";
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const UINT32_MAX = 0xffff_ffff;

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function updateCrc32(crc: number, chunk: Uint8Array) {
  let value = crc;
  for (const byte of chunk) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

export function crc32(chunk: Uint8Array) {
  return (updateCrc32(0xffff_ffff, chunk) ^ 0xffff_ffff) >>> 0;
}

export function assertSafeZipPath(path: string) {
  if (!path || path.length > 512 || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new ZipContractError("ZIP entry path must be a bounded relative POSIX path.");
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new ZipContractError("ZIP entry path contains an unsafe segment.");
  }
}

function fixed(length: number, write: (view: DataView) => void) {
  const bytes = new Uint8Array(length);
  write(new DataView(bytes.buffer));
  return bytes;
}

function localHeader(pathBytes: Uint8Array) {
  return fixed(30, (view) => {
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0808, true);
    view.setUint16(8, 0, true);
    view.setUint16(26, pathBytes.byteLength, true);
  });
}

function dataDescriptor(crc: number, bytes: number) {
  return fixed(16, (view) => {
    view.setUint32(0, 0x08074b50, true);
    view.setUint32(4, crc, true);
    view.setUint32(8, bytes, true);
    view.setUint32(12, bytes, true);
  });
}

function centralHeader(entry: ZipCentralEntry) {
  return fixed(46, (view) => {
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0808, true);
    view.setUint16(10, 0, true);
    view.setUint32(16, entry.crc32, true);
    view.setUint32(20, entry.bytes, true);
    view.setUint32(24, entry.bytes, true);
    view.setUint16(28, entry.pathBytes.byteLength, true);
    view.setUint32(42, entry.localOffset, true);
  });
}

function endOfCentralDirectory(entries: number, centralBytes: number, centralOffset: number) {
  return fixed(22, (view) => {
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, entries, true);
    view.setUint16(10, entries, true);
    view.setUint32(12, centralBytes, true);
    view.setUint32(16, centralOffset, true);
  });
}

async function* sourceChunks(source: ZipEntrySource): AsyncGenerator<Uint8Array> {
  if (typeof source === "string") {
    yield textEncoder.encode(source);
    return;
  }
  if (source instanceof Uint8Array) {
    yield source;
    return;
  }
  if ("getReader" in source) {
    const reader = source.getReader();
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        if (item.value.byteLength) yield item.value;
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }
  for await (const chunk of source) if (chunk.byteLength) yield chunk;
}

async function* zipChunks(entries: AsyncIterable<StreamingZipEntry>): AsyncGenerator<Uint8Array> {
  let offset = 0;
  const centralEntries: ZipCentralEntry[] = [];
  const seen = new Set<string>();
  for await (const entry of entries) {
    assertSafeZipPath(entry.path);
    if (seen.has(entry.path)) throw new ZipContractError(`Duplicate ZIP entry: ${entry.path}`);
    seen.add(entry.path);
    if (centralEntries.length >= 65_535) throw new ZipContractError("ZIP entry count exceeds the v1 budget.");
    const pathBytes = textEncoder.encode(entry.path);
    const entryOffset = offset;
    const header = localHeader(pathBytes);
    yield header;
    yield pathBytes;
    offset += header.byteLength + pathBytes.byteLength;
    const hash = createHash("sha256");
    let crc = 0xffff_ffff;
    let bytes = 0;
    for await (const chunk of sourceChunks(entry.source)) {
      bytes += chunk.byteLength;
      offset += chunk.byteLength;
      if (bytes > UINT32_MAX || offset > UINT32_MAX) throw new ZipContractError("ZIP v1 size budget exceeded.");
      crc = updateCrc32(crc, chunk);
      hash.update(chunk);
      yield chunk;
    }
    crc = (crc ^ 0xffff_ffff) >>> 0;
    const descriptor = dataDescriptor(crc, bytes);
    yield descriptor;
    offset += descriptor.byteLength;
    centralEntries.push({ pathBytes, crc32: crc, bytes, localOffset: entryOffset });
    entry.onComplete?.({ bytes, crc32: crc, sha256: hash.digest("hex") });
  }
  const centralOffset = offset;
  for (const entry of centralEntries) {
    const header = centralHeader(entry);
    yield header;
    yield entry.pathBytes;
    offset += header.byteLength + entry.pathBytes.byteLength;
  }
  const centralBytes = offset - centralOffset;
  yield endOfCentralDirectory(centralEntries.length, centralBytes, centralOffset);
}

export function createStoredZipStream(entries: AsyncIterable<StreamingZipEntry>) {
  const iterator = zipChunks(entries)[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const item = await iterator.next();
        if (item.done) controller.close();
        else controller.enqueue(item.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });
}

export type ParsedZipEntry = Readonly<{ path: string; bytes: Uint8Array; crc32: number }>;

export function parseStoredZip(
  input: Uint8Array,
  budget: { maxFiles?: number; maxTotalBytes?: number; maxEntryBytes?: number } = {},
) {
  const maxFiles = budget.maxFiles ?? 10_000;
  const maxTotalBytes = budget.maxTotalBytes ?? 2_500_000_000;
  const maxEntryBytes = budget.maxEntryBytes ?? 2_100_000_000;
  if (input.byteLength < 22) throw new ZipContractError("ZIP is truncated.");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let eocd = -1;
  for (let offset = input.byteLength - 22; offset >= Math.max(0, input.byteLength - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new ZipContractError("ZIP central directory is missing.");
  const count = view.getUint16(eocd + 10, true);
  const centralBytes = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (count > maxFiles || centralOffset + centralBytes > eocd) throw new ZipContractError("ZIP exceeds its file or directory budget.");
  const results = new Map<string, ParsedZipEntry>();
  let cursor = centralOffset;
  let totalBytes = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > input.byteLength || view.getUint32(cursor, true) !== 0x02014b50) throw new ZipContractError("ZIP central entry is invalid.");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const expectedCrc = view.getUint32(cursor + 16, true);
    const compressedBytes = view.getUint32(cursor + 20, true);
    const uncompressedBytes = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    if ((flags & 1) !== 0 || method !== 0 || compressedBytes !== uncompressedBytes) throw new ZipContractError("Only unencrypted stored ZIP entries are supported.");
    if (uncompressedBytes > maxEntryBytes) throw new ZipContractError("ZIP entry exceeds the decompression budget.");
    const path = textDecoder.decode(input.subarray(cursor + 46, cursor + 46 + nameLength));
    assertSafeZipPath(path);
    if (results.has(path)) throw new ZipContractError("ZIP contains duplicate paths.");
    if (localOffset + 30 > input.byteLength || view.getUint32(localOffset, true) !== 0x04034b50) throw new ZipContractError("ZIP local entry is invalid.");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + uncompressedBytes > input.byteLength) throw new ZipContractError("ZIP entry data is truncated.");
    const bytes = input.subarray(dataOffset, dataOffset + uncompressedBytes);
    if (crc32(bytes) !== expectedCrc) throw new ZipContractError(`ZIP CRC mismatch: ${path}`);
    totalBytes += uncompressedBytes;
    if (totalBytes > maxTotalBytes) throw new ZipContractError("ZIP exceeds the total decompression budget.");
    results.set(path, { path, bytes, crc32: expectedCrc });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== centralOffset + centralBytes) throw new ZipContractError("ZIP central directory byte count is inconsistent.");
  return results;
}
