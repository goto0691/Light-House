import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { V2HttpError } from "@/lib/v2/http/request-context";

export function requireV2Route(options: { write?: boolean } = {}) {
  const flags = getV2ServerFeatureFlags();
  if (!flags.routes) throw new V2HttpError(404, "v2_routes_disabled", "The V2 route is not enabled.");
  if (options.write && !flags.write) throw new V2HttpError(503, "v2_write_disabled", "V2 writes are not enabled.");
  return flags;
}

export async function readJsonObject(request: Request, options: { maxBytes?: number } = {}) {
  let value: unknown;
  try {
    if (options.maxBytes !== undefined && request.body) {
      const maxBytes = options.maxBytes;
      if (Number(request.headers.get("content-length")) > maxBytes) throw new V2HttpError(413, "request_too_large", "The request body exceeds the capture size limit.");
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          total += chunk.value.byteLength;
          if (total > maxBytes) {
            await reader.cancel();
            throw new V2HttpError(413, "request_too_large", "The request body exceeds the capture size limit.");
          }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      value = JSON.parse(new TextDecoder().decode(bytes));
    } else value = await request.json();
  } catch (error) {
    if (error instanceof V2HttpError) throw error;
    throw new V2HttpError(400, "invalid_json", "The request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new V2HttpError(400, "invalid_json_shape", "The request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new V2HttpError(400, "invalid_field", `${label} is required.`);
  return value;
}
