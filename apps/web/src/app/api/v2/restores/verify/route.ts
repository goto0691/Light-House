import { getV2CloudflareBindings, getV2PortabilityBucket } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { requireString } from "@/lib/v2/http/route-helpers";
import { stageArchiveRestore } from "@/lib/v2/portability/resumable-restore-v2";

const MAX_INTERACTIVE_ARCHIVE_BYTES = 90 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function requireArchiveLength(request: Request) {
  const value = request.headers.get("Content-Length");
  if (!value || !/^\d+$/.test(value)) {
    throw new V2HttpError(411, "archive_length_required", "Content-Length is required for archive restore.");
  }
  const sizeBytes = Number(value);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new V2HttpError(400, "archive_length_invalid", "Archive size must be a positive integer.");
  }
  if (sizeBytes > MAX_INTERACTIVE_ARCHIVE_BYTES) {
    throw new V2HttpError(413, "archive_size_limit", "Interactive restore accepts ZIP archives up to 90 MiB.");
  }
  return sizeBytes;
}

function archiveFileName(request: Request) {
  const encoded = request.headers.get("X-Lighthouse-Archive-Name");
  if (!encoded) return "lighthouse-restore.zip";
  try {
    const decoded = decodeURIComponent(encoded).trim();
    if (!decoded || decoded.length > 255 || /[\u0000-\u001f\u007f]/.test(decoded)) {
      throw new V2HttpError(400, "archive_name_invalid", "Archive filename header is invalid.");
    }
    return decoded;
  } catch {
    throw new V2HttpError(400, "archive_name_invalid", "Archive filename header is invalid.");
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/zip"] });
    if (!context.restrictedGrant) {
      throw new V2HttpError(403, "recent_reauthentication_required", "Restore staging requires recent reauthentication.");
    }
    const sizeBytes = requireArchiveLength(request);
    const idempotencyKey = requireString(request.headers.get("Idempotency-Key"), "Idempotency-Key");
    const archiveSha256 = requireString(request.headers.get("X-Lighthouse-Archive-Sha256"), "X-Lighthouse-Archive-Sha256").toLowerCase();
    if (!SHA256_PATTERN.test(archiveSha256)) {
      throw new V2HttpError(400, "archive_sha256_invalid", "X-Lighthouse-Archive-Sha256 must be a 64-character SHA-256 hex digest.");
    }
    if (!request.body) throw new V2HttpError(400, "archive_invalid", "A non-empty Lighthouse ZIP archive is required.");

    const bindings = getV2CloudflareBindings();
    const restore = await stageArchiveRestore({
      db: bindings.db,
      bucket: getV2PortabilityBucket(),
      userId: context.userId,
      idempotencyKey,
      archiveSha256,
      fileName: archiveFileName(request),
      body: request.body,
      sizeBytes,
    });
    return Response.json({ restore }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
