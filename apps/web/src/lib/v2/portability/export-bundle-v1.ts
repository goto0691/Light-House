import { createHash } from "node:crypto";

import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import type { ExportJobProjection } from "@/lib/v2/infrastructure/d1/portability-repository";
import { CANONICAL_TABLES_V1, fullFidelityCanonicalScope, assertPromptCurationExportScope } from "@/lib/v2/portability/canonical-table-registry-v1";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import {
  canonicalJson,
  envelopeCanonicalRow,
  exportRootHash,
  LIGHTHOUSE_EXPORT_FORMAT,
  LIGHTHOUSE_EXPORT_VERSION,
  LIGHTHOUSE_SCHEMA_VERSION,
  sha256Hex,
  type ExportFileManifestV1,
  type ExportManifestV1,
} from "@/lib/v2/portability/portability-contract-v1";
import { createStoredZipStream, type StreamingZipEntry } from "@/lib/v2/portability/zip-stream-v1";

const encoder = new TextEncoder();
const PAGE_SIZE = 200;
const MULTIPART_BYTES = 8 * 1024 * 1024;

function safeFilename(value: string) {
  const cleaned = value.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim();
  return (cleaned || "original").slice(0, 180);
}

function yamlString(value: string) {
  return JSON.stringify(value);
}

async function queryAll<T extends Record<string, unknown>>(db: D1DatabaseBinding, sql: string, bindings: readonly unknown[]) {
  return db.prepare(sql).bind(...bindings).all<T>();
}

function jsonlSource(
  db: D1DatabaseBinding,
  descriptor: (typeof CANONICAL_TABLES_V1)[number],
  job: ExportJobProjection,
  count: { value: number },
) {
  return (async function* () {
    const queryScope = job.profile === "migration" ? fullFidelityCanonicalScope(job.scope) : job.scope;
    const scoped = descriptor.query((job as ExportJobProjection & { userId?: string }).userId ?? "", queryScope);
    let offset = 0;
    while (true) {
      const order = descriptor.primaryKey.map((key) => `"${key}"`).join(",");
      const page = await queryAll(db, `select * from (${scoped.sql}) as scoped_rows order by ${order} limit ? offset ?`, [...scoped.bindings, PAGE_SIZE, offset]);
      if (!page.results.length) break;
      count.value += page.results.length;
      const payload = page.results.map((row) => canonicalJson(envelopeCanonicalRow(row, job.id))).join("\n") + "\n";
      yield encoder.encode(payload);
      offset += page.results.length;
      if (page.results.length < PAGE_SIZE) break;
    }
  })();
}

type BundleInput = {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  userId: string;
  job: ExportJobProjection;
  sourceAppVersion?: string;
  userTimezone?: string;
};

type PortableDocumentRow = {
  object_id: string; capture_id: string; title: string; body_markdown: string; written_at: string | null; privacy_level: string;
  current_revision_id: string; current_version: number; captured_at: string;
};

