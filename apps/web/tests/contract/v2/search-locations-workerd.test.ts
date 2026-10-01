import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { D1ManualLinkFragmentRepository } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";
import { D1PromptCurationRepository } from "@/lib/v2/infrastructure/d1/prompt-curation-repository";
import { D1RecordLocationRepository } from "@/lib/v2/infrastructure/d1/record-location-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { recordLocationTextHash } from "@/lib/v2/retrieval/record-location-v1";

type LocalD1 = D1DatabaseBinding & { exec(sql: string): Promise<unknown> };
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: LocalD1 }>>> | undefined;
let db: LocalD1;
const owner = "search-owner", rawText = "  Éxact 👀 prompt\r\n[preset]*?  \u0000한글 Needle after NUL  ";

beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: LocalD1 }>({
    configPath: fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url)),
    persist: false, remoteBindings: false, envFiles: [],
  });
  db = platform.env.DB;
  await db.exec("create table users(id text primary key not null); insert into users values ('search-owner'),('other-owner');");
  const directory = new URL("../../../../../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => /^\d{4}_v2_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 32).sort()) {
    for (const statement of (await readFile(new URL(name, directory), "utf8")).split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}, 120_000);

test("actual D1 long tokens preserve contiguous Unicode matches under the 50-byte GLOB limit", async () => {
  const pairs = [
    { query: "a".repeat(299) + "Z", stored: "a".repeat(299) + "Z" },
    { query: "École".repeat(40), stored: "école".repeat(40) },
    { query: "👀한글[]*?".repeat(20), stored: "👀한글[]*?".repeat(20) },
    { query: "ab".repeat(24) + "Σ", stored: "ab".repeat(24) + "ς" },
    { query: "x".repeat(60) + "𐐀", stored: "x".repeat(60) + "𐐨" },
  ];
  const text = "a".repeat(20_000) + "\u0000" + pairs.map((pair) => pair.stored).join("\r\n");
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Long Unicode source", bodyMarkdown: "Separate current body",
    aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: "2026-09-12T00:00:00.000Z",
    sources: [{ kind: "url", rawText: text, contentHash: `sha256:${recordLocationTextHash(text)}`,
      metadata: makeManualLinkMetadata({ url: "https://example.test/long-source", purpose: "prompt" }) }],
  }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, owner).commitCapture(capture);
  const retrieval = new D1RetrievalRepository(db, owner), exact = new D1RecordLocationRepository(db, owner);
  for (const pair of pairs) {
    const plan = defaultV2QueryPlan({ fullText: pair.query });
    const page = await retrieval.searchPage(plan), matches = await retrieval.listMatches(capture.objectId, plan);
    expect(page.totalCount).toBe(1); expect(matches).toMatchObject({ totalCount: 1, privacyLevel: "normal" });
    const opened = await exact.get(capture.objectId, matches.matches[0].location);
    expect(opened.text).toBe(text);
    expect(opened.text.slice(opened.range!.start, opened.range!.end)).toBe(pair.stored);
    expect(opened.range!.start).toBeGreaterThanOrEqual(20_001);
    const changedSuffix = defaultV2QueryPlan({ fullText: pair.query.slice(0, -2) + "ZZ" });
    expect((await retrieval.searchPage(changedSuffix)).totalCount).toBe(0);
  }
}, 120_000);
afterAll(async () => { await platform?.dispose(); });

