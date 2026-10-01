import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import type { CreatePromptCurationRequest } from "@/lib/v2/domain/prompt-curation-request";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { D1ManualLinkFragmentRepository } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";
import { D1PromptCurationRepository } from "@/lib/v2/infrastructure/d1/prompt-curation-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";

type TestD1 = D1DatabaseBinding & { exec(sql: string): Promise<unknown> };
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: TestD1 }>>>;
let db: TestD1;
beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: TestD1 }>({
    configPath: fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url)),
    persist: false, remoteBindings: false, envFiles: [],
  });
  db = platform.env.DB;
  await db.exec("create table users(id text primary key not null); insert into users values ('curation-owner'),('curation-other');");
  const directory = fileURLToPath(new URL("../../../../../migrations/", import.meta.url));
  for (const name of (await readdir(directory)).filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 32).sort()) {
    for (const sql of (await readFile(`${directory}/${name}`, "utf8")).split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await db.prepare(sql).run();
  }
}, 90_000);
afterAll(async () => { await platform?.dispose(); });

async function seed(withImage = false) {
  const rawText = "  portrait 👀\r\n--ar 3:2\n";
  const attachmentId = crypto.randomUUID(), imageHash = "b".repeat(64), now = new Date().toISOString();
  // Pre-verified synthetic reservation exercises actual D1 membership/commit;
  // it does not claim a real R2 upload, decoded image, or provider response.
  if (withImage) await db.prepare(`insert into v2_attachment_reservations(id,user_id,status,object_key,filename,mime_type,size_bytes,sha256,created_at,expires_at,verified_at)
    values(?,'curation-owner','verified',?,'example.png','image/png',8,?,?,'2099-01-01T00:00:00.000Z',?)`)
    .bind(attachmentId, `fixture/${attachmentId}.png`, imageHash, now, now).run();
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", bodyMarkdown: "My private memo", aiEnabled: false,
    privacyLevel: "normal", clientTimezone: "Asia/Seoul", capturedAt: new Date().toISOString(), sources: [{ kind: "url", rawText,
      contentHash: `sha256:${await linkSha256Hex(rawText)}`, metadata: makeManualLinkMetadata({ url: "https://example.invalid/prompt", purpose: "prompt", completeness: "complete", partNumber: 1, totalParts: 1 }) },
      ...(withImage ? [{ kind: "image" as const, contentHash: `sha256:${imageHash}`, attachmentId }] : [])],
  }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, "curation-owner").commitCapture(capture);
  const projection = await new D1LinkSnapshotRepository(db, "curation-owner").bootstrapManualSources({
    documentId: capture.objectId, expectedRevisionId: capture.revisionId, idempotencyKey: crypto.randomUUID(),
  });
  const basis = { expectedRevisionId: capture.revisionId, expectedSnapshotId: projection.snapshot.id, expectedManifestHash: projection.snapshot.manifestHash };
  const fragment = await new D1ManualLinkFragmentRepository(db, "curation-owner").create(capture.objectId, {
    ...basis, memberId: projection.members[0].id, textStart: 0, textEnd: rawText.length, role: "prompt", idempotencyKey: crypto.randomUUID(),
  });
  const input: CreatePromptCurationRequest = { ...basis, groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), content: {
    title: "Local D1 curation", relationKind: "continuation", relationshipConfirmation: "user_confirmed", orderConfirmation: "user_confirmed",
    items: [{ itemKey: "first", fragmentId: fragment.item.id, expectedFragmentStateVersion: 1, copyRole: "prompt", position: 0 }], examples: [],
  } };
  return { capture, rawText, input, projection, repository: new D1PromptCurationRepository(db, "curation-owner") };
}

