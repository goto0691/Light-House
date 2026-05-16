import "server-only";

import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";
import { resolveCurrentUser, updateCurrentUserPreferences } from "@/lib/server/session-user";

type JsonRecord = Record<string, unknown>;

type SavedViewRow = {
  id: string;
  domain: string;
  scope: string;
  name: string;
  icon: string | null;
  searchQuery: string | null;
  filterState: string | null;
  sortState: string | null;
  viewKey: string | null;
  isDefault: number | boolean | null;
  displayOrder: number | null;
};

type WidgetLayoutRow = {
  id: string;
  pageKey: string;
  widgetKey: string;
  titleOverride: string | null;
  layout: string;
  isHidden: number | boolean | null;
  displayOrder: number | null;
};

type ShortcutBindingRow = {
  id: string;
  category: string;
  actionKey: string;
  label: string;
  binding: string;
  isEnabled: number | boolean | null;
  isCustom: number | boolean | null;
  displayOrder: number | null;
};

export type SavedView = {
  id: string;
  domain: string;
  scope: string;
  name: string;
  icon: string | null;
  searchQuery: string;
  filterState: JsonRecord;
  sortState: JsonRecord;
  viewKey: string | null;
  isDefault: boolean;
  displayOrder: number;
};

export type WidgetLayout = {
  id: string;
  pageKey: string;
  widgetKey: string;
  titleOverride: string | null;
  layout: JsonRecord;
  isHidden: boolean;
  displayOrder: number;
};

export type ShortcutBinding = {
  id: string;
  category: string;
  actionKey: string;
  label: string;
  binding: string;
  isEnabled: boolean;
  isCustom: boolean;
  displayOrder: number;
};

type WidgetLayoutInput = {
  widgetKey: string;
  titleOverride?: string | null;
  layout: JsonRecord;
  isHidden?: boolean;
  displayOrder?: number;
};

type ShortcutBindingInput = {
  category: string;
  actionKey: string;
  label: string;
  binding: string;
  isEnabled?: boolean;
  isCustom?: boolean;
  displayOrder?: number;
};

type SavedViewInput = {
  domain: string;
  scope: string;
  name: string;
  icon?: string | null;
  searchQuery?: string;
  filterState?: JsonRecord;
  sortState?: JsonRecord;
  viewKey?: string | null;
  isDefault?: boolean;
  displayOrder?: number;
};

export const DEFAULT_SHORTCUT_BINDINGS: ShortcutBindingInput[] = [
  { category: "global", actionKey: "command_palette", label: "빠른 실행", binding: "Cmd+K", displayOrder: 0 },
  { category: "global", actionKey: "quick_capture", label: "빠른 캡처", binding: "Cmd+Shift+N", displayOrder: 1 },
  { category: "shell", actionKey: "toggle_lnb", label: "왼쪽 메뉴 접기/펼치기", binding: "Cmd+\\", displayOrder: 2 },
  { category: "shell", actionKey: "hotkey_cheatsheet", label: "단축키 도움말", binding: "?", displayOrder: 3 },
  { category: "navigation", actionKey: "go_dashboard", label: "오늘 보기로 이동", binding: "g d", displayOrder: 4 },
  { category: "navigation", actionKey: "go_action_hub", label: "작업실로 이동", binding: "g a", displayOrder: 5 },
  { category: "navigation", actionKey: "go_vault", label: "지식금고로 이동", binding: "g v", displayOrder: 6 },
  { category: "navigation", actionKey: "go_prm", label: "관계로 이동", binding: "g p", displayOrder: 7 },
  { category: "navigation", actionKey: "go_life_ops", label: "생활기록으로 이동", binding: "g l", displayOrder: 8 },
  { category: "navigation", actionKey: "go_settings", label: "설정으로 이동", binding: "g s", displayOrder: 9 },
];

