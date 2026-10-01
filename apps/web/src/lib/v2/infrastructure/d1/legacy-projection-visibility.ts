import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

type V2ObjectAlias = "o" | "eo" | "subject" | "target" | "evidence_owner";

const mappingTableChecks = new WeakMap<D1DatabaseBinding, Promise<boolean>>();

export async function hasLegacyProjectionBoundary(db: D1DatabaseBinding) {
  let check = mappingTableChecks.get(db);
  if (!check) {
    check = db
      .prepare("select 1 as present from sqlite_master where type='table' and name='v2_legacy_source_mappings' limit 1")
      .first<{ present: number }>()
      .then(Boolean);
    mappingTableChecks.set(db, check);
  }
  const present = await check;
  // Do not retain a negative result: an additive migration may install the
  // table while the Worker isolate remains warm. Positive schema capability is
  // immutable, so hot production reads stop paying for the probe after once.
  if (!present && mappingTableChecks.get(db) === check) mappingTableChecks.delete(db);
  return present;
}

/**
 * Normal V2 reads may expose an object produced by the legacy importer only
 * after its mapping reaches the projected state. Unknown and future mapping
 * states remain hidden by construction. If several mappings point at the same
 * object, one non-projected mapping is sufficient to hide it (fail closed).
 * Import captures also reserve the `legacy:` draft namespace. That provenance
 * is committed in the same D1 transaction as the object, so a crash between
 * capture commit and mapping attachment cannot expose an orphan as native V2.
 *
 * The schema probe keeps repositories compatible with additive V2 databases
 * that predate the legacy-mapping migration. A missing table cannot contain a
 * linked legacy projection; errors reading an existing table are not caught.
 */
export async function legacyProjectionVisibilityPredicate(
  db: D1DatabaseBinding,
  objectAlias: V2ObjectAlias = "o",
) {
  if (!(await hasLegacyProjectionBoundary(db))) return "1=1";
  return `not exists (
    select 1 from v2_legacy_source_mappings legacy_visibility
    where legacy_visibility.user_id=${objectAlias}.user_id
      and legacy_visibility.projected_object_id=${objectAlias}.id
      and legacy_visibility.status is not 'projected'
  ) and (
    not exists (
      select 1
      from v2_documents legacy_document
      join v2_capture_bundles legacy_capture on legacy_capture.id=legacy_document.capture_id
      where legacy_document.object_id=${objectAlias}.id
        and legacy_capture.draft_id like 'legacy:%'
    )
    or exists (
      select 1 from v2_legacy_source_mappings legacy_projection
      where legacy_projection.user_id=${objectAlias}.user_id
        and legacy_projection.projected_object_id=${objectAlias}.id
        and legacy_projection.status='projected'
    )
  )`;
}
