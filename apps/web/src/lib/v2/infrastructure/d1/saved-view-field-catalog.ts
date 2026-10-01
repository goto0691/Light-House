import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { validateSavedViewFieldLookupKeys, type SavedViewFieldLabel } from "@/lib/v2/retrieval/saved-view-field-lookup";

/** Preserve caller order, read only registry metadata, and do not expose retired definitions. */
export async function savedViewSelectedFieldLabels(db: D1DatabaseBinding, userId: string, input: readonly string[]) {
  const keys = validateSavedViewFieldLookupKeys(input);
  const rows = await db.prepare(`
    select fields.key,fields.label from json_each(?2) requested
    join v2_field_definitions fields on fields.key=requested.value and fields.user_id=?1
    where fields.status in ('active','observed') order by cast(requested.key as integer)
  `).bind(userId, JSON.stringify(keys)).all<SavedViewFieldLabel>();
  return { fields: rows.results ?? [] };
}

/** Owner registry metadata only: no record values, counts or private record links. */
export async function savedViewFieldCatalog(db: D1DatabaseBinding, userId: string, query: string, requestedPage: number) {
  const row = await db.prepare(`
    with fields as materialized (
      select key,label from v2_field_definitions where user_id=?1 and status in ('active','observed')
      and (instr(lower(key),lower(?2))>0 or instr(lower(label),lower(?2))>0)
    ), summary as (select count(*) as total_count from fields),
    paging as (select total_count,max(1,(total_count+19)/20) as total_pages,min(?3,max(1,(total_count+19)/20)) as page from summary)
    select total_count,total_pages,page,coalesce((select json_group_array(json_object('key',key,'label',label)) from
      (select key,label from fields order by key limit 20 offset (select (page-1)*20 from paging))), '[]') as fields_json from paging
  `).bind(userId, query, requestedPage).first<{ total_count: number; total_pages: number; page: number; fields_json: string }>();
  if (!row) throw new Error("Saved view field catalog could not be read.");
  return { fields: JSON.parse(row.fields_json) as { key: string; label: string }[], page: row.page, pageSize: 20, totalPages: row.total_pages, totalCount: row.total_count };
}
