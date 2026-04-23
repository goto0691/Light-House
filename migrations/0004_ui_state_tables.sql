create table if not exists saved_views (
  id text primary key not null,
  user_id text not null,
  domain text not null,
  scope text not null,
  name text not null,
  icon text,
  search_query text,
  filter_state text,
  sort_state text,
  view_key text,
  is_default integer default 0,
  display_order integer default 0,
  created_at text not null,
  updated_at text not null,
  deleted_at text
);

create index if not exists idx_saved_view_user_domain_scope
  on saved_views (user_id, domain, scope);

create index if not exists idx_saved_view_user_default
  on saved_views (user_id, is_default);

create table if not exists widget_layouts (
  id text primary key not null,
  user_id text not null,
  page_key text not null,
  widget_key text not null,
  title_override text,
  layout text not null,
  is_hidden integer default 0,
  display_order integer default 0,
  created_at text not null,
  updated_at text not null,
  deleted_at text
);

create index if not exists idx_widget_layout_user_page
  on widget_layouts (user_id, page_key);

create index if not exists idx_widget_layout_widget
  on widget_layouts (user_id, page_key, widget_key);

create table if not exists shortcut_bindings (
  id text primary key not null,
  user_id text not null,
  category text not null,
  action_key text not null,
  label text not null,
  binding text not null,
  is_enabled integer default 1,
  is_custom integer default 1,
  display_order integer default 0,
  created_at text not null,
  updated_at text not null,
  deleted_at text
);

create index if not exists idx_shortcut_user_category
  on shortcut_bindings (user_id, category);

create index if not exists idx_shortcut_action_key
  on shortcut_bindings (user_id, action_key);
