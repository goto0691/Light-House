import { afterEach, describe, expect, test } from "vitest";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1ManualLinkFragmentRepository } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";
import { D1PromptCurationRepository } from "@/lib/v2/infrastructure/d1/prompt-curation-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { canonicalRetrievalSql } from "@/lib/v2/infrastructure/d1/retrieval-canonical-sql";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { D1LinkAnalysisRepository } from "@/lib/v2/infrastructure/d1/link-analysis-repository";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1AiRuntimeGovernor } from "@/lib/v2/infrastructure/d1/ai-runtime-governor";
import { runNextLinkAnalysisJob } from "@/lib/v2/ai/link-processing-runner";
import { FakeV2StructuredModelGateway } from "@/lib/v2/ai/fake-gateway";
import type { V2StructuredModelGateway, V2StructuredModelRequest } from "@/lib/v2/ai/gateway";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { firstRecordTextMatch, recordLocationTextHash, type V2RetrievalMatch } from "@/lib/v2/retrieval/record-location-v1";
import { LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";

const databases: LinkSqlite[] = [], owner = "link-owner", now = "2026-09-12T10:00:00.000Z";
function database(version = 32) { const db = new LinkSqlite(version); databases.push(db); return db; }
afterEach(() => { for (const db of databases.splice(0)) db.sql.close(); });
const query = (text: string | null) => defaultV2QueryPlan({ fullText: text });
const repository = (db: D1DatabaseBinding, user = owner) => new D1RetrievalRepository(db, user);

async function capture(db: LinkSqlite, title: string, body: string, privacyLevel: "normal" | "sensitive" | "restricted" = "normal") {
  const prepared = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title, bodyMarkdown: body, aiEnabled: false,
    clientTimezone: "Asia/Seoul", privacyLevel, capturedAt: now }, crypto.randomUUID(), now);
  await new D1SourceFoundationRepository(db, owner).commitCapture(prepared);
  return prepared;
}
async function manual(db: LinkSqlite, f: Awaited<ReturnType<typeof seedLinkRecord>>, count = 1) {
  const projection = f.projection!, saved = [];
  for (let index = 0; index < count; index++) saved.push((await new D1ManualLinkFragmentRepository(db, owner).create(f.capture.objectId, {
    expectedRevisionId: f.capture.revisionId, expectedSnapshotId: projection.snapshot.id, expectedManifestHash: projection.snapshot.manifestHash,
    memberId: projection.members[0].id, textStart: 0, textEnd: f.rawText.length, role: "prompt", idempotencyKey: crypto.randomUUID(),
  })).item);
  return saved;
}
async function curation(db: LinkSqlite, f: Awaited<ReturnType<typeof seedLinkRecord>>, fragmentId: string) {
  const projection = f.projection!;
  return (await new D1PromptCurationRepository(db, owner).create(f.capture.objectId, {
    expectedRevisionId: f.capture.revisionId, expectedSnapshotId: projection.snapshot.id, expectedManifestHash: projection.snapshot.manifestHash,
    groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), content: { title: "needle 정리본", relationKind: "continuation",
      relationshipConfirmation: "user_confirmed", orderConfirmation: "user_confirmed",
      items: [0, 1].map((position) => ({ itemKey: `copy-${position}`, fragmentId, expectedFragmentStateVersion: 1, copyRole: "prompt" as const, position })), examples: [] },
  })).item;
}
async function analysis(db: LinkSqlite, f: Awaited<ReturnType<typeof seedLinkRecord>>) {
  const projection = f.projection!, links = new D1LinkAnalysisRepository(db);
  await links.enqueue(owner, { documentId: f.capture.objectId, expectedRevisionId: f.capture.revisionId,
    expectedSnapshotId: projection.snapshot.id, expectedManifestHash: projection.snapshot.manifestHash });
  const gateway: V2StructuredModelGateway = { async generate<T>(request: V2StructuredModelRequest) {
    const input = JSON.parse((request.parts![0] as { text: string }).text);
    const selection = { member_key: input.sources[0].member_key, first_block: 0, last_block: 0 };
    return new FakeV2StructuredModelGateway("success", { contract_version: "link-analysis.v1", snapshot_id: input.snapshot_id,
      analyzed_revision_id: input.analyzed_revision_id, manifest_version: input.manifest_version, manifest_hash: input.manifest_hash,
      fragments: [{ fragment_key: "selected", role: "prompt", selection }],
      interpretations: [{ fragment_key: "interpreted", role: "insight", text: "needle inferred-only insight", evidence: [selection] }],
    }).generate<T>(request);
  } };
  expect(await runNextLinkAnalysisJob({ links, queue: new D1ProcessingQueueRepository(db), governor: new D1AiRuntimeGovernor(db), gateway, workerId: "search-test" }))
    .toMatchObject({ outcome: "succeeded" });
  return db.sql.prepare("select id,processing_run_id,source_class from v2_link_fragments where processing_run_id is not null order by source_class").all();
}
function exactText(match: V2RetrievalMatch, text: string, token: string) {
  expect(match.location.textHash).toBe(recordLocationTextHash(text));
  expect(match.location.range).toEqual(firstRecordTextMatch(text, [token]));
  expect(match.location.range).not.toBeNull();
  expect(text.slice(match.location.range!.start, match.location.range!.end).length).toBeGreaterThan(0);
}

