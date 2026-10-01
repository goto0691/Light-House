import type { ManualLinkSourceV1 } from "@/lib/v2/domain/manual-link-source";

export const LINK_SNAPSHOT_MANIFEST_VERSION = "link-source-manifest.v1" as const;
export const LINK_SNAPSHOT_MAX_SOURCES = 40;

export class LinkSnapshotError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "LinkSnapshotError"; }
}

export type LinkSnapshotV1 = Readonly<{
  id: string;
  userId: string;
  documentId: string;
  captureId: string;
  parentSnapshotId: string | null;
  snapshotVersion: number;
  manifestVersion: typeof LINK_SNAPSHOT_MANIFEST_VERSION;
  manifestHash: string;
  acquisitionMethod: "user_paste" | "user_upload" | "api" | "public_fetch";
  adapterVersion: string;
  captureState: "link_only" | "partial" | "captured" | "needs_input" | "unavailable";
  coverage: Readonly<Record<string, unknown>>;
  createdAt: string;
}>;

export type LinkSnapshotAttachmentV1 = Readonly<{
  id: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  filename: string;
}>;

export type LinkSnapshotMemberV1 = Readonly<{
  id: string;
  snapshotId: string;
  sourceItemId: string;
  memberKey: string;
  sourceOrder: number;
  sourceFingerprint: string;
  kind: string;
  rawText: string | null;
  contentHash: string;
  metadata: Readonly<Record<string, unknown>> | null;
  manualLink: ManualLinkSourceV1 | null;
  attachments: readonly LinkSnapshotAttachmentV1[];
}>;

/** Stable JSON for hashes: object key order is not source content; array order is. */
export function canonicalLinkJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalLinkJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => compareCodeUnits(left, right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalLinkJson(item)}`).join(",")}}`;
  }
  throw new LinkSnapshotError("link_snapshot_invalid", "Only finite JSON values belong to a link snapshot.");
}

function compareCodeUnits(left: string, right: string) { return left < right ? -1 : left > right ? 1 : 0; }

export async function linkSha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeLinkHash(value: string) {
  const hash = value.replace(/^sha256:/, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new LinkSnapshotError("link_source_hash_invalid", "A source hash is not SHA-256.");
  return hash;
}

export async function createLinkSourceFingerprint(input: {
  kind: string;
  contentHash: string;
  rawText: string | null;
  metadata: Readonly<Record<string, unknown>> | null;
  attachments: readonly Pick<LinkSnapshotAttachmentV1, "sha256" | "mimeType" | "sizeBytes">[];
}) {
  const contentHash = normalizeLinkHash(input.contentHash);
  if (input.rawText !== null && await linkSha256Hex(input.rawText) !== contentHash) {
    throw new LinkSnapshotError("link_source_hash_mismatch", "The source text no longer matches its preserved hash.");
  }
  const attachments = input.attachments.map((item) => ({ sha256: normalizeLinkHash(item.sha256), mimeType: item.mimeType, sizeBytes: item.sizeBytes }))
    .sort((left, right) => compareCodeUnits(canonicalLinkJson(left), canonicalLinkJson(right)));
  return linkSha256Hex(canonicalLinkJson({
    kind: input.kind, contentHash, metadataHash: await linkSha256Hex(canonicalLinkJson(input.metadata)), attachments,
  }));
}

export async function hashLinkSourceManifest(input: { members: readonly Pick<LinkSnapshotMemberV1, "memberKey" | "sourceOrder" | "sourceFingerprint">[] }) {
  if (!input.members.length || input.members.length > LINK_SNAPSHOT_MAX_SOURCES) throw new LinkSnapshotError("link_snapshot_invalid", "Select between 1 and 40 source items.");
  const keys = new Set<string>();
  const members = [...input.members].sort((left, right) => left.sourceOrder - right.sourceOrder);
  members.forEach((member, index) => {
    if (!member.memberKey || keys.has(member.memberKey) || member.sourceOrder !== index) throw new LinkSnapshotError("link_snapshot_invalid", "Snapshot member keys and source order must be unique and contiguous.");
    keys.add(member.memberKey);
    normalizeLinkHash(member.sourceFingerprint);
  });
  return linkSha256Hex(canonicalLinkJson({ version: LINK_SNAPSHOT_MANIFEST_VERSION, members: members.map(({ memberKey, sourceOrder, sourceFingerprint }) => ({ memberKey, sourceOrder, sourceFingerprint })) }));
}
