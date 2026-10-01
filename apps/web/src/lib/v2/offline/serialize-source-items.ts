import type { CaptureCommitRequest } from "@/lib/v2/domain/capture-source";
import type { LocalSourceItem } from "@/lib/v2/offline/local-capture";

export type CaptureCommitSource = NonNullable<CaptureCommitRequest["sources"]>[number];
export type OrderedCaptureCommitSource = CaptureCommitSource & Readonly<{ sourceOrder: number }>;

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Serialize stored originals without rewriting text, in capture order with uploaded files. */
export async function serializeLocalSourceItems(
  items: readonly LocalSourceItem[],
  additionalSources: readonly OrderedCaptureCommitSource[] = [],
): Promise<NonNullable<CaptureCommitRequest["sources"]>> {
  const sources: OrderedCaptureCommitSource[] = [...additionalSources];
  for (const item of items) {
    // Title and text already belong to bodyMarkdown; attachment payloads require verified uploads.
    if (item.kind !== "url") continue;
    sources.push({
      sourceOrder: item.order,
      kind: "url",
      rawText: item.value,
      contentHash: await sha256Text(item.value),
      ...(item.metadata ? { metadata: item.metadata } : {}),
    });
  }
  return sources.sort((left, right) => left.sourceOrder - right.sourceOrder)
    .map(({ sourceOrder: _sourceOrder, ...source }) => source);
}
