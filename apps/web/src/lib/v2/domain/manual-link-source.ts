/** User-supplied link identity and intent. If publicFetchV1 is also present,
 * the raw text came from a separate bounded fetch rather than the user. */
export const MANUAL_LINK_CONTRACT = "manual-link-source.v1" as const;
export const MANUAL_LINK_LIMITS = { sources: 20, textBytes: 100_000, urlLength: 2048 } as const;
export const MANUAL_LINK_PURPOSES = ["reference", "prompt", "insight", "visual_tip", "video_note"] as const;
export const MANUAL_LINK_ROLES = ["source", "prompt", "negative_prompt", "parameters", "caption", "transcript"] as const;
export const MANUAL_LINK_COMPLETENESS = ["unknown", "complete", "partial", "ocr_unverified"] as const;

export type ManualLinkSourceV1 = Readonly<{
  contract: typeof MANUAL_LINK_CONTRACT;
  url: string;
  canonicalUrl: string;
  provider: "threads" | "instagram" | "youtube" | "web";
  purpose: typeof MANUAL_LINK_PURPOSES[number];
  role: typeof MANUAL_LINK_ROLES[number];
  completeness: typeof MANUAL_LINK_COMPLETENESS[number];
  publisher: string | null;
  partNumber: number | null;
  totalParts: number | null;
  startSeconds: number | null;
  endSeconds: number | null;
}>;

export type ManualLinkInput = Pick<ManualLinkSourceV1, "url"> & Partial<Pick<ManualLinkSourceV1,
  "purpose" | "role" | "completeness" | "publisher" | "partNumber" | "totalParts" | "startSeconds" | "endSeconds"
>>;

export class ManualLinkValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ManualLinkValidationError"; }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hasManualLinkSource(metadata: unknown): boolean {
  return object(metadata) && Object.prototype.hasOwnProperty.call(metadata, "manualLinkV1");
}

function choice<T extends string>(value: unknown, values: readonly T[], fallback: T, name: string): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !values.includes(value as T)) throw new ManualLinkValidationError(`${name} 값이 올바르지 않습니다.`);
  return value as T;
}

function integer(value: unknown, name: string, min: number, max: number): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ManualLinkValidationError(`${name} 범위를 확인해 주세요 (${min}–${max}).`);
  }
  return value;
}

export function normalizeManualLinkSource(value: unknown): ManualLinkSourceV1 {
  if (!object(value)) throw new ManualLinkValidationError("링크 자료 형식이 올바르지 않습니다.");
  if (value.contract !== undefined && value.contract !== MANUAL_LINK_CONTRACT) throw new ManualLinkValidationError("지원하지 않는 링크 자료 버전입니다.");
  if (typeof value.url !== "string" || !value.url.trim() || value.url.length > MANUAL_LINK_LIMITS.urlLength) {
    throw new ManualLinkValidationError("출처 URL을 입력해 주세요 (최대 2,048자).");
  }
  const originalUrl = value.url.trim();
  let url: URL;
  try { url = new URL(originalUrl); } catch { throw new ManualLinkValidationError("출처 URL 형식을 확인해 주세요."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new ManualLinkValidationError("로그인 정보가 없는 HTTPS 출처 URL을 사용해 주세요.");
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const provider = host === "threads.com" || host === "threads.net" ? "threads"
    : host === "instagram.com" ? "instagram"
      : ["youtube.com", "m.youtube.com", "youtu.be"].includes(host) ? "youtube" : "web";
  // Keep the submitted URL intact for provenance. Only known tracking parameters
  // are removed from the comparison URL; timestamps/query identity are preserved.
  for (const key of Array.from(url.searchParams.keys())) {
    if (/^utm_/i.test(key) || ["fbclid", "gclid"].includes(key)
      || (provider === "threads" && key === "xmt")
      || (provider === "instagram" && key === "igsh")
      || (provider === "youtube" && key === "si")) url.searchParams.delete(key);
  }
  const partNumber = integer(value.partNumber, "조각 번호", 1, 100);
  const totalParts = integer(value.totalParts, "전체 조각 수", 1, 100);
  if (partNumber !== null && totalParts !== null && partNumber > totalParts) throw new ManualLinkValidationError("조각 번호는 전체 조각 수보다 클 수 없습니다.");
  const startSeconds = integer(value.startSeconds, "시작 초", 0, 604800);
  const endSeconds = integer(value.endSeconds, "종료 초", 0, 604800);
  if (endSeconds !== null && (startSeconds === null || endSeconds <= startSeconds)) throw new ManualLinkValidationError("종료 시각은 시작 시각보다 뒤여야 합니다.");
  if (value.publisher !== undefined && value.publisher !== null && (typeof value.publisher !== "string" || value.publisher.length > 200)) {
    throw new ManualLinkValidationError("작성자 표시는 200자 이내로 입력해 주세요.");
  }
  return {
    contract: MANUAL_LINK_CONTRACT, url: originalUrl, canonicalUrl: url.toString(), provider,
    purpose: choice(value.purpose, MANUAL_LINK_PURPOSES, "reference", "보관 목적"),
    role: choice(value.role, MANUAL_LINK_ROLES, "source", "자료 역할"),
    completeness: choice(value.completeness, MANUAL_LINK_COMPLETENESS, "unknown", "확보 상태"),
    publisher: typeof value.publisher === "string" ? value.publisher.trim() || null : null,
    partNumber, totalParts, startSeconds, endSeconds,
  };
}

export function makeManualLinkMetadata(input: ManualLinkInput): Readonly<{ manualLinkV1: ManualLinkSourceV1 }> {
  return { manualLinkV1: normalizeManualLinkSource(input) };
}

/** Read only this namespace; never project arbitrary imported metadata to clients. */
export function readManualLinkSource(metadata: unknown): ManualLinkSourceV1 | null {
  if (!object(metadata) || !hasManualLinkSource(metadata)) return null;
  try { return normalizeManualLinkSource(metadata.manualLinkV1); } catch { return null; }
}
