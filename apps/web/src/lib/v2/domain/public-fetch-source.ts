/** Provenance for text actually acquired from a public page. User supplied URL
 * metadata remains a separate manualLinkV1 namespace on the same source. */
export const PUBLIC_FETCH_SOURCE_CONTRACT = "public-fetch-source.v1" as const;

export type PublicFetchSourceV1 = Readonly<{
  contract: typeof PUBLIC_FETCH_SOURCE_CONTRACT;
  requestedSourceItemId: string;
  requestedUrl: string;
  finalUrl: string;
  fetchedAt: string;
  contentType: "text/plain" | "text/html";
  extractionVersion: "plain_text" | "html_visible_text_v1";
}>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readPublicFetchSource(metadata: unknown): PublicFetchSourceV1 | null {
  if (!record(metadata) || !record(metadata.publicFetchV1)) return null;
  const value = metadata.publicFetchV1;
  if (value.contract !== PUBLIC_FETCH_SOURCE_CONTRACT
    || typeof value.requestedSourceItemId !== "string" || !value.requestedSourceItemId
    || typeof value.requestedUrl !== "string" || typeof value.finalUrl !== "string"
    || typeof value.fetchedAt !== "string" || !Number.isFinite(Date.parse(value.fetchedAt))
    || (value.contentType !== "text/plain" && value.contentType !== "text/html")
    || (value.extractionVersion !== "plain_text" && value.extractionVersion !== "html_visible_text_v1")) return null;
  try {
    const requested = new URL(value.requestedUrl), final = new URL(value.finalUrl);
    if (requested.protocol !== "https:" || final.protocol !== "https:"
      || requested.username || requested.password || final.username || final.password) return null;
  } catch { return null; }
  return value as PublicFetchSourceV1;
}
