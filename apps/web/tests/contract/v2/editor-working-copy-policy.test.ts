import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, expect, test, vi } from "vitest";
import { EditorWorkingCopyStore, type EditorWorkingCopy } from "@/lib/v2/editor/editor-working-copy";

const stores: EditorWorkingCopyStore[] = [];
function setup() {
  const name = `editor-policy-${crypto.randomUUID()}`;
  const first = new EditorWorkingCopyStore(name), second = new EditorWorkingCopyStore(name);
  stores.push(first, second);
  return { name, first, second };
}
function copy(patch: Partial<EditorWorkingCopy> = {}): EditorWorkingCopy {
  return { id: "tab-a", ownerId: "owner-a", recordId: "record-a", generation: 1, baseRevisionId: "revision-1", baseVersion: 1,
    title: "Synthetic", bodyMarkdown: "Synthetic private working text", writtenAt: "", documentStatus: "draft", privacyLevel: "normal", updatedAt: "2026-09-08T08:00:00.000Z", ...patch };
}
const policy = { ownerId: "owner-a", recordId: "record-a", currentVersion: 1, privacyLevel: "normal" as const };
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map((store) => store.destroyForTest())); });

test("local strengthening blocks other tabs until a newer authenticated normal revision, not a stale observation", async () => {
  const { first, second } = setup();
  await first.observeServerPolicy(policy);
  await first.put(copy());
  await second.put(copy({ id: "tab-b", privacyLevel: "sensitive" }), true);
  await first.protectLocalPrivacy({ ...policy, privacyLevel: "restricted" });
  expect(await second.list("owner-a", "record-a", true)).toEqual([]);
  expect(await second.put(copy({ generation: 99 }))).toBe(false);
  expect(await second.put(copy({ id: "tab-b", generation: 99, privacyLevel: "sensitive" }), true)).toBe(false);
  await second.observeServerPolicy(policy);
  expect(await second.put(copy({ generation: 100 }))).toBe(false);

  expect(await first.observeServerPolicy({ ...policy, currentVersion: 2 })).toBe(true);
  expect(await first.put(copy({ baseVersion: 2, baseRevisionId: "revision-2", generation: 101 }))).toBe(true);
  expect(await second.observeServerPolicy({ ...policy, privacyLevel: "restricted" })).toBe(false);
  expect(await second.protectLocalPrivacy({ ...policy, privacyLevel: "restricted" })).toBe(false);
  expect(await second.put(copy({ id: "old-restricted-tab", privacyLevel: "restricted" }))).toBe(false);
  expect(await first.list("owner-a", "record-a")).toMatchObject([{ baseVersion: 2, generation: 101 }]);
});

test("a draft claiming a higher baseVersion cannot itself relax a restricted policy", async () => {
  const { first, second } = setup();
  await first.observeServerPolicy({ ...policy, currentVersion: 2, privacyLevel: "restricted" });
  expect(await second.put(copy({ baseVersion: 3 }))).toBe(false);
  await second.observeServerPolicy({ ...policy, currentVersion: 3 });
  expect(await second.put(copy({ baseVersion: 3 }))).toBe(true);
});

test("sensitive protection removes plaintext and requires consent for encrypted recovery", async () => {
  const { name, first, second } = setup();
  await first.observeServerPolicy(policy);
  await first.put(copy());
  await second.protectLocalPrivacy({ ...policy, privacyLevel: "sensitive" });
  expect(await first.put(copy({ generation: 2 }))).toBe(false);
  expect(await first.put(copy({ privacyLevel: "sensitive", generation: 2 }))).toBe(false);
  expect(await first.put(copy({ privacyLevel: "sensitive", generation: 3 }), true)).toBe(true);
  expect(await second.put(copy({ generation: 4 }))).toBe(false);
  expect(await second.list("owner-a", "record-a")).toEqual([]);
  expect(await second.list("owner-a", "record-a", true)).toMatchObject([{ generation: 3, privacyLevel: "sensitive" }]);
  const database = await openDB(name, 3);
  try {
    const rows = await database.getAll("copies");
    expect(rows).toHaveLength(1);
    expect(rows[0].encrypted).toBe(true);
    expect(rows[0]).not.toHaveProperty("value");
    expect(JSON.stringify(rows)).not.toContain(copy().bodyMarkdown);
  } finally { database.close(); }
});

