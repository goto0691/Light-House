import { sha256 } from "@noble/hashes/sha2";

export const RECORD_LOCATION_CONTRACT = "record-location.v1" as const;
export const RECORD_LOCATION_RESULT_CONTRACT = "record-location-result.v1" as const;
export const RETRIEVAL_MATCHES_CONTRACT = "retrieval-matches.v1" as const;
export const RECORD_LOCATION_QUERY_KEY = "loc";
export const RECORD_LOCATION_MAX_LENGTH = 3_000;

export type RecordTextRange = Readonly<{ start: number; end: number }>;
type LocationBase = Readonly<{ contract: typeof RECORD_LOCATION_CONTRACT; range: RecordTextRange | null; textHash: string }>;
type SnapshotLocation = Readonly<{ snapshotId: string; manifestHash: string; sourceItemId: string; memberId: string }>;
/** A locator is an untrusted request, never a grant or proof of stored content. */
export type V2RecordLocationV1 = LocationBase & (
  | Readonly<{ kind: "document_title" | "document_body"; revisionId: string; documentVersion: number }>
  | Readonly<{ kind: "source"; sourceItemId: string; snapshotId: string | null; manifestHash: string | null; memberId: string | null }>
  | (SnapshotLocation & Readonly<{ kind: "manual_fragment"; fragmentId: string }>)
  | (SnapshotLocation & Readonly<{ kind: "ai_fragment"; fragmentId: string; runId: string }>)
  | Readonly<{ kind: "curation"; snapshotId: string; manifestHash: string; groupKey: string; revisionId: string; role: "title" | "prompt" | "negative_prompt" | "parameters" }>
);
export type V2RetrievalOrigin = "document_title" | "document_body" | "user_note" | "external_source" | "source"
  | "manual_extract" | "ai_extract" | "ai_interpretation" | "curation";
export type V2RetrievalMatch = Readonly<{
  id: string; origin: V2RetrievalOrigin; label: string; snippet: string | null; location: V2RecordLocationV1;
  reviewStatus: string | null; isHistorical: boolean;
}>;
/** Counts origin fields/roles, not every repeated substring inside one field. */
export type V2RetrievalMatchPage = Readonly<{
  matches: readonly V2RetrievalMatch[]; totalCount: number; page: number; pageSize: number; totalPages: number;
  /** Same SQL snapshot as the matches; null means no accessible matching record. */
  privacyLevel: "normal" | "sensitive" | "restricted" | null;
}>;
export type V2RecordLocationResult = Readonly<{
  contract: typeof RECORD_LOCATION_RESULT_CONTRACT; recordId: string; location: V2RecordLocationV1;
  origin: V2RetrievalOrigin; label: string; text: string; textHash: string; range: RecordTextRange | null;
  privacyLevel: "normal" | "sensitive" | "restricted"; accessExpiresAt: string | null;
  reviewStatus: string | null; isHistorical: boolean;
  context: Readonly<{ documentRevisionId: string | null; snapshotId: string | null; snapshotVersion: number | null;
    runId: string | null; groupKey: string | null; curationRevisionId: string | null }>;
  evidence: readonly Readonly<{ sourceItemId: string; memberId: string | null; label: string; quote: string;
    textStart: number | null; textEnd: number | null }>[];
  attachments: readonly Readonly<{ attachmentId: string; filename: string; mimeType: string;
    itemKey: string | null; evidenceMethod: "unresolved" | "user_confirmed" | "source_attachment" }>[];
  copy: Readonly<{ allowed: boolean; mode: "exact" | "standard" | "available_only" | null; reason: string | null; warnings: readonly string[] }>;
}>;

export class RecordLocationError extends Error {
  constructor(readonly code: "record_location_invalid" | "record_location_not_found" | "record_location_conflict" | "record_location_integrity_invalid", message: string) {
    super(message); this.name = "RecordLocationError";
  }
}
function invalid(): never { throw new RecordLocationError("record_location_invalid", "보관 위치의 종류·버전·텍스트 범위를 확인해 주세요."); }
function ownData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const data: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return invalid();
    data[key] = descriptor.value;
  }
  return data;
}
function keys(data: Record<string, unknown>, expected: readonly string[]) {
  if (Object.keys(data).length !== expected.length || Object.keys(data).some((key) => !expected.includes(key))) invalid();
}
function id(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value) || /[\uD800-\uDFFF]/u.test(value)) return invalid();
  return value;
}
function hash(value: unknown): string { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) return invalid(); return value; }
function range(value: unknown): RecordTextRange | null {
  if (value === null) return null;
  const data = ownData(value); keys(data, ["start", "end"]);
  if (!Number.isSafeInteger(data.start) || !Number.isSafeInteger(data.end) || Number(data.start) < 0 || Number(data.end) <= Number(data.start)) return invalid();
  return Object.freeze({ start: Number(data.start), end: Number(data.end) });
}

