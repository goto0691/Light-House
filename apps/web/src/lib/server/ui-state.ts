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
  { category: "global", actionKey: "command_palette", label: "Command Palette", binding: "Cmd+K", displayOrder: 0 },
  { category: "global", actionKey: "quick_capture", label: "Quick Capture", binding: "Cmd+Shift+N", displayOrder: 1 },
  { category: "shell", actionKey: "toggle_lnb", label: "LNB Toggle", binding: "Cmd+\\", displayOrder: 2 },
  { category: "shell", actionKey: "hotkey_cheatsheet", label: "Hotkey Cheatsheet", binding: "?", displayOrder: 3 },
  { category: "navigation", actionKey: "go_dashboard", label: "Dashboard", binding: "g d", displayOrder: 4 },
  { category: "navigation", actionKey: "go_action_hub", label: "Action Hub", binding: "g a", displayOrder: 5 },
  { category: "navigation", actionKey: "go_vault", label: "Vault", binding: "g v", displayOrder: 6 },
  { category: "navigation", actionKey: "go_prm", label: "PRM", binding: "g p", displayOrder: 7 },
  { category: "navigation", actionKey: "go_life_ops", label: "Life Ops", binding: "g l", displayOrder: 8 },
  { category: "navigation", actionKey: "go_settings", label: "Settings", binding: "g s", displayOrder: 9 },
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

  return result.rows.map((row) => ({
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