async function* bundleEntries(input: BundleInput, state: { manifest: ExportManifestV1 | null }) : AsyncGenerator<StreamingZipEntry> {
  const files: ExportFileManifestV1[] = [];
  const counts: Record<string, number> = {};
  const warnings: string[] = [];
  if (input.job.scope.privacyLevels.includes("restricted")) warnings.push("restricted_records_included_after_reauthentication");
  if (!input.job.scope.includeOriginals) warnings.push("attachment_originals_excluded_by_scope");

  function entry(path: string, mediaType: string, source: StreamingZipEntry["source"], records: () => number): StreamingZipEntry {
    return {
      path,
      source,
      onComplete(result) {
        files.push({ path, bytes: result.bytes, mediaType, sha256: result.sha256, records: records() });
      },
    };
  }

  const readme = `# Lighthouse Export Bundle v1\n\nThis archive is readable without Light House.\n\n- Profile: ${input.job.profile}\n- Created: ${input.job.createdAt}\n- Privacy levels: ${input.job.scope.privacyLevels.join(", ")}\n- The ZIP itself is not password-encrypted. Store it in an encrypted device or volume.\n- Verify every payload file with checksums.sha256 before restore.\n`;
  yield entry("README.md", "text/markdown; charset=utf-8", readme, () => 0);

  const documentDescriptor = CANONICAL_TABLES_V1.find((item) => item.table === "v2_documents");
  if (!documentDescriptor) throw new Error("Document export descriptor is missing.");
  const queryScope = input.job.profile === "migration" ? fullFidelityCanonicalScope(input.job.scope) : input.job.scope;
  const documentScope = documentDescriptor.query(input.userId, queryScope);
  let documentOffset = 0;
  while (true) {
    const page = await queryAll<PortableDocumentRow>(input.db, `select d.*,c.captured_at from (${documentScope.sql}) d join v2_capture_bundles c on c.id=d.capture_id and c.user_id=? order by d.object_id limit ? offset ?`, [...documentScope.bindings, input.userId, PAGE_SIZE, documentOffset]);
    if (!page.results.length) break;
    for (const document of page.results) {
      const typeRows = await input.db.prepare(`select t.key,t.label from v2_object_type_assignments a join v2_type_definitions t on t.id=a.type_definition_id and t.user_id=a.user_id where a.object_id=? and a.user_id=? and a.review_status='accepted' order by a.role,t.key`).bind(document.object_id, input.userId).all<{ key: string; label: string }>();
      const relatedVisibility = input.job.profile === "migration" ? "1=1" : await legacyProjectionVisibilityPredicate(input.db, "eo");
      const relatedRows = await input.db.prepare(`select e.object_id,e.entity_kind,e.canonical_name from v2_relation_edges r join v2_entity_records e on e.object_id=case when r.subject_object_id=? then r.object_object_id else r.subject_object_id end join v2_objects eo on eo.id=e.object_id and eo.user_id=r.user_id where r.user_id=? and (r.subject_object_id=? or r.object_object_id=?) and r.review_status='accepted' and ${relatedVisibility} order by e.canonical_name`).bind(document.object_id, input.userId, document.object_id, document.object_id).all<{ object_id: string; entity_kind: string; canonical_name: string }>();
      const frontmatter = [
        "---",
        `lighthouse_id: ${yamlString(document.object_id)}`,
        `title: ${yamlString(document.title)}`,
        `written_at: ${yamlString(document.written_at ?? document.captured_at)}`,
        `privacy_level: ${yamlString(document.privacy_level)}`,
        "types:",
        ...(typeRows.results.length ? typeRows.results.map((type) => `  - ${yamlString(type.key)}`) : ["  []"]),
        "related_objects:",
        ...(relatedRows.results.length ? relatedRows.results.flatMap((related) => [`  - id: ${yamlString(related.object_id)}`, `    kind: ${yamlString(related.entity_kind)}`, `    label: ${yamlString(related.canonical_name)}`]) : ["  []"]),
        "---",
        "",
      ].join("\n");
      const markdown = `${frontmatter}${document.body_markdown}${document.body_markdown.endsWith("\n") ? "" : "\n"}`;
      yield entry(`documents/${document.object_id}/index.md`, "text/markdown; charset=utf-8", markdown, () => 1);
      const metadata = canonicalJson({ schema_version: LIGHTHOUSE_SCHEMA_VERSION, user_scope_export_id: input.job.id, ...document, types: typeRows.results, related_objects: relatedRows.results }) + "\n";
      yield entry(`documents/${document.object_id}/metadata.json`, "application/json", metadata, () => 1);
      counts.documents = (counts.documents ?? 0) + 1;
    }
    documentOffset += page.results.length;
    if (page.results.length < PAGE_SIZE) break;
  }

  const attachmentDescriptor = CANONICAL_TABLES_V1.find((item) => item.table === "v2_attachment_reservations");
  if (input.job.profile === "migration") {
    for (const descriptor of CANONICAL_TABLES_V1) {
      const count = { value: 0 };
      const scopedJob = { ...input.job, userId: input.userId } as ExportJobProjection & { userId: string };
      yield entry(descriptor.path, "application/x-ndjson; charset=utf-8", jsonlSource(input.db, descriptor, scopedJob, count), () => count.value);
      counts[descriptor.table] = count.value;
    }
  } else if (attachmentDescriptor) {
    const count = { value: 0 };
    const scopedJob = { ...input.job, userId: input.userId } as ExportJobProjection & { userId: string };
    yield entry(attachmentDescriptor.path, "application/x-ndjson; charset=utf-8", jsonlSource(input.db, attachmentDescriptor, scopedJob, count), () => count.value);
    counts.attachments = count.value;
  }

  if (input.job.scope.includeOriginals && attachmentDescriptor) {
    const attachmentScope = input.job.profile === "migration" ? fullFidelityCanonicalScope(input.job.scope) : input.job.scope;
    const scope = attachmentDescriptor.query(input.userId, attachmentScope);
    let offset = 0;
    while (true) {
      const page = await queryAll<{ id: string; object_key: string; filename: string; status: string; sha256: string; size_bytes: number }>(input.db, `select * from (${scope.sql}) a where status='committed' order by id limit ? offset ?`, [...scope.bindings, PAGE_SIZE, offset]);
      if (!page.results.length) break;
      for (const attachment of page.results) {
        const object = await input.bucket.get(attachment.object_key);
        if (!object) throw new Error(`attachment_original_missing:${attachment.id}`);
        const path = `attachments/originals/${attachment.id}/${safeFilename(attachment.filename)}`;
        const mediaType = object.httpMetadata?.contentType ?? "application/octet-stream";
        yield { path, source: object.body, onComplete(result) {
          if (result.bytes !== attachment.size_bytes || result.sha256 !== attachment.sha256.replace(/^sha256:/, "")) throw new Error(`attachment_original_checksum_mismatch:${attachment.id}`);
          files.push({ path, bytes: result.bytes, mediaType, sha256: result.sha256, records: 1 });
        } };
        counts.attachment_originals = (counts.attachment_originals ?? 0) + 1;
      }
      offset += page.results.length;
      if (page.results.length < PAGE_SIZE) break;
    }
  }

  await assertPromptCurationExportScope(input.db, input.userId, queryScope);
  const checksumText = files.slice().sort((left, right) => left.path.localeCompare(right.path)).map((file) => `${file.sha256}  ${file.path}`).join("\n") + "\n";
  yield { path: "checksums.sha256", source: checksumText };
  const manifest: ExportManifestV1 = {
    format: LIGHTHOUSE_EXPORT_FORMAT,
    version: LIGHTHOUSE_EXPORT_VERSION,
    profile: input.job.profile,
    exportId: input.job.id,
    createdAt: input.job.createdAt,
    sourceAppVersion: input.sourceAppVersion ?? "0.1.0",
    schemaVersion: LIGHTHOUSE_SCHEMA_VERSION,
    userTimezone: input.userTimezone ?? "Asia/Seoul",
    scope: input.job.scope,
    counts,
    files,
    rootHash: exportRootHash(files),
    baseSequence: input.job.baseSequence,
    endSequence: input.job.endSequence,
    warnings,
  };
  state.manifest = manifest;
  yield { path: "manifest.json", source: `${canonicalJson(manifest)}\n` };
}