test("actual workerd/D1 full schema: canonical origins open the same source, fragment and curation bytes", async () => {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Local search proof", bodyMarkdown: "My current body remains separate",
    aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: "2026-09-12T00:00:00.000Z",
    sources: [{ kind: "url", rawText, contentHash: `sha256:${recordLocationTextHash(rawText)}`,
      metadata: makeManualLinkMetadata({ url: "https://example.test/stored-source", purpose: "prompt" }) }],
  }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, owner).commitCapture(capture);
  const snapshots = new D1LinkSnapshotRepository(db, owner);
  const projection = (await snapshots.bootstrapManualSources({ documentId: capture.objectId, expectedRevisionId: capture.revisionId, idempotencyKey: crypto.randomUUID() }))!;
  const basis = { expectedRevisionId: capture.revisionId, expectedSnapshotId: projection.snapshot.id, expectedManifestHash: projection.snapshot.manifestHash };
  const fragment = (await new D1ManualLinkFragmentRepository(db, owner).create(capture.objectId, { ...basis,
    memberId: projection.members[0].id, textStart: 2, textEnd: rawText.indexOf("\r\n"), role: "prompt", idempotencyKey: crypto.randomUUID() })).item;
  const group = (await new D1PromptCurationRepository(db, owner).create(capture.objectId, { ...basis, groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
    content: { title: "Éxact curated example", relationKind: "continuation", relationshipConfirmation: "user_confirmed", orderConfirmation: "user_confirmed",
      items: [0, 1].map((position) => ({ itemKey: `item-${position}`, fragmentId: fragment.id, expectedFragmentStateVersion: 1, copyRole: "prompt" as const, position })), examples: [] },
  })).item;
  const retrieval = new D1RetrievalRepository(db, owner), exact = new D1RecordLocationRepository(db, owner);
  const plan = defaultV2QueryPlan({ fullText: "éxact" });
  const page = await retrieval.searchPage(plan);
  expect(page.totalCount).toBe(1);
  expect(page.results[0]).toMatchObject({ recordId: capture.objectId, matchCount: 4 });
  const matches = await retrieval.listMatches(capture.objectId, plan);
  expect(matches.totalCount).toBe(4);
  expect(new Set(matches.matches.map((match) => match.location.kind))).toEqual(new Set(["source", "manual_fragment", "curation"]));
  for (const match of matches.matches) {
    const result = await exact.get(capture.objectId, match.location);
    expect(result.location).toEqual(match.location);
    expect(result.textHash).toBe(recordLocationTextHash(result.text));
    expect(result.text.slice(result.range!.start, result.range!.end)).toBe("Éxact");
    if (match.location.kind === "source") expect(result.text).toBe(rawText);
    if (match.location.kind === "manual_fragment") expect(result.text).toBe(fragment.fragment.rawText);
    if (match.location.kind === "curation" && match.location.role === "prompt") {
      expect(result.text).toBe(`${fragment.fragment.rawText}\n${fragment.fragment.rawText}`);
      expect(result.context.curationRevisionId).toBe(group.id);
      expect(result.copy).toMatchObject({ allowed: true, mode: "available_only" });
    }
  }
  // GLOB wildcards are literals, and text after NUL retains original UTF-16 offsets.
  for (const token of ["[preset]*?", "한글", "needle"]) {
    const result = await retrieval.listMatches(capture.objectId, defaultV2QueryPlan({ fullText: token }));
    expect(result.totalCount).toBe(1);
    const opened = await exact.get(capture.objectId, result.matches[0].location);
    expect(opened.text).toBe(rawText);
    expect(opened.text.slice(opened.range!.start, opened.range!.end).toLowerCase()).toBe(token);
  }
  expect((await new D1RetrievalRepository(db, "other-owner").searchPage(plan)).totalCount).toBe(0);
  await expect(new D1RecordLocationRepository(db, "other-owner").get(capture.objectId, matches.matches[0].location))
    .rejects.toMatchObject({ code: "record_location_not_found" });
  await db.prepare("update v2_documents set privacy_level='restricted' where object_id=?").bind(capture.objectId).run();
  expect((await retrieval.searchPage(plan)).totalCount).toBe(0);
  await expect(exact.get(capture.objectId, matches.matches[0].location)).rejects.toMatchObject({ code: "restricted_record_locked" });
  const unlocked = await exact.get(capture.objectId, matches.matches[0].location, { restrictedGrantExpiresAt: new Date(Date.now() + 60_000).toISOString() });
  expect(unlocked.privacyLevel).toBe("restricted");
}, 120_000);
