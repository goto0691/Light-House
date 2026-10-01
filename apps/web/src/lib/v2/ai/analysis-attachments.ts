import { Buffer } from "node:buffer";

import { V2ModelError, type V2ModelInputPart } from "@/lib/v2/ai/gateway";
import { normalizeSha256, validateAttachmentReservation } from "@/lib/v2/domain/attachment-reservation";
import type { V2AnalysisInput } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";

// These are application limits, below the inline request envelope after base64
// expansion. Originals remain available even when automatic analysis is too big.
export const MAX_ANALYSIS_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ANALYSIS_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ANALYSIS_ATTACHMENTS = 12;
export const ANALYSIS_ATTACHMENT_READ_DEADLINE_MS = 15_000;
const SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "audio/mp4", "audio/mpeg", "audio/wav", "audio/webm",
  "video/mp4", "video/webm", "application/pdf", "text/plain", "text/markdown",
]);

export class AnalysisAttachmentError extends V2ModelError {
  constructor(message: string) {
    super("invalid_schema", message, false);
    this.name = "AnalysisAttachmentError";
  }
}

function invalid(message: string): never {
  throw new AnalysisAttachmentError(message);
}

async function beforeDeadline<T>(pending: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    void pending.catch(() => undefined);
    throw new V2ModelError("timeout", "The private attachment could not be read within the analysis deadline.", true);
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new V2ModelError("timeout", "The private attachment could not be read within the analysis deadline.", true)), remaining);
    })]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function readExactBytes(body: ReadableStream<Uint8Array>, expected: number, deadline: number) {
  const reader = body.getReader();
  const bytes = new Uint8Array(expected);
  let offset = 0;
  try {
    while (true) {
      const part = await beforeDeadline(reader.read(), deadline);
      if (part.done) break;
      if (offset + part.value.byteLength > expected) invalid("The analysis attachment exceeds its verified size.");
      bytes.set(part.value, offset);
      offset += part.value.byteLength;
    }
    if (offset !== expected) invalid("The analysis attachment is shorter than its verified size.");
    return bytes;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof V2ModelError) throw error;
    throw new V2ModelError("provider_unavailable", "The private attachment stream could not be read. Analysis will retry.", true);
  } finally {
    reader.releaseLock();
  }
}

export async function loadAnalysisAttachmentParts(input: V2AnalysisInput, bucket?: R2BucketBinding): Promise<readonly V2ModelInputPart[]> {
  const sources = input.sources.filter((source) => source.attachmentId !== null);
  if (!sources.length) return [];
  if (!bucket) throw new V2ModelError("provider_unavailable", "The private attachment storage is unavailable for analysis.", true);
  if (sources.length > MAX_ANALYSIS_ATTACHMENTS) invalid("This capture exceeds the automatic analysis attachment count. Analyze a smaller capture.");
  let total = 0;
  // Validate every reservation before reading any bytes. The query that creates
  // these reservations is scoped to this job's document, source and owner.
  for (const source of sources) {
    const reservation = source.attachment;
    if (!reservation || reservation.id !== source.attachmentId || reservation.userId !== input.job.userId) invalid("The analysis attachment is not a committed source owned by this job.");
    validateAttachmentReservation(reservation);
    if (!SUPPORTED_MIME_TYPES.has(reservation.expectedMimeType)) invalid("This attachment format is not supported by automatic analysis.");
    if (reservation.expectedSize > MAX_ANALYSIS_ATTACHMENT_BYTES) invalid("The attachment exceeds the 8 MiB automatic analysis limit. The original is preserved; use a smaller file for analysis.");
    total += reservation.expectedSize;
    if (total > MAX_ANALYSIS_TOTAL_ATTACHMENT_BYTES) invalid("The capture exceeds the 10 MiB automatic analysis limit. The originals are preserved; analyze smaller captures.");
    if (normalizeSha256(source.contentHash.replace(/^sha256:/, "")) !== normalizeSha256(reservation.expectedSha256)) invalid("The analysis source hash does not match its attachment reservation.");
  }
  const parts: V2ModelInputPart[] = [];
  const deadline = Date.now() + ANALYSIS_ATTACHMENT_READ_DEADLINE_MS;
  for (const source of sources) {
    const reservation = source.attachment!;
    const pendingObject = bucket.get(reservation.objectKey);
    let object;
    try { object = await beforeDeadline(pendingObject, deadline); }
    catch (error) {
      void pendingObject.then((lateObject) => lateObject?.body.cancel()).catch(() => undefined);
      if (error instanceof V2ModelError) throw error;
      throw new V2ModelError("provider_unavailable", "The private attachment storage could not be reached. Analysis will retry.", true);
    }
    if (!object) invalid("The committed analysis attachment is missing from storage.");
    if (object.size !== reservation.expectedSize || object.httpMetadata?.contentType !== reservation.expectedMimeType
      || object.customMetadata?.reservationId !== reservation.id || object.customMetadata?.userId !== input.job.userId) {
      await object.body.cancel().catch(() => undefined);
      invalid("The analysis attachment metadata does not match its verified owner and content.");
    }
    const bytes = await readExactBytes(object.body, reservation.expectedSize, deadline);
    const actualHash = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
    if (actualHash !== normalizeSha256(reservation.expectedSha256)) invalid("The analysis attachment content hash does not match its verified original.");
    parts.push({ text: JSON.stringify({ attachment_source_item_id: source.id, mime_type: reservation.expectedMimeType }) });
    if (reservation.expectedMimeType.startsWith("text/")) {
      try { parts.push({ text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }); }
      catch { invalid("The text attachment is not valid UTF-8. Save a UTF-8 copy and attach it again; the original is preserved."); }
    } else {
      parts.push({ inlineData: { mimeType: reservation.expectedMimeType, data: Buffer.from(bytes).toString("base64") } });
    }
  }
  if (Date.now() > deadline) throw new V2ModelError("timeout", "The private attachment preparation exceeded the analysis deadline.", true);
  return parts;
}
