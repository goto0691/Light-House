import { linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import { captureRecoveryInput, ownerRecord, rank, RECOVERY_POLICY_STORES, retireLinkRow, validPolicy, WorkingCopyDatabase,
  type LinkCopyRow, type RecoveryCopyIdentity } from "@/lib/v2/editor/editor-working-copy";

export type LinkWorkingCopy = RecoveryCopyIdentity & {
  kind: "snapshot" | "manual" | "curation" | "migration";
  scopeKey: string;
  payload: unknown;
};
function valid(copy: LinkWorkingCopy) {
  validPolicy({ ownerId: copy.ownerId, recordId: copy.recordId, currentVersion: copy.baseVersion, privacyLevel: copy.privacyLevel });
  if (!copy.id || typeof copy.id !== "string" || !copy.scopeKey || typeof copy.scopeKey !== "string" || !Number.isSafeInteger(copy.generation) || copy.generation < 0
    || !["snapshot", "manual", "curation", "migration"].includes(copy.kind) || typeof copy.updatedAt !== "string" || !Number.isFinite(Date.parse(copy.updatedAt))
    || !Object.prototype.hasOwnProperty.call(copy, "payload")) throw new Error("Invalid link working copy.");
}
function aad(row: Pick<LinkCopyRow, "id" | "ownerRecord" | "generation" | "updatedAt" | "digest">) {
  return new TextEncoder().encode(JSON.stringify(["link-working-copy.v1", row.id, row.ownerRecord, row.generation, row.updatedAt, row.digest]));
}

/** A namespace in the editor recovery database, never a Capture outbox item.
 * Privacy policies/keys are shared; document and link payload stores are not. */
export class LinkWorkingCopyStore extends WorkingCopyDatabase {
  put(value: LinkWorkingCopy, sensitiveOptIn = false, signal?: AbortSignal): Promise<boolean> {
    const copy = captureRecoveryInput(value); valid(copy);
    return this.serial(async () => {
      if (signal?.aborted) return false;
      const db = await this.open(), encoded = JSON.stringify(copy);
      const metadata = { id: copy.id, ownerRecord: ownerRecord(copy.ownerId, copy.recordId), generation: copy.generation, updatedAt: copy.updatedAt, digest: await linkSha256Hex(encoded) };
      let row: LinkCopyRow;
      if (copy.privacyLevel === "sensitive" && sensitiveOptIn) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(metadata) }, await this.key(db, copy.ownerId), new TextEncoder().encode(encoded));
        row = { ...metadata, encrypted: true, ciphertext, iv };
      } else row = { ...metadata, encrypted: false, value: copy };
      if (signal?.aborted) return false;
      const tx = db.transaction(RECOVERY_POLICY_STORES, "readwrite"), copies = tx.objectStore("links");
      const aborted = () => { try { tx.abort(); } catch { /* Already completed; no new write can start. */ } };
      signal?.addEventListener("abort", aborted, { once: true });
      // IDB emits both request and transaction rejections on abort.
      const done = tx.done; void done.catch(() => {});
      try {
      if (signal?.aborted) { aborted(); await done.catch(() => {}); return false; }
      const current = await copies.get(copy.id), tombstones = tx.objectStore("linkTombstones");
      const retired = await tombstones.get(copy.id);
      if (current && current.ownerRecord !== metadata.ownerRecord || retired?.ownerRecord && retired.ownerRecord !== metadata.ownerRecord) { await tx.done; return false; }
      const floor = await this.policyForWrite(tx, copy);
      const latestRetired = await tombstones.get(copy.id);
      if (copy.privacyLevel === "restricted" || rank(copy.privacyLevel) < floor || copy.privacyLevel === "sensitive" && !sensitiveOptIn) {
        if (copy.privacyLevel === "sensitive" && !sensitiveOptIn && current && current.generation <= copy.generation)
          await retireLinkRow(tx, { ...current, generation: copy.generation });
        await tx.done; return false;
      }
      if (latestRetired && latestRetired.generation >= copy.generation || current && current.generation > copy.generation) { await tx.done; return false; }
      if (current && current.generation === copy.generation) { await tx.done; return current.digest === row.digest; }
      await copies.put(row); await tx.done; return true;
      } catch (error) {
        if (signal?.aborted) { await done.catch(() => {}); return false; }
        throw error;
      } finally { signal?.removeEventListener("abort", aborted); }
    });
  }
  async list(ownerId: string, recordId: string, sensitiveOptIn = false): Promise<LinkWorkingCopy[]> {
    await this.settled(); const db = await this.open(), namespace = ownerRecord(ownerId, recordId);
    const rows = await db.getAllFromIndex("links", "by-owner-record", namespace), result: { row: LinkCopyRow; copy: LinkWorkingCopy }[] = [];
    for (const row of rows) {
      try {
        let copy: LinkWorkingCopy;
        if (!row.encrypted) copy = captureRecoveryInput(row.value) as LinkWorkingCopy;
        else {
          if (!sensitiveOptIn) continue;
          const key = await db.get("keys", ownerId); if (!key) continue;
          const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv as BufferSource, additionalData: aad(row) }, key.key, row.ciphertext);
          copy = captureRecoveryInput(JSON.parse(new TextDecoder().decode(bytes))) as LinkWorkingCopy;
        }
        valid(copy);
        if (copy.id !== row.id || copy.generation !== row.generation || copy.updatedAt !== row.updatedAt || copy.ownerId !== ownerId || copy.recordId !== recordId
          || copy.privacyLevel === "restricted" || (row.encrypted ? copy.privacyLevel !== "sensitive" : copy.privacyLevel !== "normal")
          || await linkSha256Hex(JSON.stringify(copy)) !== row.digest) continue;
        result.push({ row, copy });
      } catch { /* Preserve unreadable ciphertext for explicit cleanup; never reinterpret it as plaintext. */ }
    }
    // No cryptographic await after this final atomic policy/row/tombstone read.
    const tx = db.transaction(RECOVERY_POLICY_STORES, "readonly");
    const policy = await tx.objectStore("policies").get(namespace), current = await tx.objectStore("links").index("by-owner-record").getAll(namespace);
    const retired = await tx.objectStore("linkTombstones").index("by-owner-record").getAll(namespace); await tx.done;
    const floor = policy ? Math.max(rank(policy.serverPrivacy), policy.localFloor) : 0;
    if (floor === 2) return [];
    return result.filter(({ row, copy }) => (floor === 0 || copy.privacyLevel === "sensitive")
      && current.some((value) => value.id === row.id && value.generation === row.generation && value.digest === row.digest)
      && !retired.some((value) => value.id === row.id && value.generation >= row.generation))
      .map(({ copy }) => copy).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  remove(id: string, expectedGeneration?: number): Promise<void> {
    if (!id || expectedGeneration !== undefined && (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0)) throw new Error("Invalid link working-copy deletion.");
    return this.serial(async () => {
      const db = await this.open(), tx = db.transaction(RECOVERY_POLICY_STORES, "readwrite");
      const current = await tx.objectStore("links").get(id), prior = await tx.objectStore("linkTombstones").get(id);
      const generation = expectedGeneration ?? current?.generation ?? prior?.generation ?? Number.MAX_SAFE_INTEGER;
      await tx.objectStore("linkTombstones").put({ id, ownerRecord: current?.ownerRecord ?? prior?.ownerRecord ?? null, generation: Math.max(prior?.generation ?? -1, generation) });
      if (current && current.generation <= generation) await tx.objectStore("links").delete(id);
      await tx.done;
    });
  }
  removeRecord(ownerId: string, recordId: string): Promise<void> {
    return this.serial(async () => {
      const db = await this.open(), tx = db.transaction(RECOVERY_POLICY_STORES, "readwrite");
      for (const row of await tx.objectStore("links").index("by-owner-record").getAll(ownerRecord(ownerId, recordId))) await retireLinkRow(tx, row);
      await tx.done;
    });
  }
}
