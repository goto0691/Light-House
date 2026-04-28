-- AS-IS to TO-BE schema alignment.
-- Adds nullable fields and staging-friendly relation tables before the next data reconciliation pass.

alter table daily_logs add column source_document_id text references source_documents(id) on delete set null;

create table daily_log_entries (
  id text primary key not null,
  user_id text not null,
  daily_log_id text not null references daily_logs(id) on delete cascade,
  source_document_id text references source_documents(id) on delete set null,
  kind text not null default 'journal',
  title text,
  date text not null,
  body text,
  emotion text,
  event_summary text,
  verse text,
  background text,
  tags_snapshot text,
  created_at text not null,
  updated_at text not null,
  deleted_at text
);

create index idx_daily_entry_log on daily_log_entries(daily_log_id);
create index idx_daily_entry_user_date_kind on daily_log_entries(user_id, date, kind);
create index idx_daily_entry_source_document on daily_log_entries(source_document_id);

create table daily_entry_people_relations (
  daily_entry_id text not null references daily_log_entries(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  context text,
  source_document_id text references source_documents(id) on delete set null,
  confidence real,
  raw_value text,
  created_at text not null,
  primary key (daily_entry_id, person_id)
);

create index idx_daily_entry_people_person on daily_entry_people_relations(person_id);
create index idx_daily_entry_people_source_document on daily_entry_people_relations(source_document_id);

alter table daily_log_people_relations add column source_document_id text references source_documents(id) on delete set null;
alter table daily_log_people_relations add column confidence real;
alter table daily_log_people_relations add column raw_value text;
create index idx_daily_log_people_source_document on daily_log_people_relations(source_document_id);

alter table workouts add column source_document_id text references source_documents(id) on delete set null;
alter table workouts add column title text;
create index idx_wo_source_document on workouts(source_document_id);

alter table people add column source_document_id text references source_documents(id) on delete set null;
alter table people add column aliases text;
alter table people add column birthday_memo text;
alter table people add column profile_body text;
create index idx_person_source_document on people(source_document_id);

alter table zettels add column source_document_id text references source_documents(id) on delete set null;
alter table zettels add column status text;
alter table zettels add column document_kind text;
alter table zettels add column original_created_at text;
create index idx_zettel_source_document on zettels(source_document_id);

alter table media_logs add column source_document_id text references source_documents(id) on delete set null;
alter table media_logs add column subtype text;
alter table media_logs add column relation_note text;
alter table media_logs add column logged_at text;
create index idx_media_source_document on media_logs(source_document_id);

alter table zettel_media_relations add column source_document_id text references source_documents(id) on delete set null;
alter table zettel_media_relations add column confidence real;
alter table zettel_media_relations add column raw_value text;
create index idx_zettel_media_source_document on zettel_media_relations(source_document_id);

alter table zettel_people_relations add column source_document_id text references source_documents(id) on delete set null;
alter table zettel_people_relations add column confidence real;
alter table zettel_people_relations add column raw_value text;
create index idx_zettel_people_source_document on zettel_people_relations(source_document_id);

alter table media_people_relations add column source_document_id text references source_documents(id) on delete set null;
alter table media_people_relations add column confidence real;
alter table media_people_relations add column raw_value text;
create index idx_media_people_source_document on media_people_relations(source_document_id);

alter table projects add column source_document_id text references source_documents(id) on delete set null;
alter table projects add column importance text;
alter table projects add column brain_energy text;
alter table projects add column artifact_url text;
create index idx_proj_source_document on projects(source_document_id);

create table project_people_relations (
  project_id text not null references projects(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  role_context text,
  source_document_id text references source_documents(id) on delete set null,
  confidence real,
  raw_value text,
  created_at text not null,
  primary key (project_id, person_id)
);

create index idx_project_people_person on project_people_relations(person_id);
create index idx_project_people_source_document on project_people_relations(source_document_id);

create table project_zettel_relations (
  project_id text not null references projects(id) on delete cascade,
  zettel_id text not null references zettels(id) on delete cascade,
  context text,
  source_document_id text references source_documents(id) on delete set null,
  confidence real,
  raw_value text,
  created_at text not null,
  primary key (project_id, zettel_id)
);

create index idx_project_zettel_zettel on project_zettel_relations(zettel_id);
create index idx_project_zettel_source_document on project_zettel_relations(source_document_id);

alter table task_people_relations add column source_document_id text references source_documents(id) on delete set null;
alter table task_people_relations add column confidence real;
alter table task_people_relations add column raw_value text;
create index idx_task_people_source_document on task_people_relations(source_document_id);

alter table task_zettel_relations add column source_document_id text references source_documents(id) on delete set null;
alter table task_zettel_relations add column confidence real;
alter table task_zettel_relations add column raw_value text;
create index idx_task_zettel_source_document on task_zettel_relations(source_document_id);

create table entity_links (
  id text primary key not null,
  user_id text not null,
  source_type text not null,
  source_id text not null,
  target_type text not null,
  target_id text not null,
  relation_type text not null default 'related',
  context text,
  source_document_id text references source_documents(id) on delete set null,
  confidence real,
  raw_value text,
  created_at text not null
);

create index idx_entity_link_source on entity_links(user_id, source_type, source_id);
create index idx_entity_link_target on entity_links(user_id, target_type, target_id);
create index idx_entity_link_source_document on entity_links(source_document_id);