test("restriction committed during encryption prevents a delayed sensitive payload write", async () => {
  const { first, second } = setup();
  await first.observeServerPolicy(policy);
  let started!: () => void, resume!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const resumedPromise = new Promise<void>((resolve) => { resume = resolve; });
  const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args) => { started(); await resumedPromise; return encrypt(...args); });
  const pending = first.put(copy({ privacyLevel: "sensitive" }), true);
  await startedPromise;
  await second.observeServerPolicy({ ...policy, currentVersion: 2, privacyLevel: "restricted" });
  resume();
  expect(await pending).toBe(false);
  expect(await second.list("owner-a", "record-a", true)).toEqual([]);
});

test("policy and copy ids remain owner scoped and older normal revisions remain recoverable", async () => {
  const { first, second } = setup();
  await first.observeServerPolicy({ ...policy, currentVersion: 2 });
  expect(await first.put(copy())).toBe(true);
  expect(await second.put(copy({ ownerId: "owner-b", generation: 99 }))).toBe(false);
  await second.observeServerPolicy({ ...policy, ownerId: "owner-b", currentVersion: 9, privacyLevel: "restricted" });
  expect(await first.list("owner-a", "record-a")).toMatchObject([{ ownerId: "owner-a", baseVersion: 1 }]);
  expect(await second.list("owner-b", "record-a", true)).toEqual([]);
});

test("v1 IndexedDB normal working copies survive the policy-store upgrade", async () => {
  const { name, first } = setup();
  const legacy = await openDB(name, 1, { upgrade(db) {
    const copies = db.createObjectStore("copies", { keyPath: "id" });
    copies.createIndex("by-owner-record", "ownerRecord");
    db.createObjectStore("keys", { keyPath: "id" });
  } });
  await legacy.put("copies", { id: "tab-a", ownerRecord: JSON.stringify(["owner-a", "record-a"]), generation: 1, updatedAt: copy().updatedAt, encrypted: false, value: copy() });
  legacy.close();
  await first.observeServerPolicy(policy);
  expect(await first.list("owner-a", "record-a")).toEqual([copy()]);
  await first.observeServerPolicy({ ...policy, currentVersion: 2, privacyLevel: "restricted" });
  expect(await first.list("owner-a", "record-a", true)).toEqual([]);
});

test("an open v1 connection reports upgrade failure promptly and a later retry applies protection", async () => {
  const { name, first } = setup();
  const legacy = await openDB(name, 1, { upgrade(db) {
    const copies = db.createObjectStore("copies", { keyPath: "id" }); copies.createIndex("by-owner-record", "ownerRecord");
    db.createObjectStore("keys", { keyPath: "id" });
  } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const attempt = first.observeServerPolicy({ ...policy, currentVersion: 2, privacyLevel: "restricted" }).then(() => "unexpected-success", (error: Error) => error.message);
    const outcome = await Promise.race([attempt, new Promise<string>((resolve) => { timer = setTimeout(() => resolve("still-pending"), 250); })]);
    expect(outcome).toContain("다른 편집 탭");
    if (timer) clearTimeout(timer);
    // StrictMode/repeated effects must report the same blocked failure instead
    // of queuing another native open behind the still-blocked first request.
    const repeated = first.observeServerPolicy({ ...policy, currentVersion: 2, privacyLevel: "restricted" }).then(() => "unexpected-success", (error: Error) => error.message);
    const repeatedOutcome = await Promise.race([repeated, new Promise<string>((resolve) => { timer = setTimeout(() => resolve("still-pending"), 250); })]);
    expect(repeatedOutcome).toContain("다른 편집 탭");
  } finally { if (timer) clearTimeout(timer); legacy.close(); }
  const upgraded = await openDB(name, 3); upgraded.close();
  expect(await first.observeServerPolicy({ ...policy, currentVersion: 2, privacyLevel: "restricted" })).toBe(true);
  expect(await first.list("owner-a", "record-a", true)).toEqual([]);
});

test("a future database upgrade closes this connection and does not reuse its stale promise", async () => {
  const { name, first } = setup();
  await first.observeServerPolicy(policy);
  const future = await openDB(name, 4);
  try {
    expect(future.version).toBe(4);
    await expect(first.observeServerPolicy(policy)).rejects.toMatchObject({ name: "VersionError" });
  } finally { future.close(); }
});