export const DEFAULT_DASHBOARD_LAYOUTS: WidgetLayoutInput[] = [
  { widgetKey: "todays-anchor", layout: { colSpan: 4, rowSpan: 2 }, displayOrder: 0 },
  { widgetKey: "active-tasks", layout: { colSpan: 4, rowSpan: 2 }, displayOrder: 1 },
  { widgetKey: "hit-them-up", layout: { colSpan: 4, rowSpan: 2 }, displayOrder: 2 },
  { widgetKey: "brain-energy", layout: { colSpan: 3, rowSpan: 1 }, displayOrder: 3 },
  { widgetKey: "recent-zettels", layout: { colSpan: 5, rowSpan: 2 }, displayOrder: 4 },
  { widgetKey: "streak-heatmap", layout: { colSpan: 4, rowSpan: 2 }, displayOrder: 5 },
  { widgetKey: "birthdays", layout: { colSpan: 3, rowSpan: 1 }, displayOrder: 6 },
  { widgetKey: "quote-of-day", layout: { colSpan: 4, rowSpan: 1 }, displayOrder: 7 },
];

export const DEFAULT_SAVED_VIEWS: SavedViewInput[] = [
  { domain: "library", scope: "knowledge", name: "전체 문서", icon: "library", viewKey: "all", isDefault: true, displayOrder: 0 },
  { domain: "library", scope: "knowledge", name: "설교", icon: "book-open", filterState: { documentKind: ["sermon", "sermon_note"] }, viewKey: "sermons", displayOrder: 1 },
  { domain: "library", scope: "knowledge", name: "성경 공부", icon: "sparkles", filterState: { documentKind: ["bible_study", "meditation"] }, viewKey: "bible-study", displayOrder: 2 },
  { domain: "library", scope: "knowledge", name: "에세이", icon: "file-text", filterState: { documentKind: ["essay", "reflection"] }, viewKey: "essays", displayOrder: 3 },
  { domain: "library", scope: "knowledge", name: "프롬프트", icon: "terminal", filterState: { documentKind: ["prompt"] }, viewKey: "prompts", displayOrder: 4 },
  { domain: "library", scope: "knowledge", name: "소설 아이디어", icon: "wand", filterState: { documentKind: ["fiction", "story_idea"] }, viewKey: "fiction-ideas", displayOrder: 5 },
  { domain: "library", scope: "knowledge", name: "검토 필요", icon: "alert-circle", filterState: { status: ["needs_review"] }, viewKey: "needs-review", displayOrder: 6 },

  { domain: "daily", scope: "entries", name: "캘린더", icon: "calendar", viewKey: "calendar", isDefault: true, displayOrder: 0 },
  { domain: "daily", scope: "entries", name: "일기", icon: "notebook", filterState: { kind: ["journal"] }, viewKey: "journal", displayOrder: 1 },
  { domain: "daily", scope: "entries", name: "묵상", icon: "sun", filterState: { kind: ["meditation"] }, viewKey: "meditation", displayOrder: 2 },
  { domain: "daily", scope: "entries", name: "설교 노트", icon: "book-open", filterState: { kind: ["sermon_note"] }, viewKey: "sermon-notes", displayOrder: 3 },
  { domain: "daily", scope: "entries", name: "감정 타임라인", icon: "activity", sortState: { field: "date", direction: "desc", groupBy: "emotion" }, viewKey: "emotion-timeline", displayOrder: 4 },
  { domain: "daily", scope: "entries", name: "사람 언급", icon: "users", sortState: { field: "person", direction: "asc" }, viewKey: "people-mentions", displayOrder: 5 },
  { domain: "daily", scope: "entries", name: "운동 기록", icon: "dumbbell", filterState: { kind: ["workout"] }, viewKey: "workouts", displayOrder: 6 },

  { domain: "media", scope: "items", name: "전체 미디어", icon: "clapperboard", viewKey: "all", isDefault: true, displayOrder: 0 },
  { domain: "media", scope: "items", name: "게임", icon: "gamepad-2", filterState: { mediaType: "game" }, viewKey: "games", displayOrder: 1 },
  { domain: "media", scope: "items", name: "영상", icon: "monitor-play", filterState: { mediaType: "screen" }, viewKey: "screens", displayOrder: 2 },
  { domain: "media", scope: "items", name: "책", icon: "book", filterState: { mediaType: "book" }, viewKey: "books", displayOrder: 3 },
  { domain: "media", scope: "items", name: "완료", icon: "check-circle", filterState: { status: ["completed"] }, viewKey: "completed", displayOrder: 4 },
  { domain: "media", scope: "items", name: "대기", icon: "inbox", filterState: { status: ["backlog"] }, viewKey: "backlog", displayOrder: 5 },
  { domain: "media", scope: "items", name: "다시 볼 것", icon: "refresh-ccw", filterState: { rewatchValue: true }, viewKey: "rewatch", displayOrder: 6 },

  { domain: "assets", scope: "inventory", name: "전체 자산", icon: "package", viewKey: "all", isDefault: true, displayOrder: 0 },
  { domain: "assets", scope: "inventory", name: "장비", icon: "wrench", filterState: { category: "gear" }, viewKey: "gear", displayOrder: 1 },
  { domain: "assets", scope: "inventory", name: "수집품", icon: "archive", filterState: { category: "collection" }, viewKey: "collection", displayOrder: 2 },
  { domain: "assets", scope: "inventory", name: "상태 확인", icon: "alert-circle", filterState: { condition: ["fair", "repair"] }, viewKey: "condition-review", displayOrder: 3 },

  { domain: "places", scope: "visits", name: "전체 장소", icon: "map-pin", viewKey: "all", isDefault: true, displayOrder: 0 },
  { domain: "places", scope: "visits", name: "식당", icon: "utensils", filterState: { category: "restaurant" }, viewKey: "restaurants", displayOrder: 1 },
  { domain: "places", scope: "visits", name: "카페", icon: "coffee", filterState: { category: "cafe" }, viewKey: "cafes", displayOrder: 2 },
  { domain: "places", scope: "visits", name: "메모 있음", icon: "notebook", filterState: { hasReview: true }, viewKey: "reviewed", displayOrder: 3 },

  { domain: "gifts", scope: "relationships", name: "전체 선물", icon: "gift", viewKey: "all", isDefault: true, displayOrder: 0 },
  { domain: "gifts", scope: "relationships", name: "준 선물", icon: "send", filterState: { direction: ["given"] }, viewKey: "given", displayOrder: 1 },
  { domain: "gifts", scope: "relationships", name: "받은 선물", icon: "inbox", filterState: { direction: ["received"] }, viewKey: "received", displayOrder: 2 },
  { domain: "gifts", scope: "relationships", name: "반응 기록", icon: "sparkles", filterState: { hasSatisfaction: true }, viewKey: "with-reaction", displayOrder: 3 },

  { domain: "people", scope: "relationships", name: "전체", icon: "users", viewKey: "all", isDefault: true, displayOrder: 0 },
  { domain: "people", scope: "relationships", name: "핵심", icon: "heart", filterState: { layer: [5, 15] }, viewKey: "core", displayOrder: 1 },
  { domain: "people", scope: "relationships", name: "활성", icon: "radio", filterState: { status: ["active"] }, viewKey: "active", displayOrder: 2 },
  { domain: "people", scope: "relationships", name: "휴면", icon: "moon", filterState: { status: ["dormant", "observing"] }, viewKey: "dormant", displayOrder: 3 },
  { domain: "people", scope: "relationships", name: "생일", icon: "cake", sortState: { field: "birthday", direction: "asc" }, viewKey: "birthdays", displayOrder: 4 },
  { domain: "people", scope: "relationships", name: "선물 기록", icon: "gift", filterState: { hasGifts: true }, viewKey: "gift-history", displayOrder: 5 },
  { domain: "people", scope: "relationships", name: "일기에 등장", icon: "notebook", filterState: { linkedDailyEntries: true }, viewKey: "appears-in-journals", displayOrder: 6 },

  { domain: "projects", scope: "work", name: "활성", icon: "rocket", filterState: { status: ["active"] }, viewKey: "active", isDefault: true, displayOrder: 0 },
  { domain: "projects", scope: "work", name: "보류", icon: "pause-circle", filterState: { status: ["paused"] }, viewKey: "paused", displayOrder: 1 },
  { domain: "projects", scope: "work", name: "보관", icon: "archive", filterState: { status: ["archived"] }, viewKey: "archived", displayOrder: 2 },

  { domain: "sources", scope: "qa", name: "검토 필요", icon: "alert-circle", filterState: { classificationStatus: ["unmapped"] }, viewKey: "needs-review", isDefault: true, displayOrder: 0 },
  { domain: "sources", scope: "qa", name: "낮은 신뢰도", icon: "gauge", filterState: { confidence: "low" }, viewKey: "low-confidence", displayOrder: 1 },
  { domain: "sources", scope: "qa", name: "보관 작업", icon: "archive", filterState: { documentRole: ["archive_work"] }, viewKey: "archived-work", displayOrder: 2 },
  { domain: "sources", scope: "qa", name: "숨김/노이즈", icon: "eye-off", filterState: { classificationStatus: ["hidden"] }, viewKey: "hidden", displayOrder: 3 },
];

