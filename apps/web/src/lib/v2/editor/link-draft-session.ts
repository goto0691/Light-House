import { captureRecoveryInput, type EditorRecoveryPolicyInput } from "./editor-working-copy";
import type { LinkWorkingCopy } from "./link-working-copy";

type CopyVersion = Readonly<{ id: string; generation: number }>;
type SaveProof = Readonly<{ copy: LinkWorkingCopy; stageIdentity: object }>;
/** In-memory receipt handle, never serialized as authority in a recovery payload. */
export type LinkDraftSaveToken = CopyVersion & Readonly<{ origin: CopyVersion | null }>;

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** One active draft, independent parked IDs, and immutable completion handles. */
export class LinkDraftSession {
  private readonly identity: Pick<EditorRecoveryPolicyInput, "ownerId" | "recordId">;
  private active: LinkWorkingCopy | null = null;
  private origin: CopyVersion | null = null;
  private generation = 0;
  private stageIdentity: object | null = null;
  private tokens = new WeakMap<LinkDraftSaveToken, SaveProof>();

  constructor(identity: Pick<EditorRecoveryPolicyInput, "ownerId" | "recordId">,
    private readonly kind: LinkWorkingCopy["kind"]) {
    this.identity = Object.freeze({ ownerId: identity.ownerId, recordId: identity.recordId });
  }

  get current() { return this.active; }
  snapshot() { return this.active; }

  stage(payload: unknown, scopeKey: string, policy: EditorRecoveryPolicyInput): LinkDraftSaveToken {
    if (policy.ownerId !== this.identity.ownerId || policy.recordId !== this.identity.recordId) throw new Error("다른 계정·기록의 초안을 저장할 수 없습니다.");
    // Capture synchronously before a debounce, caller mutation, encryption, or a server request.
    const captured = freeze(captureRecoveryInput(payload));
    this.active = Object.freeze({ ...this.identity, id: this.active?.id ?? crypto.randomUUID(), generation: ++this.generation,
      baseVersion: policy.currentVersion, privacyLevel: policy.privacyLevel, kind: this.kind, scopeKey,
      updatedAt: new Date().toISOString(), payload: captured });
    // Even an equal primitive or an identical new draft is a distinct user input.
    this.stageIdentity = Object.freeze({});
    const token = Object.freeze({ id: this.active.id, generation: this.active.generation, origin: this.origin });
    this.tokens.set(token, { copy: this.active, stageIdentity: this.stageIdentity });
    return token;
  }

  refreshPolicy(policy: EditorRecoveryPolicyInput) {
    if (!this.active || this.active.baseVersion === policy.currentVersion && this.active.privacyLevel === policy.privacyLevel) return;
    if (policy.ownerId !== this.identity.ownerId || policy.recordId !== this.identity.recordId) throw new Error("초안 보호 정책의 계정·기록이 다릅니다.");
    this.active = Object.freeze({ ...this.active, baseVersion: policy.currentVersion, privacyLevel: policy.privacyLevel, generation: ++this.generation });
  }

  /** A failed write or intervening edit must never discard the active input. */
  async park(persist: (copy: LinkWorkingCopy) => Promise<boolean>): Promise<boolean> {
    const copy = this.active;
    if (!copy) return true;
    if (!await persist(copy) || this.active !== copy) return false;
    this.clear();
    return true;
  }

  restore(row: LinkWorkingCopy, payload: unknown, policy: EditorRecoveryPolicyInput): LinkDraftSaveToken {
    if (this.active) throw new Error("현재 초안을 보존한 뒤 복구해 주세요.");
    if (row.ownerId !== this.identity.ownerId || row.recordId !== this.identity.recordId || row.kind !== this.kind) throw new Error("다른 계정·기록·유형의 초안은 복구할 수 없습니다.");
    this.origin = Object.freeze({ id: row.id, generation: row.generation });
    try { return this.stage(payload, row.scopeKey, policy); }
    catch (error) { this.origin = null; throw error; }
  }

  /** Call only after the UI validates the exact server receipt for this token's request. */
  async saved(token: LinkDraftSaveToken, remove: (id: string, generation: number) => Promise<void>) {
    const proof = this.tokens.get(token);
    if (!proof) throw new Error("이 편집 화면에서 보낸 저장 요청이 아닙니다.");
    const matches = () => this.active?.id === token.id && this.origin === token.origin
      && this.stageIdentity === proof.stageIdentity && this.active.scopeKey === proof.copy.scopeKey
      && Object.is(this.active.payload, proof.copy.payload);
    // Only refreshPolicy may advance this exact frozen input's cleanup generation.
    // Capture once: a later edit/policy refresh must exceed this deletion tombstone.
    const copy = matches() ? this.active : null;
    await remove(token.id, copy?.generation ?? token.generation);
    if (token.origin) await remove(token.origin.id, token.origin.generation);
    if (copy && matches()) {
      if (this.active !== copy) throw new Error("초안 보호 정책이 정리 중 변경되었습니다. 입력을 유지했으니 저장 결과를 다시 확인해 주세요.");
      this.clear();
    }
    // Retrying cleanup is safe, including partial IndexedDB failure. Do not invalidate the token.
  }

  async disable(remove: (id: string, generation: number) => Promise<void>) {
    const copy = this.active;
    if (copy) await remove(copy.id, copy.generation);
    if (copy && this.active === copy) {
      this.active = Object.freeze({ ...copy, generation: ++this.generation });
      this.stageIdentity = Object.freeze({}); // Revocation is not a policy-only refresh.
    }
  }

  clear() { this.active = null; this.origin = null; this.stageIdentity = null; }
}
