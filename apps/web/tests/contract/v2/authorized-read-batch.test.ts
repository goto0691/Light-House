import { expect, test } from "vitest";
import { authorizedReadBatch } from "@/lib/v2/editor/authorized-read-batch";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
const denied = (error: unknown) => error === "denied";

test("keeps input order and supports an empty batch", async () => {
  expect(await authorizedReadBatch([], denied)).toEqual([]);
  const a = deferred<number>(), b = deferred<string>(), result = authorizedReadBatch([a.promise, b.promise] as const, denied);
  b.resolve("second"); a.resolve(1); expect(await result).toEqual([1, "second"]);
});
test("ordinary failure waits for siblings and yields to a later access denial", async () => {
  const a = deferred<number>(), b = deferred<number>(), result = authorizedReadBatch([a.promise, b.promise], denied);
  let settled = false; void result.then(() => { settled = true; }, () => { settled = true; });
  a.reject("unavailable"); await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false);
  b.reject("denied"); await expect(result).rejects.toBe("denied");
});
test("denial does not wait for a hung sibling and still consumes a later rejection", async () => {
  const a = deferred<number>(), b = deferred<number>(), result = authorizedReadBatch([a.promise, b.promise], denied);
  a.reject("denied"); await expect(result).rejects.toBe("denied"); b.reject("late network failure"); await Promise.resolve();
});
test("ordinary failure drains all siblings and never returns partial results", async () => {
  const a = deferred<number>(), b = deferred<number>(), result = authorizedReadBatch([a.promise, b.promise], denied);
  a.reject("offline"); b.resolve(2); await expect(result).rejects.toBe("offline");
});
test("even an undefined rejection is retained", async () => {
  await expect(authorizedReadBatch([Promise.reject(undefined), Promise.resolve(1)], denied)).rejects.toBeUndefined();
});
test("input array mutation cannot replace an in-flight read", async () => {
  const a = deferred<number>(), reads = [a.promise], result = authorizedReadBatch(reads, denied);
  reads[0] = Promise.resolve(9); a.resolve(1); expect(await result).toEqual([1]);
});
test("synchronous thenable/predicate errors settle without losing sibling handlers", async () => {
  const value = { get then(): never { throw new Error("bad thenable"); } };
  await expect(authorizedReadBatch([value, Promise.resolve(1)], denied)).rejects.toThrow("bad thenable");
  await expect(authorizedReadBatch([Promise.reject("failure"), Promise.resolve(1)], () => { throw new Error("predicate failed"); })).rejects.toThrow("predicate failed");
});
test.each(["constructor", "then"])("throwing native Promise %s getter cannot skip a later sibling rejection", async (key) => {
  const read = Promise.resolve(1);
  Object.defineProperty(read, key, { get() { throw new Error(`broken ${key}`); } });
  await expect(authorizedReadBatch([read, Promise.reject("later sibling")], denied)).rejects.toThrow(`broken ${key}`);
  // Both failures must be handled regardless of the first ordinary error;
  // Vitest treats any unhandled sibling rejection as a test failure.
});
