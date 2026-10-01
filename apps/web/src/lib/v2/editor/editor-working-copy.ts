import { deleteDB, openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";

export type RecoveryCopyIdentity = { id: string; ownerId: string; recordId: string; generation: number; baseVersion: number;
  privacyLevel: "normal" | "sensitive" | "restricted"; updatedAt: string };

export type EditorWorkingCopy = {
  id: string;
  ownerId: string;
  recordId: string;
  generation: number;
  baseRevisionId: string;
  baseVersion: number;
  title: string;
  bodyMarkdown: string;
  writtenAt: string;
  documentStatus: "inbox" | "draft" | "revising" | "finished" | "archived";
  privacyLevel: "normal" | "sensitive" | "restricted";
  updatedAt: string;
};

type CopyRow = { id: string; ownerRecord: string; generation: number; updatedAt: string } & (
  | { encrypted: false; value: EditorWorkingCopy }
  | { encrypted: true; ciphertext: ArrayBuffer; iv: Uint8Array }
);
export type EditorRecoveryPolicyInput = {
  ownerId: string; recordId: string; currentVersion: number;
  privacyLevel: EditorWorkingCopy["privacyLevel"];
};
export type PolicyRow = {
  ownerRecord: string; serverVersion: number;
  serverPrivacy: EditorWorkingCopy["privacyLevel"]; serverObserved: boolean; localFloor: number;
};
export type LinkCopyRow = { id: string; ownerRecord: string; generation: number; updatedAt: string; digest: string } & (
  | { encrypted: false; value: RecoveryCopyIdentity }
  | { encrypted: true; ciphertext: ArrayBuffer; iv: Uint8Array }
);
export type LinkCopyTombstone = { id: string; ownerRecord: string | null; generation: number };
export interface CopySchema extends DBSchema {
  copies: { key: string; value: CopyRow; indexes: { "by-owner-record": string } };
  keys: { key: string; value: { id: string; key: CryptoKey } };
  policies: { key: string; value: PolicyRow };
  links: { key: string; value: LinkCopyRow; indexes: { "by-owner-record": string } };
  linkTombstones: { key: string; value: LinkCopyTombstone; indexes: { "by-owner-record": string } };
}

export function ownerRecord(ownerId: string, recordId: string) { return JSON.stringify([ownerId, recordId]); }
export function rank(privacy: EditorWorkingCopy["privacyLevel"]) { return privacy === "restricted" ? 2 : privacy === "sensitive" ? 1 : 0; }
export function validPolicy(input: EditorRecoveryPolicyInput) {
  if (typeof input.ownerId !== "string" || !input.ownerId || typeof input.recordId !== "string" || !input.recordId || !Number.isSafeInteger(input.currentVersion) || input.currentVersion < 1
    || !["normal", "sensitive", "restricted"].includes(input.privacyLevel)) throw new Error("Invalid editor recovery policy.");
}

/** Recovery payloads are bounded JSON data; never call getters/toJSON or retain
 * a caller's mutable object across IndexedDB/crypto awaits. */
export function captureRecoveryInput<T>(value: T): T {
  const ancestors = new Set<object>(); let nodes = 0, chars = 0;
  function capture(value: unknown, depth: number): unknown {
    if (++nodes > 100_000 || depth > 30) throw new Error("Recovery input exceeds its structural budget.");
    if (typeof value === "string") { chars += value.length; if (chars > 2_000_000) throw new Error("Recovery input exceeds its text budget."); return value; }
    if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
    if (!value || typeof value !== "object" || ancestors.has(value)) throw new Error("Recovery input must be acyclic JSON data.");
    const array = Array.isArray(value);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Recovery input must contain only plain data.");
    if (array && Object.keys(value).length !== value.length) throw new Error("Recovery arrays must not contain holes.");
    ancestors.add(value); const result: Record<string, unknown> | unknown[] = array ? [] : {};
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== "string" || array && !/^(0|[1-9]\d*)$/.test(key) || !descriptor || !("value" in descriptor)) throw new Error("Recovery accessors and non-data fields are not supported.");
      Object.defineProperty(result, key, { value: capture(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(value); return result;
  }
  return capture(value, 0) as T;
}
export const RECOVERY_POLICY_STORES = ["copies", "links", "linkTombstones", "policies"] as const;
export type RecoveryTransaction = IDBPTransaction<CopySchema, typeof RECOVERY_POLICY_STORES, "readwrite">;
export async function retireLinkRow(tx: RecoveryTransaction, row: Pick<LinkCopyRow, "id" | "ownerRecord" | "generation">) {
  const prior = await tx.objectStore("linkTombstones").get(row.id);
  await tx.objectStore("linkTombstones").put({ id: row.id, ownerRecord: row.ownerRecord, generation: Math.max(prior?.generation ?? -1, row.generation) });
  await tx.objectStore("links").delete(row.id);
}
async function purgeBelowFloor(tx: RecoveryTransaction, key: string, floor: number) {
  for (const row of await tx.objectStore("copies").index("by-owner-record").getAll(key)) {
    if (floor === 2 || floor === 1 && !row.encrypted) await tx.objectStore("copies").delete(row.id);
  }
  for (const row of await tx.objectStore("links").index("by-owner-record").getAll(key)) {
    if (floor === 2 || floor === 1 && !row.encrypted) await retireLinkRow(tx, row);
  }
}

/** Editing recovery is separate from the capture outbox: it is never uploaded as a new capture. */
export class WorkingCopyDatabase {
  private database: Promise<IDBPDatabase<CopySchema>> | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly name = "lighthouse_editor_working_copies_v1") {}
  protected open() {
    if (this.database) return this.database;
    let upgradeBlocked = false;
    let rejectBlocked!: (error: Error) => void;
    let pending: Promise<IDBPDatabase<CopySchema>>;
    const blocked = new Promise<never>((_resolve, reject) => { rejectBlocked = reject; });
    const opening = openDB<CopySchema>(this.name, 3, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const copies = db.createObjectStore("copies", { keyPath: "id" });
          copies.createIndex("by-owner-record", "ownerRecord");
          db.createObjectStore("keys", { keyPath: "id" });
        }
        if (oldVersion < 2) db.createObjectStore("policies", { keyPath: "ownerRecord" });
        if (oldVersion < 3) {
          db.createObjectStore("links", { keyPath: "id" }).createIndex("by-owner-record", "ownerRecord");
          db.createObjectStore("linkTombstones", { keyPath: "id" }).createIndex("by-owner-record", "ownerRecord");
        }
      },
      blocked() {
        upgradeBlocked = true;
        rejectBlocked(new Error("다른 편집 탭이 복구 사본 보호 업데이트를 막고 있습니다. 오래된 편집 탭을 닫고 다시 시도해 주세요."));
      },
      blocking: (_current, _next, event) => {
        (event.target as IDBDatabase | null)?.close();
        if (this.database === pending) this.database = null;
      },
      terminated: () => { if (this.database === pending) this.database = null; },
    }).then((db) => {
      // The native upgrade request cannot be canceled. If it later succeeds,
      // close it rather than running a policy operation already reported failed.
      if (upgradeBlocked) { db.close(); throw new Error("복구 사본 보호 업데이트를 다시 시도해 주세요."); }
      return db;
    });
    pending = Promise.race([opening, blocked]);
    this.database = pending;
    // A blocked native request is still alive. Reuse its reported failure for
    // repeated effects, otherwise another open queues behind it without firing
    // blocked and callers wait forever. Release only when that request settles.
    void pending.catch(() => { if (!upgradeBlocked && this.database === pending) this.database = null; });
    void opening.catch(() => { if (this.database === pending) this.database = null; });
    return pending;
  }
  protected serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => undefined).then(work);
    this.tail = next;
    return next;
  }
  protected async key(db: IDBPDatabase<CopySchema>, ownerId: string) {
    const prior = await db.get("keys", ownerId);
    if (prior) return prior.key;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const tx = db.transaction("keys", "readwrite");
    const concurrent = await tx.store.get(ownerId);
    if (!concurrent) await tx.store.put({ id: ownerId, key });
    await tx.done;
    return concurrent?.key ?? key;
  }
  /** Only authenticated server state may advance the version and relax a floor. */
  observeServerPolicy(input: EditorRecoveryPolicyInput): Promise<boolean> {
    return this.applyPolicy(input, true);
  }
  /** Unsaved strengthening applies immediately, but never relaxes current policy. */
  protectLocalPrivacy(input: EditorRecoveryPolicyInput): Promise<boolean> {
    return this.applyPolicy(input, false);
  }
  private applyPolicy(input: EditorRecoveryPolicyInput, authoritative: boolean): Promise<boolean> {
    input = captureRecoveryInput(input);
    validPolicy(input);
    return this.serial(async () => {
      const db = await this.open();
      const tx = db.transaction(RECOVERY_POLICY_STORES, "readwrite");
      const key = ownerRecord(input.ownerId, input.recordId);
      const previous = await tx.objectStore("policies").get(key);
      if (previous && (input.currentVersion < previous.serverVersion
        || (authoritative && previous.serverObserved && input.currentVersion === previous.serverVersion && input.privacyLevel !== previous.serverPrivacy))) {
        await tx.done; return false;
      }
      const next: PolicyRow = authoritative && (!previous || input.currentVersion > previous.serverVersion)
        ? { ownerRecord: key, serverVersion: input.currentVersion, serverPrivacy: input.privacyLevel, serverObserved: true, localFloor: rank(input.privacyLevel) }
        : { ...(previous ?? { ownerRecord: key, serverVersion: input.currentVersion, serverPrivacy: "normal" as const, serverObserved: false, localFloor: 0 }),
          ...(authoritative ? { serverPrivacy: input.privacyLevel, serverObserved: true } : {}),
          localFloor: Math.max(previous?.localFloor ?? 0, rank(input.privacyLevel)) };
      await tx.objectStore("policies").put(next);
      const floor = Math.max(rank(next.serverPrivacy), next.localFloor);
      await purgeBelowFloor(tx, key, floor);
      await tx.done;
      return true;
    });
  }
  protected async policyForWrite(tx: RecoveryTransaction, copy: RecoveryCopyIdentity) {
    const key = ownerRecord(copy.ownerId, copy.recordId), previous = await tx.objectStore("policies").get(key);
    const policy: PolicyRow = previous ?? { ownerRecord: key, serverVersion: copy.baseVersion, serverPrivacy: "normal", serverObserved: false, localFloor: 0 };
    if (copy.baseVersion >= policy.serverVersion) policy.localFloor = Math.max(policy.localFloor, rank(copy.privacyLevel));
    await tx.objectStore("policies").put(policy);
    const floor = Math.max(rank(policy.serverPrivacy), policy.localFloor);
    await purgeBelowFloor(tx, key, floor); return floor;
  }
  protected async settled() { await this.tail.catch(() => undefined); }
  async destroyForTest() {
    await this.settled();
    if (this.database) (await this.database.catch(() => null))?.close();
    this.database = null;
    await deleteDB(this.name);
  }
}