function parseJsonRecord(value: string | null): JsonRecord {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as JsonRecord;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function toBool(value: number | boolean | null | undefined) {
  return value === true || value === 1;
}

function serializeJson(value: JsonRecord | undefined) {
  return JSON.stringify(value ?? {});
}

function defaultSavedViews(input?: { domain?: string; scope?: string }) {
  return DEFAULT_SAVED_VIEWS
    .filter((view) => {
      if (input?.domain && view.domain !== input.domain) return false;
      if (input?.scope && view.scope !== input.scope) return false;
      return true;
    })
    .map((view, index) => ({
      id: `default-${view.domain}-${view.scope}-${view.viewKey ?? index}`,
      domain: view.domain,
      scope: view.scope,
      name: view.name,
      icon: view.icon ?? null,
      searchQuery: view.searchQuery ?? "",
      filterState: view.filterState ?? {},
      sortState: view.sortState ?? {},
      viewKey: view.viewKey ?? null,
      isDefault: view.isDefault ?? false,
      displayOrder: view.displayOrder ?? index,
    })) satisfies SavedView[];
}

export async function listSavedViews(input?: { domain?: string; scope?: string }) {
  const user = await resolveCurrentUser();
  const conditions = [`user_id = ?`, `deleted_at is null`];
  const params: unknown[] = [user.id];

  if (input?.domain) {
    conditions.push(`domain = ?`);
    params.push(input.domain);
  }

  if (input?.scope) {
    conditions.push(`scope = ?`);
    params.push(input.scope);
  }

  const result = await queryD1<SavedViewRow>(
    `select
       id,
       domain,
       scope,
       name,
       icon,
       search_query as searchQuery,
       filter_state as filterState,
       sort_state as sortState,
       view_key as viewKey,
       is_default as isDefault,
       display_order as displayOrder
     from saved_views
     where ${conditions.join(" and ")}
     order by is_default desc, display_order asc, updated_at desc`,
    params,
  );

  const rows = result.rows.map((row) => ({
    id: row.id,
    domain: row.domain,
    scope: row.scope,
    name: row.name,
    icon: row.icon,
    searchQuery: row.searchQuery ?? "",
    filterState: parseJsonRecord(row.filterState),
    sortState: parseJsonRecord(row.sortState),
    viewKey: row.viewKey,
    isDefault: toBool(row.isDefault),
    displayOrder: Number(row.displayOrder ?? 0),
  })) satisfies SavedView[];

  const persistedKeys = new Set(rows.map((row) => `${row.domain}:${row.scope}:${row.viewKey ?? row.name}`));
  const defaults = defaultSavedViews(input).filter((view) => !persistedKeys.has(`${view.domain}:${view.scope}:${view.viewKey ?? view.name}`));

  return [...defaults, ...rows].sort((left, right) => {
    if (left.domain !== right.domain) return left.domain.localeCompare(right.domain);
    if (left.scope !== right.scope) return left.scope.localeCompare(right.scope);
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
    return left.displayOrder - right.displayOrder;
  });
}

export async function createSavedView(input: SavedViewInput) {
  const user = await resolveCurrentUser();

  if (input.isDefault) {
    await executeD1(
      `update saved_views
       set is_default = 0, updated_at = datetime('now')
       where user_id = ? and domain = ? and scope = ? and deleted_at is null`,
      [user.id, input.domain, input.scope],
    );
  }

  await executeD1(
    `insert into saved_views (
       id, user_id, domain, scope, name, icon, search_query, filter_state, sort_state, view_key, is_default, display_order, created_at, updated_at
     ) values (
       lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')
     )`,
    [
      user.id,
      input.domain,
      input.scope,
      input.name.trim(),
      input.icon ?? null,
      input.searchQuery?.trim() ?? "",
      serializeJson(input.filterState),
      serializeJson(input.sortState),
      input.viewKey ?? null,
      input.isDefault ? 1 : 0,
      input.displayOrder ?? 0,
    ],
  );

  return listSavedViews({ domain: input.domain, scope: input.scope });
}

export async function updateSavedView(viewId: string, input: Partial<SavedViewInput>) {
  const user = await resolveCurrentUser();
  const current = await queryD1<SavedViewRow>(
    `select
       id,
       domain,
       scope,
       name,
       icon,
       search_query as searchQuery,
       filter_state as filterState,
       sort_state as sortState,
       view_key as viewKey,
       is_default as isDefault,
       display_order as displayOrder
     from saved_views
     where id = ? and user_id = ? and deleted_at is null
     limit 1`,
    [viewId, user.id],
  );
  const existing = current.rows[0];
  if (!existing) throw new Error("저장된 뷰를 찾지 못했습니다.");

  if (input.isDefault) {
    await executeD1(
      `update saved_views
       set is_default = 0, updated_at = datetime('now')
       where user_id = ? and domain = ? and scope = ? and id <> ? and deleted_at is null`,
      [user.id, existing.domain, existing.scope, viewId],
    );
  }

  await executeD1(
    `update saved_views
     set name = coalesce(?, name),
         icon = ?,
         search_query = ?,
         filter_state = ?,
         sort_state = ?,
         view_key = coalesce(?, view_key),
         is_default = ?,
         display_order = coalesce(?, display_order),
         updated_at = datetime('now')
     where id = ? and user_id = ? and deleted_at is null`,
    [
      input.name?.trim() || existing.name,
      input.icon === undefined ? existing.icon : input.icon,
      input.searchQuery === undefined ? existing.searchQuery ?? "" : input.searchQuery.trim(),
      input.filterState === undefined ? existing.filterState ?? "{}" : serializeJson(input.filterState),
      input.sortState === undefined ? existing.sortState ?? "{}" : serializeJson(input.sortState),
      input.viewKey ?? null,
      input.isDefault === undefined ? (toBool(existing.isDefault) ? 1 : 0) : input.isDefault ? 1 : 0,
      input.displayOrder ?? existing.displayOrder ?? null,
      viewId,
      user.id,
    ],
  );

  return listSavedViews({ domain: existing.domain, scope: existing.scope });
}

export async function deleteSavedView(viewId: string) {
  const user = await resolveCurrentUser();
  await executeD1(
    `update saved_views
     set deleted_at = datetime('now'), updated_at = datetime('now')
     where id = ? and user_id = ? and deleted_at is null`,
    [viewId, user.id],
  );
}

export async function listWidgetLayouts(pageKey: string) {
  const user = await resolveCurrentUser();
  const result = await queryD1<WidgetLayoutRow>(
    `select
       id,
       page_key as pageKey,
       widget_key as widgetKey,
       title_override as titleOverride,
       layout,
       is_hidden as isHidden,
       display_order as displayOrder
     from widget_layouts
     where user_id = ?
       and page_key = ?
       and deleted_at is null
     order by display_order asc, updated_at asc`,
    [user.id, pageKey],
  );

  if (!result.rows.length && pageKey === "dashboard") {
    return DEFAULT_DASHBOARD_LAYOUTS.map((item, index) => ({
      id: `default-${item.widgetKey}`,
      pageKey,
      widgetKey: item.widgetKey,
      titleOverride: item.titleOverride ?? null,
      layout: item.layout,
      isHidden: item.isHidden ?? false,
      displayOrder: item.displayOrder ?? index,
    })) satisfies WidgetLayout[];
  }

  return result.rows.map((row) => ({
    id: row.id,
    pageKey: row.pageKey,
    widgetKey: row.widgetKey,
    titleOverride: row.titleOverride,
    layout: parseJsonRecord(row.layout),
    isHidden: toBool(row.isHidden),
    displayOrder: Number(row.displayOrder ?? 0),
  })) satisfies WidgetLayout[];
}

export async function replaceWidgetLayouts(pageKey: string, layouts: WidgetLayoutInput[]) {
  const user = await resolveCurrentUser();
  await executeD1(`delete from widget_layouts where user_id = ? and page_key = ?`, [user.id, pageKey]);

  for (const [index, item] of layouts.entries()) {
    await executeD1(
      `insert into widget_layouts (
         id, user_id, page_key, widget_key, title_override, layout, is_hidden, display_order, created_at, updated_at
       ) values (
         lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')
       )`,
      [
        user.id,
        pageKey,
        item.widgetKey,
        item.titleOverride ?? null,
        serializeJson(item.layout),
        item.isHidden ? 1 : 0,
        item.displayOrder ?? index,
      ],
    );
  }

  return listWidgetLayouts(pageKey);
}

export async function listShortcutBindings() {
  const user = await resolveCurrentUser();
  const result = await queryD1<ShortcutBindingRow>(
    `select
       id,
       category,
       action_key as actionKey,
       label,
       binding,
       is_enabled as isEnabled,
       is_custom as isCustom,
       display_order as displayOrder
     from shortcut_bindings
     where user_id = ?
       and deleted_at is null
     order by category asc, display_order asc, updated_at asc`,
    [user.id],
  );

  if (!result.rows.length) {
    return DEFAULT_SHORTCUT_BINDINGS.map((item, index) => ({
      id: `default-${item.actionKey}`,
      category: item.category,
      actionKey: item.actionKey,
      label: item.label,
      binding: item.binding,
      isEnabled: item.isEnabled ?? true,
      isCustom: false,
      displayOrder: item.displayOrder ?? index,
    })) satisfies ShortcutBinding[];
  }

  return result.rows.map((row) => ({
    id: row.id,
    category: row.category,
    actionKey: row.actionKey,
    label: row.label,
    binding: row.binding,
    isEnabled: toBool(row.isEnabled),
    isCustom: toBool(row.isCustom),
    displayOrder: Number(row.displayOrder ?? 0),
  })) satisfies ShortcutBinding[];
}

export async function replaceShortcutBindings(bindings: ShortcutBindingInput[]) {
  const user = await resolveCurrentUser();
  await executeD1(`delete from shortcut_bindings where user_id = ?`, [user.id]);

  for (const [index, item] of bindings.entries()) {
    await executeD1(
      `insert into shortcut_bindings (
         id, user_id, category, action_key, label, binding, is_enabled, is_custom, display_order, created_at, updated_at
       ) values (
         lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')
       )`,
      [
        user.id,
        item.category,
        item.actionKey,
        item.label,
        item.binding,
        item.isEnabled ?? true ? 1 : 0,
        item.isCustom ?? true ? 1 : 0,
        item.displayOrder ?? index,
      ],
    );
  }

  return listShortcutBindings();
}

export async function updateAppearancePreferences(input: {
  theme?: "dark" | "light" | "system";
  glassOpacity?: "full" | "low" | "off";
}) {
  const patch: { theme?: "dark" | "light" | "system"; glassOpacity?: "full" | "low" | "off" } = {};

  if (input.theme) patch.theme = input.theme;
  if (input.glassOpacity) patch.glassOpacity = input.glassOpacity;

  return updateCurrentUserPreferences(patch);
}
