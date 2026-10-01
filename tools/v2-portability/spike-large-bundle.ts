import { createStoredZipStream } from "../../apps/web/src/lib/v2/portability/zip-stream-v1";

const valueAfter = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const logicalBytes = Number(valueAfter("--bytes") ?? 2 * 1024 * 1024 * 1024);
const chunkBytes = Number(valueAfter("--chunk-bytes") ?? 8 * 1024 * 1024);
if (!Number.isSafeInteger(logicalBytes) || logicalBytes <= 0 || logicalBytes >= 0xffff_ffff) throw new Error("--bytes must be a positive ZIP32-safe integer.");
if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0 || chunkBytes > 32 * 1024 * 1024) throw new Error("--chunk-bytes must be between 1 and 32 MiB.");

async function main() {
  const reusable = new Uint8Array(chunkBytes);
  const started = performance.now();
  let emittedBytes = 0; let largestChunk = 0; let maxRss = process.memoryUsage().rss; let maxArrayBuffers = process.memoryUsage().arrayBuffers;
  const stream = createStoredZipStream((async function* () {
    yield { path: "attachments/originals/2gb-fixture/simulated.bin", source: (async function* () {
      let remaining = logicalBytes;
      while (remaining > 0) { const size = Math.min(reusable.byteLength, remaining); yield size === reusable.byteLength ? reusable : reusable.subarray(0, size); remaining -= size; }
    })() };
    yield { path: "README.md", source: "bounded streaming spike\n" };
  })());
  const reader = stream.getReader();
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    emittedBytes += item.value.byteLength;
    largestChunk = Math.max(largestChunk, item.value.byteLength);
    const memory = process.memoryUsage(); maxRss = Math.max(maxRss, memory.rss); maxArrayBuffers = Math.max(maxArrayBuffers, memory.arrayBuffers);
  }
  const result = { logicalBytes, emittedBytes, chunkBytes, largestChunk, maxRss, maxArrayBuffers, durationMs: Math.round(performance.now() - started), bounded: largestChunk <= chunkBytes && maxArrayBuffers < 256 * 1024 * 1024 };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.bounded) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : "Large bundle spike failed."}\n`); process.exitCode = 1; });