describe("curation repository against local workerd D1 bindings, not remote production", () => {
  test("explicit migration atomically retains 64 items/images, selected history and exact copy", async () => {
    const f = await seed(true), image = f.projection.members.find((member) => member.kind === "image")!;
    const content = { ...f.input.content, items: Array.from({ length: 64 }, (_, position) => ({ ...f.input.content.items[0], itemKey: `part-${position}`, position })),
      examples: Array.from({ length: 64 }, (_, position) => ({ exampleKey: `image-${position}`, itemKey: position ? `part-${position}` : null,
        memberId: image.id, attachmentId: image.attachments[0].id, position, evidenceMethod: position ? "user_confirmed" as const : "unresolved" as const })) };
    const first = await f.repository.create(f.capture.objectId, { ...f.input, content });
    const target = await new D1LinkSnapshotRepository(db, "curation-owner").createSnapshot({ documentId: f.capture.objectId,
      expectedRevisionId: f.capture.revisionId, expectedSnapshotId: f.projection.snapshot.id, expectedSnapshotVersion: 1,
      sourceItemIds: f.projection.members.map((member) => member.sourceItemId).reverse(), idempotencyKey: crypto.randomUUID() });
    const plan = await f.repository.previewMigration(f.capture.objectId, f.input.groupKey, first.item.id);
    expect(plan.ready).toBe(true); expect(plan.items).toHaveLength(64); expect(plan.examples).toHaveLength(64);
    const request = { expectedRevisionId: plan.expectedRevisionId, expectedSnapshotId: plan.expectedSnapshotId, expectedManifestHash: plan.expectedManifestHash,
      expectedPlanHash: plan.planHash, groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
    const migrated = await f.repository.migrate(f.capture.objectId, f.input.groupKey, first.item.id, request);
    expect(migrated.item).toMatchObject({ revisionNumber: 1, basedOnRevisionId: first.item.id, changeReason: "migrate", snapshotId: target.snapshot.id });
    expect(migrated.item.items).toHaveLength(64); expect(migrated.item.examples).toHaveLength(64);
    expect(migrated.item.examples[0]).toMatchObject({ itemKey: null, evidenceMethod: "unresolved" });
    expect(migrated.item.content.examples.every((example) => example.memberId !== image.id && example.attachmentId === image.attachments[0].id)).toBe(true);
    expect((await f.repository.copy(f.capture.objectId, request.groupKey, migrated.item.id, { role: "prompt", mode: "standard" })).text).toBe(Array(64).fill(f.rawText).join("\n"));
    expect((await f.repository.migrate(f.capture.objectId, f.input.groupKey, first.item.id, request)).item).toEqual(migrated.item);
    expect((await f.repository.get(f.capture.objectId, f.input.groupKey)).item).toEqual(first.item);
    expect(await db.prepare("select count(*) as n from v2_link_fragments where document_object_id=?").bind(f.capture.objectId).first()).toEqual({ n: 2 });
    await expect(new D1PromptCurationRepository(db, "curation-other").previewMigration(f.capture.objectId, f.input.groupKey, first.item.id)).rejects.toMatchObject({ code: "record_not_found" });
  }, 60_000);
  test("migration receipt failure rolls back manual/evidence/curation and concurrent keys coalesce", async () => {
    const f = await seed(), first = await f.repository.create(f.capture.objectId, f.input);
    await new D1LinkSnapshotRepository(db, "curation-owner").createSnapshot({ documentId: f.capture.objectId,
      expectedRevisionId: f.capture.revisionId, expectedSnapshotId: f.projection.snapshot.id, expectedSnapshotVersion: 1,
      sourceItemIds: f.projection.members.map((member) => member.sourceItemId), idempotencyKey: crypto.randomUUID() });
    const plan = await f.repository.previewMigration(f.capture.objectId, f.input.groupKey, first.item.id);
    const request = { expectedRevisionId: plan.expectedRevisionId, expectedSnapshotId: plan.expectedSnapshotId, expectedManifestHash: plan.expectedManifestHash,
      expectedPlanHash: plan.planHash, groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
    await db.prepare("create trigger migration_fail_receipt before insert on v2_idempotency_records when NEW.operation='prompt_curation.migrate.v1' begin select raise(abort,'migration_receipt_failure'); end").run();
    try { await expect(f.repository.migrate(f.capture.objectId, f.input.groupKey, first.item.id, request)).rejects.toThrow("migration_receipt_failure"); }
    finally { await db.prepare("drop trigger migration_fail_receipt").run(); }
    expect(await db.prepare("select count(*) as n from v2_link_fragments where document_object_id=?").bind(f.capture.objectId).first()).toEqual({ n: 1 });
    expect(await db.prepare("select count(*) as n from v2_link_fragment_evidence where fragment_id in (select id from v2_link_fragments where document_object_id=?)").bind(f.capture.objectId).first()).toEqual({ n: 1 });
    expect(await db.prepare("select count(*) as n from v2_link_curation_revisions where document_object_id=?").bind(f.capture.objectId).first()).toEqual({ n: 1 });
    const results = await Promise.all([1, 2].map(() => f.repository.migrate(f.capture.objectId, f.input.groupKey, first.item.id, request)));
    expect(results[0].item.id).toBe(results[1].item.id);
    expect(await db.prepare("select count(*) as n from v2_link_fragments where document_object_id=?").bind(f.capture.objectId).first()).toEqual({ n: 2 });
  }, 60_000);
  test("bulk JSON, immutable transitions, exact copy and retry work on local D1", async () => {
    const f = await seed(true), image = f.projection.members.find((member) => member.kind === "image")!;
    const input = { ...f.input, content: { ...f.input.content, items: Array.from({ length: 64 }, (_, position) => ({
      ...f.input.content.items[0], itemKey: `part-${position}`, position,
    })), examples: Array.from({ length: 64 }, (_, position) => ({ exampleKey: `image-${position}`, itemKey: position === 0 ? null : `part-${position}`,
      memberId: image.id, attachmentId: image.attachments[0].id, position, evidenceMethod: "user_confirmed" as const })) } };
    const first = await f.repository.create(f.capture.objectId, input);
    expect(first.item.examples).toHaveLength(64);
    expect((await f.repository.copy(f.capture.objectId, input.groupKey, first.item.id, { role: "prompt", mode: "standard" })).text).toBe(Array(64).fill(f.rawText).join("\n"));
    const request = { expectedRevisionId: input.expectedRevisionId, expectedSnapshotId: input.expectedSnapshotId, expectedManifestHash: input.expectedManifestHash,
      expectedCurationRevisionId: first.item.id, expectedCurationRevisionNumber: 1, idempotencyKey: crypto.randomUUID(), action: "archive" };
    const archived = await f.repository.revise(f.capture.objectId, input.groupKey, request);
    expect(archived.item).toMatchObject({ status: "archived", revisionNumber: 2, parentRevisionId: first.item.id });
    expect((await f.repository.revise(f.capture.objectId, input.groupKey, request)).replayed).toBe(true);
    expect((await f.repository.get(f.capture.objectId, input.groupKey, { revisionId: first.item.id })).item.prepared).toEqual(first.item.prepared);
    expect((await f.repository.list(f.capture.objectId)).items).toMatchObject([{ id: archived.item.id }]);
  }, 60_000);
  test("concurrent same-key transactions coalesce and different keys cannot overwrite the head", async () => {
    const f = await seed();
    const same = await Promise.all([f.repository.create(f.capture.objectId, f.input), f.repository.create(f.capture.objectId, f.input)]);
    expect(same[0].item.id).toBe(same[1].item.id);
    const request = { expectedRevisionId: f.input.expectedRevisionId, expectedSnapshotId: f.input.expectedSnapshotId, expectedManifestHash: f.input.expectedManifestHash,
      expectedCurationRevisionId: same[0].item.id, expectedCurationRevisionNumber: 1, action: "edit", content: f.input.content };
    const edits = await Promise.allSettled([1, 2].map(() => f.repository.revise(f.capture.objectId, f.input.groupKey, { ...request, idempotencyKey: crypto.randomUUID() })));
    expect(edits.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(edits.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "prompt_curation_conflict" } });
    expect(await db.prepare("select count(*) as n from v2_link_curation_revisions where document_object_id=?").bind(f.capture.objectId).first()).toEqual({ n: 2 });
  }, 60_000);
  test("late receipt failure rolls back all rows and protected receipts require a live grant", async () => {
    const f = await seed();
    await db.prepare("create trigger curation_fail_receipt before insert on v2_idempotency_records when NEW.operation='prompt_curation.create.v1' begin select raise(abort,'curation_receipt_failure'); end").run();
    try { await expect(f.repository.create(f.capture.objectId, f.input)).rejects.toThrow("curation_receipt_failure"); }
    finally { await db.prepare("drop trigger curation_fail_receipt").run(); }
    expect(await db.prepare("select count(*) as n from v2_link_curation_revisions where document_object_id=?").bind(f.capture.objectId).first()).toEqual({ n: 0 });
    expect(await db.prepare("select count(*) as n from v2_audit_events where object_id=? and action='link.curation_saved'").bind(f.capture.objectId).first()).toEqual({ n: 0 });
    await f.repository.create(f.capture.objectId, f.input);
    await db.prepare("update v2_documents set privacy_level='restricted' where object_id=?").bind(f.capture.objectId).run();
    await expect(f.repository.create(f.capture.objectId, f.input)).rejects.toMatchObject({ code: "restricted_record_locked" });
    expect((await f.repository.create(f.capture.objectId, f.input, { restrictedGrantExpiresAt: new Date(Date.now() + 60000).toISOString() })).replayed).toBe(true);
    await expect(new D1PromptCurationRepository(db, "curation-other").list(f.capture.objectId)).rejects.toMatchObject({ code: "record_not_found" });
  }, 60_000);
});
