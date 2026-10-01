import { V2HttpError } from "@/lib/v2/http/request-policy";
import { recordLocationTextHash } from "@/lib/v2/retrieval/record-location-v1";
import { materializeSavedViewFieldValue, type SavedViewFieldValueRow } from "@/lib/v2/retrieval/saved-view-fields";
import { SAVED_FIELD_MAX_STORED_BYTES, SAVED_FIELD_PAGE_CONTRACT, savedFieldTextEnd, type SavedFieldPage } from "@/lib/v2/retrieval/saved-field-page";
import { legacyProjectionVisibilityPredicate } from "./legacy-projection-visibility";
import type { D1DatabaseBinding } from "./source-commit-repository";

export type SavedFieldReadRequest = Readonly<{ fieldKey: string; offset: number; revision: string | null; full: boolean }>;
export function parseSavedFieldRead(query: URLSearchParams): SavedFieldReadRequest {
  const allowed = new Set(["fieldKey", "offset", "revision", "format"]);
  const fieldKey = query.get("fieldKey") ?? "", rawOffset = query.get("offset") ?? "0", revision = query.get("revision"), format = query.get("format");
  if ([...query.keys()].some((key) => !allowed.has(key) || query.getAll(key).length !== 1)
    || !/^[a-z][a-z0-9_.-]{0,99}$/.test(fieldKey) || !/^(0|[1-9]\d{0,7})$/.test(rawOffset)
    || Number(rawOffset) > SAVED_FIELD_MAX_STORED_BYTES || (revision !== null && !/^[a-f0-9]{64}$/.test(revision))
    || (format !== null && format !== "full") || ((Number(rawOffset) > 0 || format === "full") && revision === null)
    || (format === "full" && Number(rawOffset) !== 0))
    throw new V2HttpError(400, "saved_field_request_invalid", "필드 읽기 요청을 확인해 주세요.");
  return Object.freeze({ fieldKey, offset: Number(rawOffset), revision, full: format === "full" });
}

/** Normal-only display field access. A restricted grant does not broaden this surface. */
export async function readSavedFieldPage(db: D1DatabaseBinding, userId: string, recordId: string, propertyId: string,
  request: SavedFieldReadRequest): Promise<SavedFieldPage> {
  if ([recordId, propertyId].some((id) => typeof id !== "string" || !id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id)))
    throw new V2HttpError(400, "saved_field_request_invalid", "필드 대상을 확인해 주세요.");
  // Capture primitive query values before the capability probe can yield.
  const { fieldKey, offset, revision: expectedRevision, full } = parseSavedFieldRead(new URLSearchParams({
    fieldKey: request.fieldKey, offset: String(request.offset), ...(request.revision !== null ? { revision: request.revision } : {}), ...(request.full ? { format: "full" } : {}),
  }));
  const legacy = await legacyProjectionVisibilityPredicate(db);
  const row = await db.prepare(`select v.id as propertyId,v.value_kind as valueKind,
      case when length(cast(v.value_json as blob))<=? then v.value_json end as valueJson,
      length(cast(v.value_json as blob)) as storedBytes,v.unit_key as unit,v.source_class as sourceClass,v.locked_by_user as lockedByUser
    from v2_objects o join v2_documents d on d.object_id=o.id
      join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
      join v2_document_revisions current on current.id=d.current_revision_id and current.document_object_id=d.object_id
      join v2_property_values v on v.owner_object_id=o.id and v.user_id=o.user_id
      join v2_field_definitions f on f.id=v.field_definition_id and f.user_id=v.user_id
    where o.id=? and o.user_id=? and o.lifecycle_status='active' and ${legacy} and d.privacy_level='normal'
      and v.id=? and f.key=? and v.review_status='accepted' and v.superseded_at is null
      and (v.locked_by_user=1 or not exists(select 1 from v2_property_values higher
        where higher.owner_object_id=v.owner_object_id and higher.user_id=v.user_id and higher.field_definition_id=v.field_definition_id
          and higher.review_status='accepted' and higher.superseded_at is null and higher.locked_by_user=1))`)
    .bind(SAVED_FIELD_MAX_STORED_BYTES, recordId, userId, propertyId, fieldKey).first<SavedViewFieldValueRow & { storedBytes: number }>();
  // This is the final await: permission, exact current property and bytes are one snapshot.
  if (!row) throw new V2HttpError(404, "record_not_found", "현재 접근 가능한 확정 필드를 찾지 못했습니다.");
  if (row.storedBytes > SAVED_FIELD_MAX_STORED_BYTES) throw new V2HttpError(413, "saved_field_too_large", "이 필드는 단일 읽기 예산을 초과합니다. 저장된 원값은 보존됩니다.");
  const value = materializeSavedViewFieldValue(row);
  if (!value || value.preview || row.valueJson === null) throw new V2HttpError(409, "saved_field_value_conflict", "저장된 필드 형식을 확인해야 합니다.");
  const revision = recordLocationTextHash(JSON.stringify([recordId, propertyId, fieldKey, row.valueJson, row.valueKind, row.unit, row.sourceClass, row.lockedByUser]));
  if (expectedRevision !== null && expectedRevision !== revision) throw new V2HttpError(409, "saved_field_value_conflict", "필드가 변경되었습니다. 현재 값을 다시 열어 주세요.");
  const text = value.value === null ? "null" : String(value.value);
  if (offset > text.length || (offset > 0 && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset] ?? "")))
    throw new V2HttpError(400, "saved_field_request_invalid", "필드 읽기 위치가 올바르지 않습니다.");
  const end = full ? text.length : savedFieldTextEnd(text, offset);
  return { contract: SAVED_FIELD_PAGE_CONTRACT, recordId, propertyId, fieldKey, privacyLevel: "normal", revision,
    renderer: value.renderer, sourceLabel: value.sourceLabel, lockedByUser: value.lockedByUser, unit: value.unit,
    totalUtf16: text.length, offset, end, nextOffset: end < text.length ? end : null, text: text.slice(offset, end), totalStoredBytes: row.storedBytes };
}
