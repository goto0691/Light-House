import { afterEach, expect, test, vi } from "vitest";
import { onLinkDraftAccessRevoked, revokeLinkDraftAccess } from "@/lib/v2/editor/link-draft-access";
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach((stop) => stop()); });
test("synchronously cancels every matching child, but no other owner or record", () => {
  const identity = { ownerId: "one", recordId: "record" }, first = vi.fn(), second = vi.fn(), otherOwner = vi.fn(), otherRecord = vi.fn();
  cleanup.push(onLinkDraftAccessRevoked(identity, first), onLinkDraftAccessRevoked(identity, second),
    onLinkDraftAccessRevoked({ ...identity, ownerId: "other" }, otherOwner), onLinkDraftAccessRevoked({ ...identity, recordId: "other" }, otherRecord));
  revokeLinkDraftAccess(identity); expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce(); expect(otherOwner).not.toHaveBeenCalled(); expect(otherRecord).not.toHaveBeenCalled();
});
test("unregister is idempotent and never cancels a later replacement subscriber", () => {
  const identity = { ownerId: "owner", recordId: "record" }, retired = vi.fn(), current = vi.fn();
  const stop = onLinkDraftAccessRevoked(identity, retired); stop(); cleanup.push(onLinkDraftAccessRevoked(identity, current)); stop();
  revokeLinkDraftAccess(identity); expect(retired).not.toHaveBeenCalled(); expect(current).toHaveBeenCalledOnce();
});
test("a broken child cannot prevent the remaining children or the parent closing", () => {
  const identity = { ownerId: "owner", recordId: "record" }, next = vi.fn();
  cleanup.push(onLinkDraftAccessRevoked(identity, () => { throw new Error("Synthetic child failure"); }), onLinkDraftAccessRevoked(identity, next));
  expect(() => revokeLinkDraftAccess(identity)).not.toThrow(); expect(next).toHaveBeenCalledOnce();
});
test("identity keys cannot collide through delimiter-containing owner or record IDs", () => {
  const stop = vi.fn(); cleanup.push(onLinkDraftAccessRevoked({ ownerId: "a:b", recordId: "c" }, stop));
  revokeLinkDraftAccess({ ownerId: "a", recordId: "b:c" }); expect(stop).not.toHaveBeenCalled();
});
