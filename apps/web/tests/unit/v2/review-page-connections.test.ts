import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), list: vi.fn(), project: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", async (original) => ({
  ...await original<typeof import("@/lib/v2/auth/restricted-grant")>(), getActiveRestrictedGrant: harness.grant,
}));
vi.mock("@/lib/v2/config/server-feature-flags", () => ({ getV2ServerFeatureFlags: () => ({ routes: true }) }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: () => ({ db: {} }) }));
vi.mock("@/lib/v2/infrastructure/d1/review-repository", () => ({ D1ReviewRepository: class { listOpenRecords(...args: unknown[]) { return harness.list(...args); } } }));
vi.mock("@/lib/v2/infrastructure/d1/presentation-repository", () => ({ D1PresentationRepository: class { project(...args: unknown[]) { return harness.project(...args); } } }));
vi.mock("@/components/v2/record-knowledge", () => ({ RecordKnowledge: () => null }));

import reviewPage from "@/app/v2/review/page";
import { RecordKnowledge } from "@/components/v2/record-knowledge";

const restricted = { recordId: "restricted-one", title: "PRIVATE REVIEW TITLE", privacyLevel: "restricted", currentRevisionId: "revision-one", openCount: 1, latestReviewAt: "2026-09-23T00:00:00.000Z" };
const presentation = { highlights: [], sections: [], connections: [], modules: [], reviewItems: [{ reviewId: "review-one", payload: { message: "PRIVATE REVIEW DETAIL" } }] };

function findKnowledge(node: unknown): React.ReactElement<{ presentationJson: string; sourceRecordId: string }> | null {
  if (Array.isArray(node)) return node.map(findKnowledge).find(Boolean) ?? null;
  if (!React.isValidElement<{ children?: unknown; presentationJson: string; sourceRecordId: string }>(node)) return null;
  if (node.type === RecordKnowledge) return node;
  return findKnowledge(node.props.children);
}

function serialized(node: unknown) {
  return JSON.stringify(node, (key, value) => key === "type" || key === "_owner" ? undefined : value);
}

beforeEach(() => {
  harness.session.mockResolvedValue({ sessionId: "session-one", userId: "owner-one" });
  harness.grant.mockResolvedValue(null);
  harness.list.mockResolvedValue([restricted]);
  harness.project.mockResolvedValue(presentation);
});
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

test("a live restricted grant reaches Review fields and exact Record evidence links", async () => {
  harness.grant.mockResolvedValue({ expiresAt: new Date(Date.now() + 120_000).toISOString() });
  const tree = await reviewPage({ searchParams: Promise.resolve({ record: restricted.recordId }) });
  expect(harness.list).toHaveBeenCalledWith(true);
  expect(harness.project).toHaveBeenCalledWith(restricted.recordId, false, { restrictedUnlocked: true });
  const knowledge = findKnowledge(tree);
  expect(knowledge?.props.sourceRecordId).toBe(restricted.recordId);
  expect(JSON.parse(knowledge!.props.presentationJson).reviewItems).toEqual(presentation.reviewItems);
});

test("Review drops restricted list and field props if the grant expires during projection", async () => {
  const expires = Date.now() + 120_000;
  harness.grant.mockResolvedValue({ expiresAt: new Date(expires).toISOString() });
  harness.project.mockImplementation(async () => {
    vi.spyOn(Date, "now").mockReturnValue(expires + 1);
    return presentation;
  });
  const tree = await reviewPage({ searchParams: Promise.resolve({ record: restricted.recordId }) });
  expect(findKnowledge(tree)).toBeNull();
  expect(serialized(tree)).not.toContain(restricted.title);
  expect(serialized(tree)).not.toContain(restricted.recordId);
  expect(serialized(tree)).not.toContain("PRIVATE REVIEW DETAIL");
});

test("an absent grant never selects a restricted Review detail", async () => {
  const tree = await reviewPage({ searchParams: Promise.resolve({ record: restricted.recordId }) });
  expect(harness.list).toHaveBeenCalledWith(false);
  expect(harness.project).not.toHaveBeenCalled();
  expect(findKnowledge(tree)).toBeNull();
  expect(serialized(tree)).not.toContain(restricted.title);
});

test("Review rechecks every left-side title after an unselected record becomes restricted", async () => {
  const selected = { ...restricted, recordId: "normal-one", title: "NORMAL TITLE", privacyLevel: "normal", currentRevisionId: "normal-revision" };
  const other = { ...restricted, recordId: "normal-two", title: "STALE PRIVATE TITLE", privacyLevel: "normal", currentRevisionId: "other-revision" };
  harness.list.mockResolvedValueOnce([selected, other]).mockResolvedValueOnce([selected, { ...other, privacyLevel: "restricted" }]);
  const tree = await reviewPage({ searchParams: Promise.resolve({ record: selected.recordId }) });
  expect(serialized(tree)).toContain(selected.title);
  expect(serialized(tree)).not.toContain(other.title);
});

test("Review drops stale selected content after normal becomes restricted during projection", async () => {
  const selected = { ...restricted, recordId: "normal-one", title: "STALE SELECTED TITLE", privacyLevel: "normal", currentRevisionId: "normal-revision" };
  harness.list.mockResolvedValueOnce([selected]).mockResolvedValueOnce([{ ...selected, privacyLevel: "restricted" }]);
  const tree = await reviewPage({ searchParams: Promise.resolve({ record: selected.recordId }) });
  expect(findKnowledge(tree)).toBeNull();
  expect(serialized(tree)).not.toContain(selected.title);
  expect(serialized(tree)).not.toContain("PRIVATE REVIEW DETAIL");
});

test("Review does not attach an old presentation to a newer selected revision", async () => {
  const selected = { ...restricted, recordId: "normal-one", title: "OLD REVIEW TITLE", privacyLevel: "normal", currentRevisionId: "old-revision" };
  harness.list.mockResolvedValueOnce([selected]).mockResolvedValueOnce([{ ...selected, title: "CURRENT REVIEW TITLE", currentRevisionId: "new-revision" }]);
  const tree = await reviewPage({ searchParams: Promise.resolve({ record: selected.recordId }) });
  expect(findKnowledge(tree)).toBeNull();
  expect(serialized(tree)).not.toContain(selected.title);
  expect(serialized(tree)).not.toContain("PRIVATE REVIEW DETAIL");
  expect(serialized(tree)).toContain("CURRENT REVIEW TITLE");
});
