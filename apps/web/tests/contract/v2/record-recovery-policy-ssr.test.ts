import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/v2/auth/restricted-grant")>(),
  getActiveRestrictedGrant: harness.grant,
}));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("SSR_NOT_FOUND"); } }));
// Server page projection is real; leaf client rendering belongs to browser tests.
vi.mock("@/components/v2/editor/document-editor", () => ({ DocumentEditor: () => null }));
vi.mock("@/components/v2/editor/editor-recovery-policy", () => ({ EditorRecoveryPolicy: () => null }));
vi.mock("@/components/v2/restricted-unlock", () => ({ RestrictedUnlock: () => null }));
vi.mock("@/components/v2/record-link-analysis", () => ({ RecordLinkAnalysis: () => null }));
vi.mock("@/components/v2/record-lifecycle-actions", () => ({ RecordLifecycleActions: () => null }));
vi.mock("@/components/v2/record-knowledge", () => ({ RecordKnowledge: () => null, RecordTypeBadge: () => null }));
vi.mock("@/components/v2/record-source-materials", () => ({ RecordSourceMaterials: () => null }));

import recordPage from "@/app/v2/records/[recordId]/page";
import editPage from "@/app/v2/records/[recordId]/edit/page";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";

let db: LinkSqlite;
beforeEach(() => {
  db = new LinkSqlite();
  vi.stubGlobal("React", React);
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1"); vi.stubEnv("FLAG_V2_AI", "1");
  harness.session.mockResolvedValue({ sessionId: "ssr-policy", userId: "link-owner", expiresAt: Date.now() + 120_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

function render(page: "record" | "edit", recordId: string) {
  const params = Promise.resolve({ recordId });
  return page === "record" ? recordPage({ params, searchParams: Promise.resolve({}) }) : editPage({ params });
}
function beforePolicy(mutate: () => void) {
  let fired = false;
  const binding: D1DatabaseBinding = {
    prepare(query) {
      let statement = db.prepare(query);
      const wrapped: D1PreparedStatementBinding = {
        bind(...values) { statement = statement.bind(...values); return wrapped; },
        async first<T>() {
          if (!fired && query.includes("o.id as record_id,d.current_version,d.privacy_level")) { fired = true; mutate(); }
          return statement.first<T>();
        },
        all: <T>() => statement.all<T>(), run: () => statement.run(),
      };
      return wrapped;
    },
    batch: <T>(statements: D1PreparedStatementBinding[]) => db.batch<T>(statements),
  };
  harness.bindings.mockReturnValue({ db: binding });
  return () => expect(fired).toBe(true);
}

for (const page of ["record", "edit"] as const) {
  test(`${page} SSR locked response carries only non-content recovery metadata`, async () => {
    const fixture = await seedLinkRecord(db, { privacyLevel: "restricted" });
    // React component types (notably Next Link) can be circular. Keep all
    // serialized props/children: those are the content boundary under test.
    const payload = JSON.stringify(await render(page, fixture.capture.objectId),
      (key, value) => key === "type" || key === "_owner" ? undefined : value);
    expect(payload).toContain('"currentVersion":1');
    expect(payload).toContain('"privacyLevel":"restricted"');
    expect(payload).not.toContain("PRIVATE MEMO");
    expect(payload).not.toContain(fixture.rawText);
    expect(payload).not.toContain(fixture.capture.revisionId);
  });
  test(`${page} SSR does not return content when the grant expires at the last read`, async () => {
    const fixture = await seedLinkRecord(db, { privacyLevel: "restricted" });
    const expires = Date.now() + 120_000;
    harness.grant.mockResolvedValue({ id: "ssr-grant", expiresAt: new Date(expires).toISOString() });
    const assertFired = beforePolicy(() => { vi.spyOn(Date, "now").mockReturnValue(expires + 1); });
    await expect(render(page, fixture.capture.objectId)).rejects.toThrow("SSR_NOT_FOUND");
    assertFired();
  });
  test.each(["privacy", "version", "owner", "legacy"] as const)(`${page} SSR refuses a stale projection after %s changes`, async (change) => {
    const fixture = await seedLinkRecord(db);
    const assertFired = beforePolicy(() => {
      if (change === "privacy") db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(fixture.capture.objectId);
      if (change === "version") db.sql.prepare("update v2_documents set current_version=current_version+1 where object_id=?").run(fixture.capture.objectId);
      if (change === "owner") db.sql.prepare("update v2_objects set user_id='other-owner' where id=?").run(fixture.capture.objectId);
      if (change === "legacy") db.sql.prepare("update v2_capture_bundles set draft_id=? where id=?").run(`legacy:ssr-hidden:${fixture.capture.captureId}`, fixture.capture.captureId);
    });
    await expect(render(page, fixture.capture.objectId)).rejects.toThrow("SSR_NOT_FOUND");
    assertFired();
  });
}