export async function writeExportBundle(input: BundleInput) {
  await assertPromptCurationExportScope(input.db, input.userId, input.job.profile === "migration" ? fullFidelityCanonicalScope(input.job.scope) : input.job.scope);
  const state: { manifest: ExportManifestV1 | null } = { manifest: null };
  const zipHash = createHash("sha256");
  let zipBytes = 0;
  const measured = createStoredZipStream(bundleEntries(input, state)).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      zipHash.update(chunk);
      zipBytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
  }));
  const userNamespace = sha256Hex(input.userId).slice(0, 24);
  const objectKey = `users/${userNamespace}/exports/${input.job.id}/lighthouse-export.zip`;
  if (!input.bucket.createMultipartUpload) throw new Error("export_multipart_unavailable");
  const upload = await input.bucket.createMultipartUpload(objectKey, {
    httpMetadata: { contentType: "application/zip" },
    customMetadata: { ownerHash: userNamespace, exportId: input.job.id, profile: input.job.profile },
  });
  const uploadedParts: { partNumber: number; etag: string }[] = [];
  const reader = measured.getReader();
  let pending = new Uint8Array(MULTIPART_BYTES);
  let pendingBytes = 0;
  let partNumber = 1;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      let offset = 0;
      while (offset < item.value.byteLength) {
        const copied = Math.min(pending.byteLength - pendingBytes, item.value.byteLength - offset);
        pending.set(item.value.subarray(offset, offset + copied), pendingBytes);
        pendingBytes += copied;
        offset += copied;
        if (pendingBytes === pending.byteLength) {
          uploadedParts.push(await upload.uploadPart(partNumber, pending));
          partNumber += 1;
          pending = new Uint8Array(MULTIPART_BYTES);
          pendingBytes = 0;
        }
      }
    }
    if (pendingBytes || !uploadedParts.length) uploadedParts.push(await upload.uploadPart(partNumber, pending.subarray(0, pendingBytes)));
    await upload.complete(uploadedParts);
  } catch (error) {
    await upload.abort().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!state.manifest) throw new Error("Export stream completed without a manifest.");
  return { objectKey, bytes: zipBytes, sha256: zipHash.digest("hex"), manifest: state.manifest };
}
