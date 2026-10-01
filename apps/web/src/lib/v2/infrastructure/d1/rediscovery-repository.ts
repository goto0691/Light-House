import { ulid } from "ulidx";

import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { suggestSemanticIconForType } from "@/lib/v2/presentation/semantic-icons";

export type RediscoveryPreference = Readonly<{ enabled: boolean; includeSensitive: boolean; enabledAt: string | null }>;
export type RediscoveryCard = Readonly<{
  recordId: string;
  title: string;
  snippet: string | null;
  privacyLevel: "normal" | "sensitive";
  capturedAt: string;
  typeLabel: string;
  iconKey: string;
}>;

export class RediscoveryRepositoryError extends Error {
  constructor(readonly code: "rediscovery_disabled" | "rediscovery_event_invalid", message: string) { super(message); this.name = "RediscoveryRepositoryError"; }
}

export class D1RediscoveryRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {}

  async getPreference(): Promise<RediscoveryPreference> {
    const row = await this.db.prepare(`select enabled,include_sensitive,enabled_at from v2_rediscovery_preferences where user_id=? limit 1`).bind(this.userId).first<{ enabled: number; include_sensitive: number; enabled_at: string | null }>();
    return { enabled: Boolean(row?.enabled), includeSensitive: Boolean(row?.include_sensitive), enabledAt: row?.enabled_at ?? null };
  }

  async updatePreference(input: { enabled: boolean; includeSensitive: boolean }, now = new Date().toISOString()) {
    const includeSensitive = input.enabled && input.includeSensitive;
    await this.db.prepare(
      `insert into v2_rediscovery_preferences (user_id,enabled,include_sensitive,enabled_at,updated_at) values (?,?,?,?,?)
       on conflict(user_id) do update set enabled=excluded.enabled,include_sensitive=excluded.include_sensitive,enabled_at=case when excluded.enabled=1 then coalesce(v2_rediscovery_preferences.enabled_at,excluded.enabled_at) else null end,updated_at=excluded.updated_at`,
    ).bind(this.userId, input.enabled ? 1 : 0, includeSensitive ? 1 : 0, input.enabled ? now : null, now).run();
    return this.getPreference();
  }

  async deck(now = new Date(), limit = 5): Promise<RediscoveryCard[]> {
    const preference = await this.getPreference();
    if (!preference.enabled) return [];
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const before = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const rows = await this.db.prepare(
      `select d.object_id,d.title,d.body_markdown,d.privacy_level,c.captured_at,
         (select t.key from v2_object_type_assignments a join v2_type_definitions t on t.id=a.type_definition_id and t.user_id=a.user_id where a.object_id=d.object_id and a.user_id=o.user_id and a.review_status not in ('rejected','superseded') order by case a.review_status when 'accepted' then 0 else 1 end limit 1) as type_key,
         (select t.label from v2_object_type_assignments a join v2_type_definitions t on t.id=a.type_definition_id and t.user_id=a.user_id where a.object_id=d.object_id and a.user_id=o.user_id and a.review_status not in ('rejected','superseded') order by case a.review_status when 'accepted' then 0 else 1 end limit 1) as type_label
       from v2_documents d join v2_objects o on o.id=d.object_id join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
       where o.user_id=? and o.lifecycle_status='active' and ${legacyVisibility} and c.captured_at<=? and d.privacy_level<>'restricted'
         and (d.privacy_level='normal' or ?=1)
         and not exists (select 1 from v2_rediscovery_events e where e.user_id=o.user_id and e.record_id=d.object_id and e.created_at>=? and e.event_kind in ('shown','dismissed'))
       order by c.captured_at asc,d.object_id limit ?`,
    ).bind(this.userId, before, preference.includeSensitive ? 1 : 0, recent, Math.min(10, Math.max(1, Math.trunc(limit)))).all<{ object_id: string; title: string; body_markdown: string; privacy_level: "normal" | "sensitive"; captured_at: string; type_key: string | null; type_label: string | null }>();
    return rows.results.map((row) => ({ recordId: row.object_id, title: row.title, snippet: row.privacy_level === "normal" ? row.body_markdown.slice(0, 280) : null, privacyLevel: row.privacy_level, capturedAt: row.captured_at, typeLabel: row.type_label ?? "기록", iconKey: suggestSemanticIconForType(row.type_key) }));
  }

  async recordEvent(recordId: string, eventKind: "shown" | "opened" | "dismissed", now = new Date().toISOString()) {
    const preference = await this.getPreference();
    if (!preference.enabled) throw new RediscoveryRepositoryError("rediscovery_disabled", "Rediscovery is not enabled.");
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const result = await this.db.prepare(
      `insert into v2_rediscovery_events (id,user_id,record_id,event_kind,created_at)
       select ?,?,?,?,? where exists (
         select 1 from v2_documents d join v2_objects o on o.id=d.object_id
         where d.object_id=? and o.user_id=? and o.lifecycle_status='active' and ${legacyVisibility}
           and d.privacy_level<>'restricted' and (d.privacy_level='normal' or ?=1)
       )`,
    ).bind(ulid(), this.userId, recordId, eventKind, now, recordId, this.userId, preference.includeSensitive ? 1 : 0).run() as unknown as { meta?: { changes?: number } };
    if (!result.meta?.changes) throw new RediscoveryRepositoryError("rediscovery_event_invalid", "The rediscovery record is not eligible.");
  }
}