export class EditorWorkingCopyStore extends WorkingCopyDatabase {
  put(copy: EditorWorkingCopy, sensitiveOptIn = false): Promise<boolean> {
    copy = captureRecoveryInput(copy);
    validPolicy({ ...copy, currentVersion: copy.baseVersion });
    return this.serial(async () => {
      const db = await this.open();
      const metadata = { id: copy.id, ownerRecord: ownerRecord(copy.ownerId, copy.recordId), generation: copy.generation, updatedAt: copy.updatedAt };
      let row: CopyRow;
      if (copy.privacyLevel === "sensitive" && sensitiveOptIn) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await this.key(db, copy.ownerId), new TextEncoder().encode(JSON.stringify(copy)));
        row = { ...metadata, encrypted: true, ciphertext, iv };
      } else row = { ...metadata, encrypted: false, value: copy };
      // Encryption is deliberately outside this transaction. A concurrent privacy
      // change during encryption must be checked again before any payload write.
      const tx = db.transaction(RECOVERY_POLICY_STORES, "readwrite");
      const copies = tx.objectStore("copies");
      const current = await copies.get(copy.id);
      if (current && (current.ownerRecord !== metadata.ownerRecord || current.generation > copy.generation)) { await tx.done; return false; }
      const floor = await this.policyForWrite(tx, copy);
      if (copy.privacyLevel === "restricted" || rank(copy.privacyLevel) < floor || (copy.privacyLevel === "sensitive" && !sensitiveOptIn)) {
        // Rejecting a weaker/stale write must not erase a more protected recovery
        // copy. Only explicit sensitive non-consent removes this copy id here.
        if (copy.privacyLevel === "sensitive" && !sensitiveOptIn && current && current.generation <= copy.generation) await copies.delete(copy.id);
        await tx.done; return false;
      }
      if (!current || current.generation <= copy.generation) await copies.put(row);
      await tx.done;
      return true;
    });
  }
  async list(ownerId: string, recordId: string, sensitiveOptIn = false): Promise<EditorWorkingCopy[]> {
    await this.settled();
    const db = await this.open();
    const tx = db.transaction(["copies", "policies"], "readonly");
    const key = ownerRecord(ownerId, recordId);
    const policy = await tx.objectStore("policies").get(key);
    const rows = await tx.objectStore("copies").index("by-owner-record").getAll(key);
    await tx.done;
    const floor = policy ? Math.max(rank(policy.serverPrivacy), policy.localFloor) : 0;
    if (floor === 2) return [];
    const copies: EditorWorkingCopy[] = [];
    for (const row of rows) {
      if (!row.encrypted && floor === 0 && row.value.ownerId === ownerId && row.value.recordId === recordId) copies.push(row.value);
      else if (row.encrypted && sensitiveOptIn) {
        const storedKey = await db.get("keys", ownerId);
        if (!storedKey) continue;
        try {
          const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv as BufferSource }, storedKey.key, row.ciphertext);
          const copy = JSON.parse(new TextDecoder().decode(bytes)) as EditorWorkingCopy;
          if (copy.ownerId === ownerId && copy.recordId === recordId) copies.push(copy);
        } catch { /* Keep unreadable ciphertext for explicit cleanup; never overwrite it. */ }
      }
    }
    const latest = await db.get("policies", key);
    const latestFloor = latest ? Math.max(rank(latest.serverPrivacy), latest.localFloor) : 0;
    if (latestFloor === 2) return [];
    return copies.filter((copy) => latestFloor === 0 || copy.privacyLevel === "sensitive").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  remove(id: string, expectedGeneration?: number) {
    return this.serial(async () => {
      const db = await this.open();
      const tx = db.transaction("copies", "readwrite");
      const current = await tx.store.get(id);
      if (current && (expectedGeneration === undefined || current.generation <= expectedGeneration)) await tx.store.delete(id);
      await tx.done;
    });
  }
  private async removeRecordInternal(db: IDBPDatabase<CopySchema>, ownerId: string, recordId: string) {
    const tx = db.transaction("copies", "readwrite");
    for (const id of await tx.store.index("by-owner-record").getAllKeys(ownerRecord(ownerId, recordId))) await tx.store.delete(id);
    await tx.done;
  }
  removeRecord(ownerId: string, recordId: string) {
    return this.serial(async () => this.removeRecordInternal(await this.open(), ownerId, recordId));
  }
  removeUnprotected(ownerId: string, recordId: string) {
    return this.serial(async () => {
      const db = await this.open();
      const tx = db.transaction("copies", "readwrite");
      for (const row of await tx.store.index("by-owner-record").getAll(ownerRecord(ownerId, recordId))) if (!row.encrypted) await tx.store.delete(row.id);
      await tx.done;
    });
  }
}
