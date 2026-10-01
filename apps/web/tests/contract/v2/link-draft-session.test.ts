import "fake-indexeddb/auto";
import { afterEach, expect, test, vi } from "vitest";
import { LinkDraftSession } from "@/lib/v2/editor/link-draft-session";
import { LinkWorkingCopyStore, type LinkWorkingCopy } from "@/lib/v2/editor/link-working-copy";

const policy = { ownerId: "owner", recordId: "record", currentVersion: 1, privacyLevel: "normal" as const };
const stores: LinkWorkingCopyStore[] = [];
function setup(kind: LinkWorkingCopy["kind"] = "curation") {
  const store = new LinkWorkingCopyStore(`link-session-${crypto.randomUUID()}`); stores.push(store);
  const session = new LinkDraftSession(policy, kind);
  return { store, session, persist: (copy: LinkWorkingCopy) => store.put(copy), remove: (id: string, generation: number) => store.remove(id, generation), list: () => store.list("owner", "record") };
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
afterEach(async () => { await Promise.all(stores.splice(0).map((store) => store.destroyForTest())); });

test.each(["snapshot", "manual", "curation", "migration"] as const)("%s parks multiple scopes and late success retires only its sent copy", async (kind) => {
  const { session, persist, remove, list } = setup(kind);
  const a = session.stage({ pending: { key: "original-a", basis: "old-a" } }, "scope-a", policy);
  expect(await session.park(persist)).toBe(true);
  const b = session.stage({ pending: { key: "original-b", basis: "old-b" } }, "scope-b", policy);
  expect(await session.park(persist)).toBe(true);
  const c = session.stage({ input: "new unsaved c" }, "scope-c", policy);
  await persist(session.current!);
  expect(new Set([a.id, b.id, c.id]).size).toBe(3); expect(await list()).toHaveLength(3);
  await session.saved(a, remove);
  expect(session.current?.id).toBe(c.id); expect((await list()).map((copy) => copy.id).sort()).toEqual([b.id, c.id].sort());
  await session.saved(b, remove); expect(session.current?.id).toBe(c.id);
  expect(await list()).toEqual([session.current]);
});

test("stage captures exact pending data before debounce and rejects executable accessors", async () => {
  const { session, persist, list } = setup();
  const input = { text: "  x🙂\r\n e\u0301  ", request: { groupKey: "original", items: ["a", "a"] } };
  const expected = structuredClone(input); session.stage(input, "same", policy);
  input.text = "mutated"; input.request.groupKey = "changed"; input.request.items.push("new");
  expect(session.current?.payload).toEqual(expected);
  await persist(session.current!); expect((await list())[0].payload).toEqual(expected);
  const getter = vi.fn(() => "must not execute");
  expect(() => session.stage(Object.defineProperty({}, "text", { get: getter, enumerable: true }), "same", policy)).toThrow();
  expect(getter).not.toHaveBeenCalled(); expect(session.current?.payload).toEqual(expected);
  expect(() => session.stage({ unknown: undefined }, "same", policy)).toThrow();
});

test("newer edits under the same ID survive an earlier request completion and its repeated cleanup", async () => {
  const { session, persist, remove, list } = setup();
  const first = session.stage({ text: "sent" }, "group", policy); await persist(session.current!);
  const latest = session.stage({ text: "typed after send" }, "group", policy); await persist(session.current!);
  await session.saved(first, remove); await session.saved(first, remove);
  expect(session.current?.id).toBe(latest.id); expect(session.current?.generation).toBe(latest.generation);
  expect((await list())[0].payload).toEqual({ text: "typed after send" });
});

test("a late completion cannot clear the restored origin belonging to another active scope", async () => {
  const { session, store, persist, remove, list } = setup();
  const otherTab = new LinkDraftSession(policy, "curation");
  otherTab.stage({ text: "other tab draft" }, "other-group", policy); const original = otherTab.current!; await store.put(original);
  const a = session.stage({ text: "sent a" }, "group-a", policy); await session.park(persist);
  const restored = session.restore(original, original.payload, policy); await persist(session.current!);
  await session.saved(a, remove);
  expect((await list()).map((copy) => copy.id).sort()).toEqual([original.id, restored.id].sort());
  await session.saved(restored, remove); expect(await list()).toHaveLength(0); expect(session.current).toBeNull();
});

test("restored origin newer generation survives success for its original restored version", async () => {
  const { session, store, persist, remove, list } = setup();
  const otherTab = new LinkDraftSession(policy, "curation");
  otherTab.stage({ text: "original" }, "group", policy); const original = otherTab.current!; await store.put(original);
  const token = session.restore(original, original.payload, policy); await persist(session.current!);
  otherTab.stage({ text: "new other-tab change" }, "group", policy); await store.put(otherTab.current!);
  await session.saved(token, remove);
  expect(await list()).toEqual([otherTab.current]);
});

test.each([false, "reject"])("failed park (%s) leaves active draft untouched", async (result) => {
  const { session } = setup(); session.stage({ text: "keep" }, "a", policy); const original = session.current;
  const operation = session.park(async () => { if (result === "reject") throw new Error("storage full"); return false; });
  if (result === "reject") await expect(operation).rejects.toThrow("storage full"); else expect(await operation).toBe(false);
  expect(session.current).toBe(original);
});

test("an edit during a slow park invalidates the transition without discarding new input", async () => {
  const { session, persist, list } = setup(); session.stage({ text: "old" }, "a", policy);
  const wait = gate(), started = gate();
  const parked = session.park(async (copy) => { started.release(); await wait.promise; return persist(copy); });
  await started.promise; session.stage({ text: "new" }, "a", policy); wait.release();
  expect(await parked).toBe(false); expect(session.current?.payload).toEqual({ text: "new" });
  await persist(session.current!); expect(await list()).toEqual([session.current]);
});

test("an old deferred cleanup cannot clear a new active ID opened while deletion is pending", async () => {
  const { session, persist, remove, list } = setup();
  const a = session.stage({ text: "a" }, "a", policy); await session.park(persist);
  const wait = gate(), started = gate();
  const saved = session.saved(a, async (id, generation) => { started.release(); await wait.promise; await remove(id, generation); });
  await started.promise; const b = session.stage({ text: "b" }, "b", policy); await persist(session.current!);
  wait.release(); await saved;
  expect(session.current?.id).toBe(b.id); expect(await list()).toEqual([session.current]);
});

test("a partial restored-origin cleanup can be retried without deleting a newer scope", async () => {
  const { session, store, persist, remove, list } = setup(); const prior = new LinkDraftSession(policy, "curation");
  prior.stage({ text: "prior" }, "prior", policy); const source = prior.current!; await store.put(source);
  const token = session.restore(source, source.payload, policy); await persist(session.current!);
  let calls = 0;
  await expect(session.saved(token, async (id, generation) => { if (++calls === 2) throw new Error("storage interrupted"); await remove(id, generation); })).rejects.toThrow("storage interrupted");
  session.stage({ text: "newer edit" }, "prior", policy); await persist(session.current!);
  await session.saved(token, remove); expect(await list()).toEqual([session.current]);
});

test("revocation removes only this active generation; re-opt-in can persist beyond its tombstone", async () => {
  const { session, persist, remove, list } = setup(); session.stage({ text: "parked" }, "a", policy); await session.park(persist);
  const active = session.stage({ text: "active" }, "b", policy); await persist(session.current!);
  await session.disable(remove); expect(await list()).toHaveLength(1);
  expect(session.current?.generation).toBeGreaterThan(active.generation); expect(await persist(session.current!)).toBe(true);
  expect(await list()).toHaveLength(2);
});

test("policy refresh keeps the original payload basis while advancing the storage generation", () => {
  const { session } = setup(); const token = session.stage({ basis: "original-request", pending: { key: "same" } }, "a", policy);
  session.refreshPolicy({ ...policy, currentVersion: 2, privacyLevel: "sensitive" });
  expect(session.current?.generation).toBeGreaterThan(token.generation); expect(session.current?.baseVersion).toBe(2);
  expect(session.current?.payload).toEqual({ basis: "original-request", pending: { key: "same" } });
});

test("successful receipt retires the same frozen pending after policy-only generation advances", async () => {
  const { session, persist, remove, list } = setup();
  const token = session.stage({ basis: "original-request", pending: { key: "same", text: "  x🙂\r\n  " } }, "a", policy);
  const sent = session.current!; await persist(sent);
  session.refreshPolicy({ ...policy, currentVersion: 2 });
  session.refreshPolicy({ ...policy, currentVersion: 3 });
  const refreshed = session.current!; expect(refreshed.payload).toBe(sent.payload);
  await persist(refreshed);
  await session.saved(token, remove);
  expect(session.current).toBeNull(); expect(await list()).toEqual([]);
  expect(await persist(refreshed)).toBe(false); // A delayed pre-cleanup write is fenced too.
  await session.saved(token, remove); expect(await list()).toEqual([]);
});

test("policy refresh during receipt cleanup explicitly retains the newer pending for retry", async () => {
  const { session, persist, remove, list } = setup();
  const token = session.stage({ pending: { key: "same" } }, "a", policy);
  session.refreshPolicy({ ...policy, currentVersion: 2 }); await persist(session.current!);
  const wait = gate(), started = gate();
  const saved = session.saved(token, async (id, generation) => { started.release(); await wait.promise; await remove(id, generation); });
  const result = saved.then(() => null, (error: unknown) => error);
  await started.promise;
  session.refreshPolicy({ ...policy, currentVersion: 3 });
  session.refreshPolicy({ ...policy, currentVersion: 4 });
  const latest = session.current!; await persist(latest); wait.release();
  expect(await result).toBeInstanceOf(Error);
  expect(session.current).toBe(latest); expect(await list()).toEqual([latest]);
  await session.saved(token, remove); expect(session.current).toBeNull(); expect(await list()).toEqual([]);
});

test.each([{ text: "  same🙂\r\n  " }, "  same🙂\r\n  ", null])("equal new stage %j is not a policy-only generation", async (payload) => {
  const { session, persist, remove, list } = setup();
  const old = session.stage(payload, "a", policy);
  session.refreshPolicy({ ...policy, currentVersion: 2 }); await persist(session.current!);
  const latestToken = session.stage(payload, "a", { ...policy, currentVersion: 2 });
  session.refreshPolicy({ ...policy, currentVersion: 3 }); const latest = session.current!; await persist(latest);
  await session.saved(old, remove); await session.saved(old, remove);
  expect(session.current).toBe(latest); expect(await list()).toEqual([latest]);
  await session.saved(latestToken, remove); expect(session.current).toBeNull(); expect(await list()).toEqual([]);
});

test.each(["same", "different"])("new input in %s scope during cleanup survives the captured generation tombstone", async (scopeKey) => {
  const { session, persist, remove, list } = setup();
  const token = session.stage({ text: "identical but new input" }, "same", policy);
  session.refreshPolicy({ ...policy, currentVersion: 2 }); const sent = session.current!; await persist(sent);
  const wait = gate(), started = gate();
  const saved = session.saved(token, async (id, generation) => { started.release(); await wait.promise; await remove(id, generation); });
  await started.promise;
  const nextToken = session.stage({ text: "identical but new input" }, scopeKey, { ...policy, currentVersion: 2 });
  session.refreshPolicy({ ...policy, currentVersion: 3 }); const next = session.current!; await persist(next);
  wait.release(); await saved;
  expect(session.current).toBe(next); expect(await list()).toEqual([next]);
  expect(await persist(sent)).toBe(false);
  await session.saved(token, remove); expect(await list()).toEqual([next]);
  await session.saved(nextToken, remove); expect(await list()).toEqual([]);
});

test("policy change while deleting a restored origin retains the active input and the other tab's newer origin", async () => {
  const { session, store, persist, remove, list } = setup(); const other = new LinkDraftSession(policy, "curation");
  other.stage({ text: "origin" }, "same", policy); const origin = other.current!; await store.put(origin);
  const token = session.restore(origin, origin.payload, policy);
  session.refreshPolicy({ ...policy, currentVersion: 2 }); await persist(session.current!);
  other.stage({ text: "other-tab edit" }, "same", { ...policy, currentVersion: 2 }); const otherLatest = other.current!; await store.put(otherLatest);
  const wait = gate(), started = gate();
  const saved = session.saved(token, async (id, generation) => {
    if (id === origin.id) { started.release(); await wait.promise; }
    await remove(id, generation);
  });
  const result = saved.then(() => null, (error: unknown) => error);
  await started.promise;
  session.refreshPolicy({ ...policy, currentVersion: 3 }); const latest = session.current!; await persist(latest);
  wait.release(); expect(await result).toBeInstanceOf(Error);
  expect(session.current).toBe(latest);
  expect(new Set((await list()).map((copy) => copy.id))).toEqual(new Set([latest.id, otherLatest.id]));
  await session.saved(token, remove); expect(session.current).toBeNull(); expect(await list()).toEqual([otherLatest]);
});

test("an edit during restored cleanup keeps its origin identity through policy refresh and its own receipt", async () => {
  const { session, store, persist, remove, list } = setup(); const other = new LinkDraftSession(policy, "curation");
  other.stage({ text: "origin" }, "same", policy); const origin = other.current!; await store.put(origin);
  const token = session.restore(origin, origin.payload, policy); await persist(session.current!);
  const wait = gate(), started = gate();
  const saved = session.saved(token, async (id, generation) => {
    if (id === origin.id) { started.release(); await wait.promise; }
    await remove(id, generation);
  });
  await started.promise;
  const nextToken = session.stage({ text: "new input" }, "same", policy);
  expect(nextToken.origin).toBe(token.origin);
  session.refreshPolicy({ ...policy, currentVersion: 2 }); const latest = session.current!; await persist(latest);
  wait.release(); await saved; expect(session.current).toBe(latest); expect(await list()).toEqual([latest]);
  await session.saved(nextToken, remove); expect(session.current).toBeNull(); expect(await list()).toEqual([]);
});

test("revocation generations cannot be mistaken for policy-only receipt cleanup", async () => {
  const { session, persist, remove, list } = setup();
  const token = session.stage({ text: "keep after revocation" }, "same", policy); await persist(session.current!);
  await session.disable(remove);
  session.refreshPolicy({ ...policy, currentVersion: 2 }); const latest = session.current!; await persist(latest);
  await session.saved(token, remove); expect(session.current).toBe(latest); expect(await list()).toEqual([latest]);
});

test("same frozen pending can be retired after an opted-in sensitive policy refresh", async () => {
  const { session, store, persist, remove } = setup();
  const token = session.stage({ pending: "  private🙂\r\n  " }, "same", policy); await persist(session.current!);
  const sensitive = { ...policy, currentVersion: 2, privacyLevel: "sensitive" as const };
  await store.observeServerPolicy(sensitive); session.refreshPolicy(sensitive);
  const latest = session.current!; expect(await store.put(latest, true)).toBe(true);
  expect(await store.list("owner", "record", true)).toEqual([latest]);
  await session.saved(token, remove); expect(session.current).toBeNull(); expect(await store.list("owner", "record", true)).toEqual([]);
  expect(await store.put(latest, true)).toBe(false);
});

test("failed cleanup retains its same-payload token for retry after a policy refresh", async () => {
  const { session, persist, remove, list } = setup();
  const token = session.stage({ text: "keep" }, "same", policy); await persist(session.current!);
  session.refreshPolicy({ ...policy, currentVersion: 2 }); const latest = session.current!; await persist(latest);
  await expect(session.saved(token, async () => { throw new Error("storage failed"); })).rejects.toThrow("storage failed");
  expect(session.current).toBe(latest); expect(await list()).toEqual([latest]);
  await session.saved(token, remove); expect(session.current).toBeNull(); expect(await list()).toEqual([]);
});

test("rejected new input does not invalidate the prior frozen pending's cleanup identity", async () => {
  const { session, persist, remove, list } = setup();
  const token = session.stage({ text: "keep" }, "same", policy);
  const getter = vi.fn(() => "no");
  expect(() => session.stage(Object.defineProperty({}, "text", { get: getter, enumerable: true }), "same", policy)).toThrow();
  expect(getter).not.toHaveBeenCalled(); session.refreshPolicy({ ...policy, currentVersion: 2 }); await persist(session.current!);
  await session.saved(token, remove); expect(session.current).toBeNull(); expect(await list()).toEqual([]);
});

test("foreign session tokens and owner/record/kind restores are rejected without cleanup", async () => {
  const { session, remove } = setup(); const foreign = new LinkDraftSession(policy, "curation");
  const token = foreign.stage({ text: "foreign" }, "a", policy), spy = vi.fn(remove);
  await expect(session.saved(token, spy)).rejects.toThrow(); expect(spy).not.toHaveBeenCalled();
  for (const patch of [{ ownerId: "other" }, { recordId: "other" }, { kind: "migration" as const }]) {
    expect(() => session.restore({ ...foreign.current!, ...patch }, foreign.current!.payload, policy)).toThrow(); expect(session.current).toBeNull();
  }
  expect(() => session.stage({}, "a", { ...policy, ownerId: "changed" })).toThrow();
});
