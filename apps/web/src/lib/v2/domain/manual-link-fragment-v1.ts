import { LinkSnapshotError } from "@/lib/v2/domain/link-snapshot-v1";
import { PROMPT_CURATION_ROLES, type PromptCopyRole, type PromptCurationFragment } from "@/lib/v2/domain/prompt-curation-v1";

export const MANUAL_LINK_FRAGMENT_CONTRACT = "manual-link-fragment.v1" as const;
export const MANUAL_LINK_FRAGMENT_PAGE_SIZE = 20;
export const MANUAL_LINK_FRAGMENT_PAGE_BYTES = 100_000;

export type CreateManualLinkFragmentRequest = Readonly<{
  expectedRevisionId: string; expectedSnapshotId: string; expectedManifestHash: string;
  memberId: string; textStart: number; textEnd: number; role: PromptCopyRole; idempotencyKey: string;
}>;
/** Separate from published AI-run fragments; a manual selection has no processing run. */
export type StoredManualLinkFragment = Readonly<{
  id: string; fragmentKey: string; snapshotId: string; primaryMemberId: string; createdAt: string;
  stateVersion: number; reviewStatus: "confirmed" | "rejected" | "superseded";
  fragment: PromptCurationFragment;
}>;
export type ManualLinkFragmentReceipt = Readonly<{ contract: typeof MANUAL_LINK_FRAGMENT_CONTRACT; item: StoredManualLinkFragment; replayed: boolean }>;
export type ManualLinkFragmentPage = Readonly<{
  contract: typeof MANUAL_LINK_FRAGMENT_CONTRACT; recordId: string; currentRevisionId: string;
  currentSnapshotId: string | null; selectedSnapshotId: string | null; isHistorical: boolean;
  items: readonly StoredManualLinkFragment[]; nextCursor: string | null;
}>;

function invalid(): never { throw new LinkSnapshotError("manual_link_fragment_invalid", "수동 발췌 요청의 필드와 범위를 확인해 주세요."); }
export function manualFragmentId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) return invalid();
  return value;
}
/** Copy primitive own data before any await; reject accessors and client authority/content fields. */
export function parseManualLinkFragmentRequest(value: unknown): CreateManualLinkFragmentRequest {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const keys = ["expectedRevisionId", "expectedSnapshotId", "expectedManifestHash", "memberId", "textStart", "textEnd", "role", "idempotencyKey"];
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some((key) => typeof key !== "string" || !keys.includes(key))) return invalid();
  const data: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return invalid();
    data[key] = descriptor.value;
  }
  if (typeof data.expectedManifestHash !== "string" || !/^[a-f0-9]{64}$/.test(data.expectedManifestHash)
    || !Number.isSafeInteger(data.textStart) || !Number.isSafeInteger(data.textEnd)
    || Number(data.textStart) < 0 || Number(data.textEnd) <= Number(data.textStart)
    || !PROMPT_CURATION_ROLES.includes(data.role as PromptCopyRole)) return invalid();
  return { expectedRevisionId: manualFragmentId(data.expectedRevisionId), expectedSnapshotId: manualFragmentId(data.expectedSnapshotId),
    expectedManifestHash: data.expectedManifestHash, memberId: manualFragmentId(data.memberId),
    textStart: data.textStart as number, textEnd: data.textEnd as number, role: data.role as PromptCopyRole,
    idempotencyKey: manualFragmentId(data.idempotencyKey) };
}