/** Capture primitive own data synchronously, before any repository await. */
export function parseRecordLocation(value: unknown): V2RecordLocationV1 {
  const data = ownData(value), common = ["contract", "kind", "range", "textHash"];
  if (data.contract !== RECORD_LOCATION_CONTRACT) return invalid();
  const base = { contract: RECORD_LOCATION_CONTRACT, range: range(data.range), textHash: hash(data.textHash) };
  if (data.kind === "document_title" || data.kind === "document_body") {
    keys(data, [...common, "revisionId", "documentVersion"]);
    if (!Number.isSafeInteger(data.documentVersion) || Number(data.documentVersion) < 1) return invalid();
    return Object.freeze({ ...base, kind: data.kind, revisionId: id(data.revisionId), documentVersion: Number(data.documentVersion) });
  }
  if (data.kind === "source") {
    keys(data, [...common, "sourceItemId", "snapshotId", "manifestHash", "memberId"]);
    if (data.snapshotId === null && data.manifestHash === null && data.memberId === null)
      return Object.freeze({ ...base, kind: "source", sourceItemId: id(data.sourceItemId), snapshotId: null, manifestHash: null, memberId: null });
    return Object.freeze({ ...base, kind: "source", sourceItemId: id(data.sourceItemId), snapshotId: id(data.snapshotId), manifestHash: hash(data.manifestHash), memberId: id(data.memberId) });
  }
  if (data.kind === "manual_fragment" || data.kind === "ai_fragment") {
    keys(data, [...common, "snapshotId", "manifestHash", "sourceItemId", "memberId", "fragmentId", ...(data.kind === "ai_fragment" ? ["runId"] : [])]);
    const snapshot = { snapshotId: id(data.snapshotId), manifestHash: hash(data.manifestHash), sourceItemId: id(data.sourceItemId), memberId: id(data.memberId), fragmentId: id(data.fragmentId) };
    return data.kind === "ai_fragment" ? Object.freeze({ ...base, ...snapshot, kind: "ai_fragment", runId: id(data.runId) }) : Object.freeze({ ...base, ...snapshot, kind: "manual_fragment" });
  }
  if (data.kind === "curation") {
    keys(data, [...common, "snapshotId", "manifestHash", "groupKey", "revisionId", "role"]);
    if (!["title", "prompt", "negative_prompt", "parameters"].includes(data.role as string)) return invalid();
    return Object.freeze({ ...base, kind: "curation", snapshotId: id(data.snapshotId), manifestHash: hash(data.manifestHash),
      groupKey: id(data.groupKey), revisionId: id(data.revisionId), role: data.role as "title" | "prompt" | "negative_prompt" | "parameters" });
  }
  return invalid();
}

export function parseRecordLocationParam(value: string | string[] | null | undefined): V2RecordLocationV1 | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value || value.length > RECORD_LOCATION_MAX_LENGTH) return invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return invalid(); }
  return parseRecordLocation(parsed);
}
export function serializeRecordLocation(location: V2RecordLocationV1): string {
  const serialized = JSON.stringify(parseRecordLocation(location));
  if (serialized.length > RECORD_LOCATION_MAX_LENGTH) return invalid();
  return serialized;
}
export function recordLocationHref(recordId: string, location: V2RecordLocationV1): string {
  return `/v2/records/${encodeURIComponent(id(recordId))}?${new URLSearchParams({ [RECORD_LOCATION_QUERY_KEY]: serializeRecordLocation(location) })}#record-search-location`;
}
/** Synchronous digest: no asynchronous gap after the final access/evidence fence. */
export function recordLocationTextHash(text: string): string {
  return Array.from(sha256(new TextEncoder().encode(text)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function assertRecordLocationText(location: V2RecordLocationV1, text: string) {
  if (recordLocationTextHash(text) !== location.textHash) throw new RecordLocationError("record_location_conflict", "검색 당시의 정확한 보관 텍스트와 일치하지 않습니다. 다른 자료로 대체하지 않았습니다.");
  if (location.range && (location.range.end > text.length || splitSurrogate(text, location.range.start) || splitSurrogate(text, location.range.end))) invalid();
}
function splitSurrogate(text: string, offset: number) {
  return offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]);
}
/** RegExp indices refer to original UTF-16 text, not a length-changing lowercase copy. */
export function firstRecordTextMatch(text: string, tokens: readonly string[]): RecordTextRange | null {
  let first: RecordTextRange | null = null;
  for (const token of tokens) {
    if (!token) continue;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(escaped, "iu").exec(text);
    if (match && (!first || match.index < first.start)) first = { start: match.index, end: match.index + match[0].length };
  }
  return first;
}
