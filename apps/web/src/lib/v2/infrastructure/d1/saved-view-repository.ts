import { ulid } from "ulidx";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { isAllowedSemanticIcon } from "@/lib/v2/presentation/semantic-icons";
import { V2SavedViewValidationError, validateSavedViewDefinition, validateSavedViewDisplay } from "@/lib/v2/retrieval/saved-view-contract";
import { validateV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { captureSavedViewCatalogRequest, validateSavedViewCatalogPage, type SavedViewCatalogRequest, type SavedViewSummary } from "@/lib/v2/retrieval/saved-view-catalog";

type SavedViewRow = { id: string; view_key: string; name: string; description: string | null; icon_key: string; query_plan_json: string; display_json: string; source: string; pinned: number; pin_order: number | null; created_at: string; updated_at: string };

const columns = "id,view_key,name,description,icon_key,query_plan_json,display_json,source,pinned,pin_order,created_at,updated_at";
// A content CAS token, not a monotonic version or historical mutation receipt.
function displayRevision(raw: string) { return bytesToHex(sha256(new TextEncoder().encode(raw))); }

function project(row: SavedViewRow) {
  return {
    id: row.id, viewKey: row.view_key, name: row.name, description: row.description,
    iconKey: isAllowedSemanticIcon(row.icon_key, "saved_view") ? row.icon_key : "type.collection",
    queryPlan: validateV2QueryPlan(JSON.parse(row.query_plan_json)), display: validateSavedViewDisplay(JSON.parse(row.display_json)),
    displayRevision: displayRevision(row.display_json),
    source: row.source, pinned: Boolean(row.pinned), pinOrder: row.pin_order, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export class D1SavedViewRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {}

  async create(candidate: unknown, now = new Date().toISOString()) {
    const definition = validateSavedViewDefinition(candidate);
    const id = ulid();
    const viewKey = `view_${id.toLowerCase()}`;
    const iconKey = isAllowedSemanticIcon(definition.iconKey, "saved_view") ? definition.iconKey : "type.collection";
    await this.db.prepare(
      `insert into v2_saved_views (id,user_id,view_key,name,description,icon_key,query_plan_json,display_json,source,status,pinned,pin_order,created_at,updated_at)
       values (?,?,?,?,?,?,?,?,'user_created','active',0,null,?,?)`,
    ).bind(id, this.userId, viewKey, definition.name, definition.description, iconKey, JSON.stringify(definition.queryPlan), JSON.stringify(definition.display), now, now).run();
    return this.get(id);
  }

  async list(options: { pinnedOnly?: boolean } = {}) {
    if (options.pinnedOnly) {
      const rows = await this.db.prepare(`select id,name,description,icon_key,pinned,pin_order from v2_saved_views
        where user_id=? and status='active' and pinned=1 order by coalesce(pin_order,999),updated_at desc,id limit 5`)
        .bind(this.userId).all<Pick<SavedViewRow, "id" | "name" | "description" | "icon_key" | "pinned" | "pin_order">>();
      return rows.results.map((row): SavedViewSummary => ({ id: row.id, name: row.name, description: row.description,
        iconKey: isAllowedSemanticIcon(row.icon_key, "saved_view") ? row.icon_key : "type.collection", pinned: Boolean(row.pinned), pinOrder: row.pin_order }));
    }
    const rows = await this.db.prepare(
      `select id,view_key,name,description,icon_key,query_plan_json,display_json,source,pinned,pin_order,created_at,updated_at
       from v2_saved_views where user_id=? and status='active' ${options.pinnedOnly ? "and pinned=1" : ""}
       order by pinned desc,coalesce(pin_order,999),updated_at desc,id`,
    ).bind(this.userId).all<SavedViewRow>();
    return rows.results.map(project);
  }

  /** Summary count and page share a single owner/active SQL snapshot; never read query/display blobs. */
  async listPage(candidate: SavedViewCatalogRequest) {
    const request = captureSavedViewCatalogRequest(candidate);
    const row = await this.db.prepare(`with views as materialized (
      select id,name,description,icon_key,pinned,pin_order,updated_at from v2_saved_views
      where user_id=?1 and status='active' and (?2=0 or pinned=1) and instr(lower(name),lower(?3))>0
    ), summary as (select count(*) as total_count from views),
    paging as (select total_count,max(1,(total_count+19)/20) as total_pages,min(?4,max(1,(total_count+19)/20)) as page from summary)
    select total_count,total_pages,page,coalesce((select json_group_array(json_object('id',id,'name',name,'description',description,'iconKey',icon_key,
      'pinned',json(case when pinned=1 then 'true' else 'false' end),'pinOrder',pin_order)) from
      (select * from views order by pinned desc,coalesce(pin_order,999),updated_at desc,id limit 20 offset (select (page-1)*20 from paging))),'[]') as views_json from paging`)
      .bind(this.userId, request.pinnedOnly ? 1 : 0, request.query, request.page)
      .first<{ total_count: number; total_pages: number; page: number; views_json: string }>();
    if (!row) throw new Error("The saved-view catalog could not be read.");
    const views = (JSON.parse(row.views_json) as SavedViewSummary[]).map((view) => ({ ...view, iconKey: isAllowedSemanticIcon(view.iconKey, "saved_view") ? view.iconKey : "type.collection" }));
    return validateSavedViewCatalogPage({ contract: "saved-view-catalog.v1", query: request.query, pinnedOnly: request.pinnedOnly, page: row.page,
      pageSize: 20, totalCount: row.total_count, totalPages: row.total_pages, views }, request);
  }

  async get(id: string) {
    const row = await this.db.prepare(
      `select id,view_key,name,description,icon_key,query_plan_json,display_json,source,pinned,pin_order,created_at,updated_at from v2_saved_views where id=? and user_id=? and status='active' limit 1`,
    ).bind(id, this.userId).first<SavedViewRow>();
    return row ? project(row) : null;
  }

  async setPinned(id: string, pinned: boolean, now = new Date().toISOString()) {
    if (!pinned) {
      await this.db.prepare(`update v2_saved_views set pinned=0,pin_order=null,updated_at=? where id=? and user_id=? and status='active'`).bind(now, id, this.userId).run();
      return this.get(id);
    }
    const result = await this.db.prepare(
      `update v2_saved_views set pinned=1,
         pin_order=coalesce((select max(pin_order)+1 from v2_saved_views where user_id=? and status='active' and pinned=1),0),updated_at=?
       where id=? and user_id=? and status='active' and (pinned=1 or (select count(*) from v2_saved_views where user_id=? and status='active' and pinned=1)<5)`,
    ).bind(this.userId, now, id, this.userId, this.userId).run() as { meta?: { changes?: number } };
    if (!result.meta?.changes) {
      const existing = await this.get(id);
      if (!existing) return null;
      if (!existing.pinned) throw new V2SavedViewValidationError("saved_view_pin_limit", "You can pin up to five saved views.");
    }
    return this.get(id);
  }

  async setDisplay(id: string, candidate: unknown, expectedRevision: unknown, now = new Date().toISOString()) {
    const display = validateSavedViewDisplay(candidate);
    if (typeof expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(expectedRevision)) {
      throw new V2SavedViewValidationError("saved_view_invalid", "The saved view display revision is invalid.");
    }
    const current = await this.db.prepare(`select ${columns} from v2_saved_views where id=? and user_id=? and status='active'`)
      .bind(id, this.userId).first<SavedViewRow>();
    if (!current) return null;
    const desired = JSON.stringify(display);
    // Response-loss retry: no write, timestamp change or claim of an old receipt.
    if (JSON.stringify(validateSavedViewDisplay(JSON.parse(current.display_json))) === desired) return project(current);
    if (displayRevision(current.display_json) !== expectedRevision) {
      throw new V2SavedViewValidationError("saved_view_display_conflict", "The display settings changed. Reload the latest settings before applying your changes.");
    }
    const updated = await this.db.prepare(
      `update v2_saved_views set display_json=?,updated_at=? where id=? and user_id=? and status='active' and display_json=? returning ${columns}`,
    ).bind(desired, now, id, this.userId, current.display_json).first<SavedViewRow>();
    if (updated) return project(updated);
    const latest = await this.get(id);
    if (!latest) return null;
    if (JSON.stringify(latest.display) === desired) return latest;
    throw new V2SavedViewValidationError("saved_view_display_conflict", "The display settings changed. Reload the latest settings before applying your changes.");
  }

  async archive(id: string, now = new Date().toISOString()) {
    await this.db.prepare(`update v2_saved_views set status='archived',pinned=0,pin_order=null,updated_at=? where id=? and user_id=? and status='active'`).bind(now, id, this.userId).run();
  }
}
