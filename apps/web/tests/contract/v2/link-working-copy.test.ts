import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, describe, expect, test, vi } from "vitest";
import { EditorWorkingCopyStore, type EditorWorkingCopy, type WorkingCopyDatabase } from "@/lib/v2/editor/editor-working-copy";
import { LinkWorkingCopyStore, type LinkWorkingCopy } from "@/lib/v2/editor/link-working-copy";

const stores: WorkingCopyDatabase[] = [];
const policy = { ownerId: "owner", recordId: "record", currentVersion: 1, privacyLevel: "normal" as const };
function setup() {
  const name = `link-working-${crypto.randomUUID()}`, links = new LinkWorkingCopyStore(name), other = new LinkWorkingCopyStore(name), editor = new EditorWorkingCopyStore(name);
  stores.push(links, other, editor); return { name, links, other, editor };
}
function copy(patch: Partial<LinkWorkingCopy> = {}): LinkWorkingCopy {
  return { id: "tab-a", ownerId: "owner", recordId: "record", generation: 1, baseVersion: 1, privacyLevel: "normal", updatedAt: "2026-09-08T00:00:00Z",
    kind: "snapshot", scopeKey: "document-revision:snapshot", payload: { rawText: "  prompt 🙂\r\n  exact  ", selectedSourceIds: ["source"], pending: { idempotencyKey: "same-request" } }, ...patch };
}
function documentCopy(patch: Partial<EditorWorkingCopy> = {}): EditorWorkingCopy {
  return { id: "tab-a", ownerId: "owner", recordId: "record", generation: 1, baseVersion: 1, baseRevisionId: "revision", privacyLevel: "normal", updatedAt: "2026-09-08T00:00:00Z",
    title: "Document title", bodyMarkdown: "Document body", writtenAt: "", documentStatus: "draft", ...patch };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map((store) => store.destroyForTest())); });