describe("canonical origin search: actual Node SQLite, not workerd or provider evidence", () => {
  test.each([30, 31, 32])("keeps title/body/original deep matches available on schema %s", async (version) => {
    const db = database(version), f = await seedLinkRecord(db, { snapshot: false });
    const result = await repository(db).searchPage(query("PRIVATE"));
    expect(result.totalCount).toBe(1);
    expect(result.results[0].matches?.[0].origin).toBe("document_body");
    expect(result.results[0].matches?.[0].location).toMatchObject({ kind: "document_body", revisionId: f.capture.revisionId, documentVersion: 1 });
    expect((await repository(db).listMatches(f.capture.objectId, query("prompt"))).matches[0].location)
      .toMatchObject({ kind: "source", snapshotId: null, manifestHash: null, memberId: null, sourceItemId: f.sources[0].id });
  });

  test("counts records once, exposes origin fields separately, and retains exact repeated role assembly", async () => {
    const db = database(), f = await seedLinkRecord(db, { rawText: "👀\r\nneedle source bytes\n" });
    const fragment = (await manual(db, f))[0], curated = await curation(db, f, fragment.id), ai = await analysis(db, f);
    const page = await repository(db).searchPage(query("needle")), matches = await repository(db).listMatches(f.capture.objectId, query("needle"));
    expect(page.totalCount).toBe(1); expect(page.results).toHaveLength(1);
    expect(page.results[0].matches).toHaveLength(3); expect(page.results[0].matchCount).toBe(matches.totalCount);
    expect(matches.matches.map((match) => match.origin)).toEqual(["external_source", "manual_extract", "ai_interpretation", "curation", "curation"]);
    const source = matches.matches.find((match) => match.origin === "external_source")!;
    expect(source.location).toMatchObject({ kind: "source", snapshotId: f.projection!.snapshot.id, manifestHash: f.projection!.snapshot.manifestHash,
      memberId: f.projection!.members[0].id, sourceItemId: f.sources[0].id }); exactText(source, f.rawText, "needle");
    const role = matches.matches.find((match) => match.location.kind === "curation" && match.location.role === "prompt")!;
    expect(role.location).toMatchObject({ revisionId: curated.id, groupKey: curated.groupKey }); exactText(role, [f.rawText, f.rawText].join("\n"), "needle");
    expect(matches.matches.find((match) => match.origin === "manual_extract")?.reviewStatus).toBe("confirmed");
    const interpreted = matches.matches.find((match) => match.origin === "ai_interpretation")!;
    expect(interpreted.reviewStatus).toBe("proposed"); expect(interpreted.location.kind).toBe("ai_fragment");
    expect(interpreted.location).toMatchObject({ fragmentId: ai.find((row) => row.source_class === "ai_interpretation")!.id });
    exactText(interpreted, "needle inferred-only insight", "needle");
  });

  test("finds old snapshot sources/manuals/curations without requiring the current source to match", async () => {
    const db = database(), f = await seedLinkRecord(db, { rawText: "antique needle\n" });
    const fragment = (await manual(db, f))[0], curated = await curation(db, f, fragment.id);
    await f.snapshots.createSnapshot({ documentId: f.capture.objectId, expectedRevisionId: f.capture.revisionId,
      expectedSnapshotId: f.projection!.snapshot.id, expectedSnapshotVersion: 1, sourceItemIds: [],
      newManualSources: [{ rawText: "modern unrelated", metadata: makeManualLinkMetadata({ url: "https://example.test/new" }) }], idempotencyKey: crypto.randomUUID() });
    // A stale/empty index cannot erase canonical historical content.
    db.sql.prepare("update v2_documents_fts set source_text='' where object_id=?").run(f.capture.objectId);
    const results = await repository(db).searchPage(query("antique")), page = await repository(db).listMatches(f.capture.objectId, query("antique"));
    expect(results.totalCount).toBe(1); expect(page.totalCount).toBe(3);
    expect(page.matches.every((match) => match.isHistorical && 'snapshotId' in match.location && match.location.snapshotId === f.projection!.snapshot.id)).toBe(true);
    expect(page.matches.some((match) => match.location.kind === "curation" && match.location.revisionId === curated.id)).toBe(true);
  });

  test("finds every match beyond fifty without capping candidates before its count", async () => {
    const db = database(), f = await seedLinkRecord(db, { rawText: "needle" }); await manual(db, f, 53);
    const plan = query("needle"), first = await repository(db).listMatches(f.capture.objectId, plan), second = await repository(db).listMatches(f.capture.objectId, plan, false, 2);
    expect(first).toMatchObject({ totalCount: 54, page: 1, pageSize: 50, totalPages: 2 }); expect(first.matches).toHaveLength(50); expect(second.matches).toHaveLength(4);
    expect(new Set([...first.matches, ...second.matches].map((match) => match.id)).size).toBe(54);
    expect((await repository(db).listMatches(f.capture.objectId, plan, false, 999)).page).toBe(2);
    expect((await repository(db).searchPage(plan)).results[0]).toMatchObject({ matchCount: 54, matches: expect.any(Array) });
  });

  test("keeps opaque source/member tuples distinct when their colon-joined spellings overlap", async () => {
    const db = database(), sourceIds = ["a:b", "a"], texts = ["needle origin", "unrelated origin"];
    const prepared = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "plain", bodyMarkdown: "memo",
      aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: now,
      sources: texts.map((rawText, index) => ({ kind: "url" as const, rawText, contentHash: `sha256:${recordLocationTextHash(rawText)}`,
        metadata: makeManualLinkMetadata({ url: `https://example.test/source-${index}` }) })),
    }, crypto.randomUUID(), now);
    let urlIndex = 0;
    const fixture = { ...prepared, sources: prepared.sources.map((source) => source.kind === "url" ? { ...source, id: sourceIds[urlIndex++] } : source) };
    await new D1SourceFoundationRepository(db, owner).commitCapture(fixture);
    const snapshot = await new D1LinkSnapshotRepository(db, owner).bootstrapManualSources({ documentId: fixture.objectId,
      expectedRevisionId: fixture.revisionId, idempotencyKey: crypto.randomUUID() });
    // A restore may preserve opaque IDs containing delimiters. Member row IDs
    // are not part of the manifest hash; preserve every hashed field and keep
    // all actual foreign keys and owner triggers enabled while reseeding IDs.
    const members = db.sql.prepare("select * from v2_link_snapshot_sources where snapshot_id=? order by source_order").all(snapshot.snapshot.id);
    db.sql.prepare("delete from v2_link_snapshot_sources where snapshot_id=?").run(snapshot.snapshot.id);
    for (const member of members) {
      const row = { ...member, id: member.source_item_id === "a:b" ? "c" : "b:c" }, names = Object.keys(row);
      await db.prepare(`insert into v2_link_snapshot_sources(${names.join(",")}) values (${names.map(() => "?").join(",")})`).bind(...Object.values(row)).run();
    }
    expect(db.sql.prepare("pragma foreign_key_check").all()).toEqual([]);
    const page = await repository(db).listMatches(fixture.objectId, query("needle"));
    expect(page.totalCount).toBe(1); expect(page.matches).toHaveLength(1);
    expect(page.matches[0].location).toMatchObject({ kind: "source", sourceItemId: "a:b", memberId: "c" });
    exactText(page.matches[0], texts[0], "needle");
    expect((await repository(db).searchPage(query("needle"))).results[0].matchCount).toBe(1);
  });

  test("retains record pagination and title ordering beyond fifty with cross-field token AND", async () => {
    const db = database();
    for (let index = 0; index < 53; index++) await capture(db, `alpha ${String(index).padStart(2, "0")}`, "beta");
    await capture(db, "alpha locked", "beta", "restricted");
    const plan = defaultV2QueryPlan({ fullText: "alpha beta", sort: { field: "title", direction: "asc" } });
    const first = await repository(db).searchPage(plan), second = await repository(db).searchPage(plan, false, 2);
    expect(first).toMatchObject({ totalCount: 53, totalPages: 2 }); expect(first.results).toHaveLength(50); expect(second.results).toHaveLength(3);
    expect(first.results[0].title).toBe("alpha 00"); expect(second.results[2].title).toBe("alpha 52");
    expect(new Set([...first.results, ...second.results].map((result) => result.recordId)).size).toBe(53);
    expect(first.results[0].matches?.some((match) => match.origin === "document_title")).toBe(true);
    expect(first.results[0].matches?.some((match) => match.origin === "document_body")).toBe(true);
  });

  test.each(["ÉCOLE", "école", "한글", "👀", "%_", "'\"[]*?"])("returns literal Unicode token %s with its original UTF-16 offset", async (token) => {
    const db = database(), body = "before 👀\r\nécole 한글 %_ '\"[]*? after";
    const f = await capture(db, "plain", body), page = await repository(db).listMatches(f.objectId, query(token));
    const match = page.matches.find((item) => item.origin === "document_body")!;
    expect(page.totalCount).toBeGreaterThan(0); expect(match).toBeDefined(); exactText(match, body, token);
    expect((await repository(db).searchPage(query(token))).totalCount).toBe(1);
    if (token === "%_") expect((await repository(db).searchPage(query("%missing_"))).totalCount).toBe(0);
  });

  test.each(["abcdefghij".repeat(30), "École".repeat(40), "👀한글[*]?".repeat(20), "[\u0301]*?É👀한글".repeat(15), "X".repeat(20) + "Σ", "p".repeat(20) + "𐐀"])("uses only D1-sized patterns for a long literal token: %#", async (token) => {
    const built = canonicalRetrievalSql({ plan: query(token), userId: owner, includeRestricted: false, legacyVisibility: "1", entityVisibility: "1",
      schema: { links: true, curations: true } });
    const specifications = JSON.parse(String(built.bindings[0])) as { pattern: string | null; prefix?: string; parts?: { pattern: string }[] }[];
    for (const specification of specifications) for (const pattern of [specification.pattern, specification.prefix, ...(specification.parts?.map((part) => part.pattern) ?? [])]) {
      if (pattern !== undefined && pattern !== null) expect(new TextEncoder().encode(pattern).length).toBeLessThanOrEqual(50);
    }
    const db = database(), variant = token.replaceAll("É", "é").replaceAll("Σ", "ς").replaceAll("𐐀", "𐐨"), body = `before 👀\0${variant} after`;
    const f = await capture(db, "exact", body);
    const points = Array.from(variant), split = Math.floor(points.length / 2);
    await capture(db, "split", `${points.slice(0, split).join("")}--BREAK--${points.slice(split).join("")}`);
    expect((await repository(db).searchPage(query(token))).totalCount).toBe(1);
    const match = (await repository(db).listMatches(f.objectId, query(token))).matches.find((item) => item.origin === "document_body")!;
    expect(match).toBeDefined(); exactText(match, body, token);
  });

  test("finds the final complete long token after thousands of overlapping prefixes without joining displaced chunks", async () => {
    const db = database(), token = "A".repeat(240) + "Z", body = "👀" + "a".repeat(20_000) + "z";
    const f = await seedLinkRecord(db, { rawText: body });
    const separated = "a".repeat(120) + "--" + "a".repeat(120) + "z", reordered = "z" + "a".repeat(240);
    expect(firstRecordTextMatch(separated, [token])).toBeNull(); expect(firstRecordTextMatch(reordered, [token])).toBeNull();
    await capture(db, "separated", separated); await capture(db, "reordered", reordered);
    const page = await repository(db).searchPage(query(token)); expect(page.totalCount).toBe(1);
    const match = (await repository(db).listMatches(f.capture.objectId, query(token))).matches[0];
    expect(match.location).toMatchObject({ kind: "source" }); exactText(match, body, token);
  });

  test("rejects stale FTS-only text, same-owner wrong-capture sources, foreign owners and legacy orphans", async () => {
    const db = database(), own = await capture(db, "own", "body"), other = await capture(db, "other", "alien source");
    db.sql.prepare("insert into v2_document_source_links(document_object_id,source_item_id,role,source_order,created_at) values (?,?,'evidence',50,?)")
      .run(own.objectId, other.sources[0].id, now);
    db.sql.prepare("update v2_documents_fts set body='injected ghost' where object_id=?").run(own.objectId);
    expect((await repository(db).listMatches(own.objectId, query("alien"))).totalCount).toBe(0);
    expect((await repository(db).searchPage(query("ghost"))).totalCount).toBe(0);
    expect((await repository(db, "other-owner").searchPage(query("body"))).totalCount).toBe(0);
    db.sql.prepare("update v2_capture_bundles set draft_id='legacy:orphan' where id=?").run(own.captureId);
    expect((await repository(db).searchPage(query("body"))).totalCount).toBe(0);
  });

  test.each(["👀 before\0after needle", "\0\0👀\0한글\0\0école needle\0\0", "\0".repeat(5_000) + "👀 école needle\0"])
    ("finds text across stored NUL segments without changing source bytes or UTF-16 ranges: %#", async (body) => {
    const db = database(), f = await capture(db, "plain", body);
    const matches = await repository(db).listMatches(f.objectId, query("needle"));
    const match = matches.matches.find((value) => value.origin === "document_body")!;
    expect(match).toBeDefined(); exactText(match, body, "needle");
    expect(match.snippet).toContain("\0"); expect((await repository(db).searchPage(query("needle"))).totalCount).toBe(1);
    expect((await repository(db).searchPage(query("beforeafter"))).totalCount).toBe(0);
  });

  test.each(["rejected", "superseded"])("excludes %s AI-only content from record and match counts", async (status) => {
    const db = database(), f = await seedLinkRecord(db, { rawText: "plain source" }); await analysis(db, f);
    const before = await repository(db).listMatches(f.capture.objectId, query("inferred-only")); expect(before.totalCount).toBe(1);
    db.sql.prepare("update v2_link_fragments set review_status=?,state_version=state_version+1 where source_class='ai_interpretation'").run(status);
    expect((await repository(db).listMatches(f.capture.objectId, query("inferred-only"))).totalCount).toBe(0);
    expect((await repository(db).searchPage(query("inferred-only"))).totalCount).toBe(0);
  });

  test("does not advertise AI content whose canonical evidence disappeared", async () => {
    const db = database(), f = await seedLinkRecord(db, { rawText: "plain source" }); await analysis(db, f);
    expect((await repository(db).searchPage(query("inferred-only"))).totalCount).toBe(1);
    db.sql.exec("delete from v2_link_fragment_evidence where fragment_id in (select id from v2_link_fragments where source_class='ai_interpretation')");
    expect((await repository(db).searchPage(query("inferred-only"))).totalCount).toBe(0);
    expect((await repository(db).listMatches(f.capture.objectId, query("inferred-only"))).totalCount).toBe(0);
  });

  test("finds the exact AI run after twenty newer attempts and keeps confirmation separate", async () => {
    const db = database(), f = await seedLinkRecord(db, { rawText: "plain source" }), ai = await analysis(db, f);
    const selected = ai.find((row) => row.source_class === "source_extract")!, runId = String(selected.processing_run_id);
    const stored = db.sql.prepare("select * from v2_processing_runs where id=?").get(runId)!;
    for (let index = 0; index < 21; index++) {
      const row = { ...stored, id: `newer-attempt-${index}`, created_at: `2090-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`, status: "failed" };
      const columns = Object.keys(row);
      await db.prepare(`insert into v2_processing_runs(${columns.join(",")}) values (${columns.map(() => "?").join(",")})`).bind(...Object.values(row)).run();
    }
    expect(db.sql.prepare("select count(*) as count from v2_processing_runs where created_at>?").get(String(stored.created_at))!.count).toBe(21);
    const before = (await repository(db).listMatches(f.capture.objectId, query("plain"))).matches.find((match) => match.origin === "ai_extract")!;
    expect(before.location).toMatchObject({ fragmentId: selected.id, runId }); expect(before.reviewStatus).toBe("proposed");
    db.sql.prepare("update v2_link_fragments set review_status='confirmed',state_version=state_version+1 where id=?").run(String(selected.id));
    const after = (await repository(db).listMatches(f.capture.objectId, query("plain"))).matches.find((match) => match.origin === "ai_extract")!;
    expect(after.location).toEqual(before.location); expect(after.reviewStatus).toBe("confirmed");
  });

  test("keeps type/property/entity/date filters and entity-only record membership without fabricated text ranges", async () => {
    const db = database(), f = await capture(db, "movie", "needle");
    db.sql.exec(`insert into v2_type_definitions(id,user_id,key,label,applies_to_kind,status,origin,definition,schema_version,usage_count,user_pinned,created_at,updated_at)
      values ('movie-type','link-owner','movie_review','영화 리뷰','document','active','user_created','영화',1,1,1,'${now}','${now}');
      insert into v2_field_definitions(id,user_id,key,label,definition,data_type,status,origin,schema_version,usage_count,created_at,updated_at)
      values ('rating-field','link-owner','rating','평점','평점','rating','active','user_created',1,1,'${now}','${now}');
      insert into v2_predicate_definitions(id,user_id,key,label,definition,status,origin,schema_version,created_at,updated_at)
      values ('mentions','link-owner','mentions_entity','언급','언급','active','user_created',1,'${now}','${now}');
      insert into v2_objects(id,user_id,object_kind,lifecycle_status,created_at,updated_at) values ('subject','link-owner','entity','active','${now}','${now}');
      insert into v2_entity_records(object_id,entity_kind,canonical_name,resolution_status,created_at) values ('subject','work','봄날','resolved','${now}');`);
    await db.prepare(`insert into v2_object_type_assignments(id,user_id,object_id,type_definition_id,role,source_class,review_status,locked_by_user,created_at,updated_at)
      values ('movie-assignment','link-owner',?,'movie-type','primary','user','accepted',1,?,?)`).bind(f.objectId, now, now).run();
    await db.prepare(`insert into v2_property_values(id,user_id,owner_object_id,field_definition_id,value_kind,value_number,value_json,source_class,claim_risk,review_status,locked_by_user,created_at)
      values ('rating','link-owner',?,'rating-field','rating',4.5,'4.5','user_explicit','low','accepted',1,?)`).bind(f.objectId, now).run();
    await db.prepare(`insert into v2_relation_edges(id,user_id,subject_object_id,predicate_definition_id,object_object_id,source_class,claim_risk,review_status,locked_by_user,created_at)
      values ('relation','link-owner',?,'mentions','subject','user_explicit','low','accepted',1,?)`).bind(f.objectId, now).run();
    const plan = defaultV2QueryPlan({ fullText: "봄날", typeKeys: ["movie_review"], propertyFilters: [{ fieldKey: "rating", operator: "gte", value: 4 }],
      entityFilters: [{ entityKind: "work", targetObjectId: "subject" }], dateFilter: { axis: "captured_at", from: "2026-01-01", to: "2026-12-31" } });
    const page = await repository(db).searchPage(plan);
    expect(page.totalCount).toBe(1); expect(page.results[0]).toMatchObject({ recordId: f.objectId, matches: [], matchCount: 0, typeKey: "movie_review" });
    expect((await repository(db).searchPage({ ...plan, propertyFilters: [{ fieldKey: "rating", operator: "gte", value: 5 }] })).totalCount).toBe(0);
    expect((await repository(db).searchPage({ ...plan, dateFilter: { axis: "captured_at", from: "2027-01-01", to: null } })).totalCount).toBe(0);
  });

  test("suppresses private previews and binds count/page/bytes at one final permission snapshot", async () => {
    const db = database(), normal = await capture(db, "normal", "needle"), sensitive = await capture(db, "sensitive", "needle", "sensitive"), restricted = await capture(db, "locked", "needle", "restricted");
    expect((await repository(db).searchPage(query("needle"))).totalCount).toBe(2);
    for (const id of [sensitive.objectId, restricted.objectId]) {
      const page = await repository(db).listMatches(id, query("needle"), true);
      expect(page.privacyLevel).toBe(id === sensitive.objectId ? "sensitive" : "restricted");
      expect(page.matches.length).toBeGreaterThan(0); expect(page.matches.every((match) => match.snippet === null)).toBe(true);
    }
    let snapshots = 0;
    const binding: D1DatabaseBinding = { prepare(sql) {
      let actual = db.prepare(sql);
      const statement: D1PreparedStatementBinding = { bind(...values) { actual = actual.bind(...values); return statement; },
        async first<T>() {
          if (sql.startsWith("with recursive search_tokens as")) { snapshots++; db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(normal.objectId); }
          return actual.first<T>();
        }, all<T>() { return actual.all<T>(); }, run() { return actual.run(); } };
      return statement;
    }, batch: (statements) => db.batch(statements) };
    const page = await repository(binding).listMatches(normal.objectId, query("needle"));
    expect(snapshots).toBe(1); expect(page).toMatchObject({ privacyLevel: null, totalCount: 0, matches: [] });
  });

  test.each([
    ["sensitive", "update v2_documents set privacy_level='sensitive' where object_id=?", "sensitive"],
    ["restricted", "update v2_documents set privacy_level='restricted' where object_id=?", null],
    ["foreign owner", "update v2_objects set user_id='other-owner' where id=?", null],
    ["deleted", "update v2_objects set lifecycle_status='deleted' where id=?", null],
  ] as const)("reports the atomic record privacy after normal becomes %s", async (_label, mutation, privacyLevel) => {
    const db = database(), f = await capture(db, "visible title", "needle visible snippet");
    const initial = await repository(db).searchPage(query("needle"));
    expect(initial.results[0]).toMatchObject({ privacyLevel: "normal", snippet: expect.stringContaining("visible snippet") });
    let snapshots = 0;
    const binding: D1DatabaseBinding = { prepare(sql) {
      let actual = db.prepare(sql);
      const statement: D1PreparedStatementBinding = { bind(...values) { actual = actual.bind(...values); return statement; },
        async first<T>() {
          if (sql.startsWith("with recursive search_tokens as")) { snapshots++; db.sql.prepare(mutation).run(f.objectId); }
          return actual.first<T>();
        }, all<T>() { return actual.all<T>(); }, run() { return actual.run(); } };
      return statement;
    }, batch: (statements) => db.batch(statements) };
    const page = await repository(binding).listMatches(f.objectId, query("needle"));
    expect(snapshots).toBe(1); expect(page.privacyLevel).toBe(privacyLevel);
    expect(page.matches.every((match) => match.snippet === null)).toBe(true);
    if (privacyLevel === null) expect(page).toMatchObject({ totalCount: 0, matches: [] });
    else expect(page.totalCount).toBeGreaterThan(0);
  });

  test("distinguishes an accessible zero-match plan from a record outside the requested filter", async () => {
    const db = database(), f = await capture(db, "plain", "body");
    expect(await repository(db).listMatches(f.objectId, query(null))).toMatchObject({ privacyLevel: "normal", totalCount: 0, matches: [] });
    expect(await repository(db).listMatches(f.objectId, query("absent"))).toMatchObject({ privacyLevel: null, totalCount: 0, matches: [] });
    expect(await repository(db).listMatches("missing-record", query(null))).toMatchObject({ privacyLevel: null, totalCount: 0, matches: [] });
  });
});
