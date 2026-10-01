import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: harness.session }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("SSR_NOT_FOUND"); } }));
vi.mock("@/components/v2/processing-status-view", () => ({ ProcessingStatusView: () => null }));

import page from "@/app/v2/processing/page";
import { ProcessingStatusView } from "@/components/v2/processing-status-view";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import type { ProcessingStatusPage } from "@/lib/v2/domain/processing-status";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { LinkMemoryD1 } from "./link-presentation-fixture";

let db: LinkMemoryD1;
beforeEach(() => {
  db = new LinkMemoryD1(32); vi.stubGlobal("React", React);
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "0"); vi.stubEnv("FLAG_V2_AI", "0"); vi.stubEnv("GEMINI_API_KEY", "");
  harness.session.mockResolvedValue({ userId: "link-owner", sessionId: "processing-ssr", expiresAt: Date.now() + 60_000 });
  harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

function initialPage(tree: unknown): ProcessingStatusPage | null {
  if (!React.isValidElement<{ initialPage: ProcessingStatusPage | null }>(tree) || tree.type !== ProcessingStatusView) throw new Error("Missing processing view");
  return tree.props.initialPage;
}

test("actual processing SSR reads the authenticated owner's saved records and redacts restricted metadata", async () => {
  const record = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "PRIVATE TITLE", bodyMarkdown: "PRIVATE BODY",
    privacyLevel: "restricted", clientTimezone: "Asia/Seoul", capturedAt: "2026-09-22T14:00:00.000Z", aiEnabled: false }, crypto.randomUUID(), "2026-09-22T14:00:00.000Z");
  await new D1SourceFoundationRepository(db, "link-owner").commitCapture(record);
  db.sql.exec("pragma query_only=on");
  const result = initialPage(await page());
  expect(result).toMatchObject({ contract: "processing-status.v1", counts: { all: 1 }, items: [{ recordId: record.objectId, title: "잠긴 기록", status: "restricted", stages: [] }] });
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|bodyMarkdown|inputHash/);
  harness.session.mockResolvedValue({ userId: "other-owner" });
  expect(initialPage(await page())).toMatchObject({ counts: { all: 0 }, items: [] });
});

test("SSR does not query data without a session or route, and exposes an outage as retryable null", async () => {
  const prepare = vi.spyOn(db, "prepare");
  harness.session.mockRejectedValueOnce(new Error("AUTH_REQUIRED"));
  await expect(page()).rejects.toThrow("AUTH_REQUIRED"); expect(prepare).not.toHaveBeenCalled();
  vi.stubEnv("FLAG_V2_ROUTES", "0"); await expect(page()).rejects.toThrow("SSR_NOT_FOUND"); expect(prepare).not.toHaveBeenCalled();
  vi.stubEnv("FLAG_V2_ROUTES", "1"); prepare.mockImplementation(() => { throw new Error("PRIVATE DB ERROR"); });
  expect(initialPage(await page())).toBeNull();
});