describe("link working copies share policy, not document payloads", () => {
  test("an already revoked view cannot start a new plaintext write", async () => {
    const { links } = setup(), controller = new AbortController(); controller.abort();
    expect(await links.put(copy(), false, controller.signal)).toBe(false); expect(await links.list("owner", "record")).toEqual([]);
  });
  test("view revocation during encryption prevents the final payload transaction", async () => {
    const { links } = setup(), controller = new AbortController();
    let started!: () => void, resume!: () => void;
    const start = new Promise<void>((resolve) => { started = resolve; }), gate = new Promise<void>((resolve) => { resume = resolve; });
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args) => { started(); await gate; return encrypt(...args); });
    const writing = links.put(copy({ privacyLevel: "sensitive" }), true, controller.signal);
    await start; controller.abort(); resume(); expect(await writing).toBe(false); expect(await links.list("owner", "record", true)).toEqual([]);
  });
  test("view revocation rolls back an in-flight IDB payload without retiring an earlier committed copy", async () => {
    const { links } = setup(), controller = new AbortController(); await links.put(copy());
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const request = put.call(this, value, key);
      if (this.name === "links") request.addEventListener("success", () => controller.abort(), { once: true });
      return request;
    });
    expect(await links.put(copy({ generation: 2, payload: { rawText: "unverified new input" } }), false, controller.signal)).toBe(false);
    spy.mockRestore(); expect(await links.list("owner", "record")).toEqual([copy()]);
  });
  test("stores several kinds/scopes/tabs separately and preserves exact pending input", async () => {
    const { links, editor } = setup(); await editor.put(documentCopy());
    for (const kind of ["snapshot", "manual", "curation", "migration"] as const) expect(await links.put(copy({ id: kind, kind, scopeKey: `${kind}:scope` }))).toBe(true);
    expect(await links.list("owner", "record")).toHaveLength(4);
    expect((await links.list("owner", "record"))[0].payload).toEqual(copy().payload);
    expect(await editor.list("owner", "record")).toEqual([documentCopy()]);
    expect(await links.list("other", "record")).toEqual([]); expect(await links.list("owner", "other")).toEqual([]);
  });
  test.each(["editor", "links"] as const)("%s authoritative restriction atomically purges both namespaces", async (kind) => {
    const state = setup(); await state.links.put(copy()); await state.editor.put(documentCopy());
    await state[kind].observeServerPolicy({ ...policy, currentVersion: 2, privacyLevel: "restricted" });
    expect(await state.other.put(copy({ generation: 999 }))).toBe(false);
    expect(await state.editor.put(documentCopy({ generation: 999 }))).toBe(false);
    expect(await state.links.list("owner", "record", true)).toEqual([]); expect(await state.editor.list("owner", "record", true)).toEqual([]);
  });
  test.each(["editor", "links"] as const)("%s unsaved restriction blocks newer draft claims until a newer authenticated policy", async (kind) => {
    const state = setup(); await state.links.observeServerPolicy(policy); await state.links.put(copy());
    await state[kind].protectLocalPrivacy({ ...policy, privacyLevel: "restricted" });
    expect(await state.other.put(copy({ generation: 2, baseVersion: 99 }))).toBe(false);
    await state.other.observeServerPolicy(policy); expect(await state.other.put(copy({ generation: 3 }))).toBe(false);
    await state.other.observeServerPolicy({ ...policy, currentVersion: 2 });
    expect(await state.other.put(copy({ generation: 4, baseVersion: 2 }))).toBe(true);
  });
  test("a restricted put protects the other namespace and never stores its payload", async () => {
    const { links, editor } = setup(); await editor.put(documentCopy());
    expect(await links.put(copy({ privacyLevel: "restricted" }), true)).toBe(false);
    expect(await editor.list("owner", "record", true)).toEqual([]);
  });
  test("document sensitive protection removes link plaintext but not encrypted other-tab copies", async () => {
    const { links, editor } = setup(); await links.put(copy());
    await editor.protectLocalPrivacy({ ...policy, privacyLevel: "sensitive" });
    expect(await links.list("owner", "record", true)).toEqual([]);
    expect(await links.put(copy({ generation: 2, privacyLevel: "sensitive" }), true)).toBe(true);
    expect(await links.put(copy({ id: "tab-b", generation: 3 }))).toBe(false);
    expect(await links.list("owner", "record", true)).toEqual([copy({ generation: 2, privacyLevel: "sensitive" })]);
  });
  test("sensitive opt-in uses shared non-extractable key and authenticated ciphertext", async () => {
    const { links, editor, name } = setup();
    expect(await links.put(copy({ privacyLevel: "sensitive" }))).toBe(false);
    expect(await links.put(copy({ privacyLevel: "sensitive" }), true)).toBe(true);
    expect(await editor.put(documentCopy({ privacyLevel: "sensitive" }), true)).toBe(true);
    expect(await links.list("owner", "record")).toEqual([]);
    expect(await links.list("owner", "record", true)).toEqual([copy({ privacyLevel: "sensitive" })]);
    const db = await openDB(name, 3);
    try {
      const rows = await db.getAll("links"), keys = await db.getAll("keys");
      expect(rows[0].encrypted).toBe(true); expect(rows[0]).not.toHaveProperty("value");
      expect(JSON.stringify(rows)).not.toContain("prompt"); expect(keys).toHaveLength(1); expect(keys[0].key.extractable).toBe(false);
      await db.put("links", { ...rows[0], updatedAt: "2026-09-08T01:00:00Z" });
      expect(await links.list("owner", "record", true)).toEqual([]);
    } finally { db.close(); }
  });
  test("an encrypted list never returns content deleted or restricted during decryption", async () => {
    const { links, other } = setup(); await links.put(copy({ privacyLevel: "sensitive" }), true);
    let started!: () => void, resume!: () => void;
    const start = new Promise<void>((resolve) => { started = resolve; }), gate = new Promise<void>((resolve) => { resume = resolve; });
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "decrypt").mockImplementation(async (...args) => { started(); await gate; return decrypt(...args); });
    const reading = links.list("owner", "record", true); await start;
    await other.remove("tab-a", 1); resume(); expect(await reading).toEqual([]);
  });
  test("the shared policy is rechecked after link decryption finishes", async () => {
    const { links, editor } = setup(); await links.put(copy({ privacyLevel: "sensitive" }), true);
    let started!: () => void, resume!: () => void;
    const start = new Promise<void>((resolve) => { started = resolve; }), gate = new Promise<void>((resolve) => { resume = resolve; });
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "decrypt").mockImplementation(async (...args) => { started(); await gate; return decrypt(...args); });
    const reading = links.list("owner", "record", true); await start;
    await editor.observeServerPolicy({ ...policy, currentVersion: 2, privacyLevel: "restricted" }); resume(); expect(await reading).toEqual([]);
  });
  test("a restriction in the document store while links encrypt blocks the final payload write", async () => {
    const { links, editor } = setup(); let started!: () => void, resume!: () => void;
    const start = new Promise<void>((resolve) => { started = resolve; }), gate = new Promise<void>((resolve) => { resume = resolve; });
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args) => { started(); await gate; return encrypt(...args); });
    const saving = links.put(copy({ privacyLevel: "sensitive" }), true); await start;
    await editor.observeServerPolicy({ ...policy, currentVersion: 2, privacyLevel: "restricted" }); resume();
    expect(await saving).toBe(false); expect(await links.list("owner", "record", true)).toEqual([]);
  });
  test("put and policy capture caller values before the first await", async () => {
    const { links, editor } = setup(), original = copy(), expected = structuredClone(original);
    const pending = links.put(original); Object.assign(original, { generation: 7, privacyLevel: "restricted" });
    Object.assign(original.payload as object, { rawText: "mutated" }); expect(await pending).toBe(true); expect(await links.list("owner", "record")).toEqual([expected]);
    const observed = { ...policy, currentVersion: 2, privacyLevel: "restricted" as const }, protection = editor.observeServerPolicy(observed);
    Object.assign(observed, { privacyLevel: "normal", recordId: "other" }); await protection;
    expect(await links.list("owner", "record")).toEqual([]);
  });
  test("legacy document puts also capture mutable caller fields before queuing", async () => {
    const { editor } = setup(), value = documentCopy(), expected = structuredClone(value), pending = editor.put(value);
    value.bodyMarkdown = "late mutation"; value.privacyLevel = "restricted";
    expect(await pending).toBe(true); expect(await editor.list("owner", "record")).toEqual([expected]);
  });
  test("a delayed acknowledgement deletes only through its generation and keeps another tab", async () => {
    const { links, other } = setup(); await links.put(copy({ generation: 2 })); await other.put(copy({ id: "tab-b" }));
    await other.remove("tab-a", 1); expect((await links.list("owner", "record")).map((row) => row.id).sort()).toEqual(["tab-a", "tab-b"]);
    await other.remove("tab-a", 2); expect((await links.list("owner", "record")).map((row) => row.id)).toEqual(["tab-b"]);
    expect(await links.put(copy({ generation: 2 }))).toBe(false); expect(await links.put(copy({ generation: 1 }))).toBe(false);
    expect(await links.put(copy({ generation: 3 }))).toBe(true);
  });
  test("delete-before-first-put fences a crypto-delayed same generation", async () => {
    const { links, other } = setup(); let started!: () => void, resume!: () => void;
    const start = new Promise<void>((resolve) => { started = resolve; }), gate = new Promise<void>((resolve) => { resume = resolve; });
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args) => { started(); await gate; return encrypt(...args); });
    const pending = links.put(copy({ privacyLevel: "sensitive" }), true); await start;
    await other.remove("tab-a", 1); resume(); expect(await pending).toBe(false);
    expect(await links.list("owner", "record", true)).toEqual([]);
  });
  test("same generation is idempotent only for identical captured input", async () => {
    const { links, other } = setup(); expect(await links.put(copy())).toBe(true); expect(await other.put(copy())).toBe(true);
    expect(await other.put(copy({ payload: { rewritten: true } }))).toBe(false); expect(await links.list("owner", "record")).toEqual([copy()]);
  });
  test("removeRecord is link-only, owner/record-scoped, and leaves tombstones", async () => {
    const { links, editor } = setup(); await links.put(copy()); await links.put(copy({ id: "other", recordId: "other-record" })); await editor.put(documentCopy());
    await links.removeRecord("owner", "record"); expect(await links.list("owner", "record")).toEqual([]);
    expect(await links.put(copy())).toBe(false); expect(await links.list("owner", "other-record")).toHaveLength(1); expect(await editor.list("owner", "record")).toHaveLength(1);
    expect(await links.put(copy({ ownerId: "intruder", generation: 10 }))).toBe(false);
  });
  test("removing an entirely unknown id without generation retires the id permanently", async () => {
    const { links } = setup(); await links.remove("tab-a"); expect(await links.put(copy({ generation: 99 }))).toBe(false);
  });
  test("legacy v2 document rows and keys survive the links-store upgrade", async () => {
    const { name, links, editor } = setup();
    const old = await openDB(name, 2, { upgrade(db) {
      db.createObjectStore("copies", { keyPath: "id" }).createIndex("by-owner-record", "ownerRecord");
      db.createObjectStore("keys", { keyPath: "id" }); db.createObjectStore("policies", { keyPath: "ownerRecord" });
    } });
    await old.put("copies", { id: "tab-a", ownerRecord: JSON.stringify(["owner", "record"]), generation: 1, updatedAt: documentCopy().updatedAt, encrypted: false, value: documentCopy() }); old.close();
    await links.put(copy()); expect(await editor.list("owner", "record")).toEqual([documentCopy()]);
  });
  test("a future upgrade closes the link store and rejects stale-version reuse", async () => {
    const { name, links } = setup(); await links.put(copy()); const future = await openDB(name, 4);
    try { await expect(links.list("owner", "record")).rejects.toMatchObject({ name: "VersionError" }); } finally { future.close(); }
  });
  test("an open v2 connection reports blocked upgrade on repeated attempts", async () => {
    const { name, links } = setup(); const legacy = await openDB(name, 2);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      for (let index = 0; index < 2; index++) {
        const result = await Promise.race([links.observeServerPolicy(policy).then(() => "unexpected", (error: Error) => error.message),
          new Promise<string>((resolve) => { timer = setTimeout(() => resolve("pending"), 250); })]);
        expect(result).toContain("다른 편집 탭"); if (timer) clearTimeout(timer);
      }
    } finally { legacy.close(); if (timer) clearTimeout(timer); }
    const upgraded = await openDB(name, 3); upgraded.close();
  });
  test.each(["undefined", "getter", "cycle", "sparse", "prototype"])("rejects non-JSON payload %s before IndexedDB work", async (kind) => {
    const { links } = setup(), value = copy(); let accessed = false;
    if (kind === "undefined") value.payload = undefined;
    if (kind === "getter") Object.defineProperty(value, "payload", { get: () => { accessed = true; return {}; } });
    if (kind === "cycle") value.payload = value;
    if (kind === "sparse") value.payload = Array(2);
    if (kind === "prototype") value.payload = new Date();
    expect(() => links.put(value)).toThrow(); expect(accessed).toBe(false);
  });
});
