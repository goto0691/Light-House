import { createHash, randomUUID } from "node:crypto";

import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";

type Options = { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> };
type ObjectValue = { bytes: Buffer; options?: Options };
type Upload = { key: string; options?: Options; parts: Map<number, { bytes: Buffer; etag: string }> };
const MAX_LOCAL_BYTES = 256 * 1024 * 1024;
function sha(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
async function bytesOf(value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob): Promise<Buffer> {
  if (typeof value === "string") return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Blob) return Buffer.from(await value.arrayBuffer());
  const reader = value.getReader(), chunks: Buffer[] = []; let total = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      const bytes = Buffer.from(item.value as Uint8Array); total += bytes.length;
      if (total > MAX_LOCAL_BYTES) throw new Error("PRIVATE_REPLAY_STORAGE_BUDGET");
      chunks.push(bytes);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
/** Local memory binding for the actual export coordinator, not a Cloudflare/R2 runtime assertion. */
export class PrivateReplayMemoryR2 implements R2BucketBinding {
  private readonly objects = new Map<string, ObjectValue>();
  private readonly uploads = new Map<string, Upload>();
  private object(key: string, value: ObjectValue) {
    return { key, size: value.bytes.length, ...value.options, checksums: { sha256: Uint8Array.from(Buffer.from(sha(value.bytes), "hex")).buffer } };
  }
  async head(key: string) { const value = this.objects.get(key); return value ? this.object(key, value) : null; }
  async get(key: string, options?: { range?: { offset: number; length: number } }) {
    const value = this.objects.get(key); if (!value) return null;
    const bytes = options?.range ? value.bytes.subarray(options.range.offset, options.range.offset + options.range.length) : value.bytes;
    return { ...this.object(key, value), body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.from(bytes)); controller.close(); } }), arrayBuffer: async () => Uint8Array.from(bytes).buffer };
  }
  async put(key: string, body: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob, options?: Options) {
    const bytes = await bytesOf(body);
    if (bytes.length > MAX_LOCAL_BYTES) throw new Error("PRIVATE_REPLAY_STORAGE_BUDGET");
    this.objects.set(key, { bytes: Buffer.from(bytes), options });
    return this.object(key, this.objects.get(key)!);
  }
  async delete(keys: string | string[]) { for (const key of typeof keys === "string" ? [keys] : keys) this.objects.delete(key); }
  private multipart(uploadId: string, upload: Upload) {
    return {
      uploadId,
      uploadPart: async (partNumber: number, body: ReadableStream | ArrayBuffer | ArrayBufferView | Blob) => {
        const bytes = await bytesOf(body), etag = sha(bytes);
        if (bytes.length > MAX_LOCAL_BYTES) throw new Error("PRIVATE_REPLAY_STORAGE_BUDGET");
        upload.parts.set(partNumber, { bytes: Buffer.from(bytes), etag }); return { partNumber, etag };
      },
      complete: async (parts: readonly { partNumber: number; etag: string }[]) => {
        const chunks = parts.map((part) => { const value = upload.parts.get(part.partNumber); if (!value || value.etag !== part.etag) throw new Error("PRIVATE_REPLAY_MULTIPART_INVALID"); return value.bytes; });
        const bytes = Buffer.concat(chunks); if (bytes.length > MAX_LOCAL_BYTES) throw new Error("PRIVATE_REPLAY_STORAGE_BUDGET");
        this.objects.set(upload.key, { bytes, options: upload.options }); this.uploads.delete(uploadId);
        return this.object(upload.key, this.objects.get(upload.key)!);
      },
      abort: async () => { this.uploads.delete(uploadId); },
    };
  }
  async createMultipartUpload(key: string, options?: Options) {
    const uploadId = randomUUID(), upload: Upload = { key, options, parts: new Map() };
    this.uploads.set(uploadId, upload); return this.multipart(uploadId, upload);
  }
  resumeMultipartUpload(key: string, uploadId: string) {
    const upload = this.uploads.get(uploadId); if (!upload || upload.key !== key) throw new Error("PRIVATE_REPLAY_MULTIPART_INVALID");
    return this.multipart(uploadId, upload);
  }
}
