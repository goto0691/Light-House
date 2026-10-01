import { describe, expect, test } from "vitest";

import { createStoredZipStream, parseStoredZip } from "@/lib/v2/portability/zip-stream-v1";

async function collect(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    chunks.push(item.value);
    total += item.value.byteLength;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

describe("Lighthouse stored ZIP v1", () => {
  test("round-trips UTF-8 entries and rejects checksum corruption", async () => {
    const archive = await collect(createStoredZipStream((async function* () {
      yield { path: "documents/기록/index.md", source: "# 원문\n\n그대로 보존\n" };
      yield { path: "manifest.json", source: "{}\n" };
    })()));
    const parsed = parseStoredZip(archive);
    expect(new TextDecoder().decode(parsed.get("documents/기록/index.md")?.bytes)).toContain("그대로 보존");
    const damaged = archive.slice();
    const marker = new TextEncoder().encode("그대로");
    const index = damaged.findIndex((_, offset) => marker.every((byte, position) => damaged[offset + position] === byte));
    damaged[index] ^= 0xff;
    expect(() => parseStoredZip(damaged)).toThrow(/CRC mismatch/);
  });

  test("rejects zip-slip paths before emitting payload", async () => {
    const stream = createStoredZipStream((async function* () { yield { path: "../private.txt", source: "no" }; })());
    await expect(collect(stream)).rejects.toThrow(/unsafe segment/);
  });

  test("consumes a large logical source in bounded chunks", async () => {
    let largestChunk = 0;
    let total = 0;
    const stream = createStoredZipStream((async function* () {
      yield {
        path: "attachments/originals/fixture/large.bin",
        source: (async function* () {
          for (let index = 0; index < 32; index += 1) yield new Uint8Array(1024 * 1024);
        })(),
      };
    })());
    const reader = stream.getReader();
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      largestChunk = Math.max(largestChunk, item.value.byteLength);
      total += item.value.byteLength;
    }
    expect(total).toBeGreaterThan(32 * 1024 * 1024);
    expect(largestChunk).toBeLessThanOrEqual(1024 * 1024);
  });
});

