import { hasManualLinkSource, makeManualLinkMetadata, MANUAL_LINK_LIMITS } from "@/lib/v2/domain/manual-link-source";
import type { LocalSourceItem } from "@/lib/v2/offline/local-capture";

const CONVERSION_CONTRACT = "manual-share-conversion.v1" as const;
type ConversionChoice = "keep_memo" | "copy_source_text";
type ConversionMarker = Readonly<{ contract: typeof CONVERSION_CONTRACT; urlSourceId: string; textSourceId: string | null; choice: ConversionChoice }>;

export type LegacySharedUrl = Readonly<{
  source: LocalSourceItem;
  error: string | null;
  convertedSourceId: string | null;
  canUndo: boolean;
}>;

function marker(item: LocalSourceItem): ConversionMarker | null {
  const value = item.metadata?.shareConversionV1;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.contract !== CONVERSION_CONTRACT || typeof data.urlSourceId !== "string" || (data.textSourceId !== null && typeof data.textSourceId !== "string") || !["keep_memo", "copy_source_text"].includes(String(data.choice))) return null;
  return data as ConversionMarker;
}

function derivedId(urlSourceId: string) { return `manual-share:${encodeURIComponent(urlSourceId)}`; }

function sourceText(items: readonly LocalSourceItem[], selectedId: string | null) {
  if (selectedId === null) return "";
  const text = items.find((item) => item.sourceId === selectedId && item.kind === "text" && !hasManualLinkSource(item.metadata));
  if (!text) throw new Error("전환할 공유 텍스트를 다시 선택해 주세요.");
  return text.value;
}

function originalUrl(items: readonly LocalSourceItem[], urlSourceId: string) {
  const url = items.find((item) => item.sourceId === urlSourceId && item.kind === "url" && !hasManualLinkSource(item.metadata));
  if (!url) throw new Error("원래 공유 링크를 찾을 수 없습니다.");
  return url;
}

export function sharedTextCandidates(items: readonly LocalSourceItem[]) {
  return items.filter((item) => item.kind === "text" && !hasManualLinkSource(item.metadata));
}

export function canUndoSharedLinkConversion(items: readonly LocalSourceItem[], convertedSourceId: string) {
  const converted = items.find((item) => item.sourceId === convertedSourceId);
  if (!converted) return false;
  const conversion = marker(converted);
  if (!conversion) return false;
  try {
    const url = originalUrl(items, conversion.urlSourceId);
    const original = conversion.choice === "copy_source_text" ? sourceText(items, conversion.textSourceId) : "";
    return converted.value === original && JSON.stringify(converted.metadata?.manualLinkV1) === JSON.stringify(makeManualLinkMetadata({ url: url.value }).manualLinkV1);
  } catch { return false; }
}

export function legacySharedUrls(items: readonly LocalSourceItem[]): readonly LegacySharedUrl[] {
  return items.filter((item) => item.kind === "url" && !hasManualLinkSource(item.metadata)).map((source) => {
    let error: string | null = null;
    try { makeManualLinkMetadata({ url: source.value }); } catch (caught) { error = caught instanceof Error ? caught.message : "공유 URL 형식을 확인해 주세요."; }
    const converted = items.find((item) => item.sourceId === derivedId(source.sourceId) && marker(item)?.urlSourceId === source.sourceId);
    return { source, error, convertedSourceId: converted?.sourceId ?? null, canUndo: converted ? canUndoSharedLinkConversion(items, converted.sourceId) : false };
  });
}

/** Explicit additive conversion. Original URL/text/title rows and body remain untouched. */
export function convertSharedLink(input: {
  items: readonly LocalSourceItem[];
  urlSourceId: string;
  choice: ConversionChoice;
  textSourceId?: string | null;
  nextOrder?: number;
}): readonly LocalSourceItem[] {
  const url = originalUrl(input.items, input.urlSourceId);
  const id = derivedId(url.sourceId);
  const existing = input.items.find((item) => item.sourceId === id);
  if (existing) {
    if (marker(existing)?.urlSourceId !== url.sourceId) throw new Error("자료 식별자가 충돌했습니다. 원본은 변경하지 않았습니다.");
    return input.items;
  }
  if (input.items.filter((item) => hasManualLinkSource(item.metadata)).length >= MANUAL_LINK_LIMITS.sources) throw new Error(`링크 자료는 ${MANUAL_LINK_LIMITS.sources}개까지 보관합니다.`);
  const selectedTextId = input.choice === "copy_source_text" ? input.textSourceId ?? null : null;
  if (input.choice === "copy_source_text" && selectedTextId === null) throw new Error("출처 원문으로 복사할 공유 텍스트를 선택해 주세요.");
  const value = sourceText(input.items, selectedTextId);
  const metadata = makeManualLinkMetadata({ url: url.value });
  const order = Math.max(input.nextOrder ?? 0, ...input.items.map((item) => item.order + 1), 0);
  return [...input.items, {
    sourceId: id, order, kind: "url", value,
    metadata: { ...metadata, shareConversionV1: { contract: CONVERSION_CONTRACT, urlSourceId: url.sourceId, textSourceId: selectedTextId, choice: input.choice } satisfies ConversionMarker },
  }];
}

/** Undo only the unchanged derived row; never roll back unrelated edits or source rows. */
export function undoSharedLinkConversion(items: readonly LocalSourceItem[], convertedSourceId: string): readonly LocalSourceItem[] {
  if (!canUndoSharedLinkConversion(items, convertedSourceId)) throw new Error("전환 뒤 수정한 자료는 자동으로 되돌리지 않습니다. 내용을 확인한 뒤 자료 카드를 직접 제거해 주세요.");
  return items.filter((item) => item.sourceId !== convertedSourceId);
}
