create table if not exists backup_snapshots (
  id text primary key not null,
  user_id text not null,
  provider text not null default 'r2',
  bucket_key text not null,
  format text not null default 'zip',
  status text not null default 'ready',
  size_bytes integer,
  checksum text,
  expires_at text,
  restored_at text,
  meta text,
  created_at text not null,
  updated_at text not null,
  deleted_at text
);

create index if not exists idx_backup_snapshot_user_created
  on backup_snapshots (user_id, created_at);

create index if not exists idx_backup_snapshot_bucket_key
  on backup_snapshots (bucket_key);

create table if not exists import_jobs (
  id text primary key not null,
  user_id text not null,
  source_type text not null,
  file_name text not null,
  status text not null default 'queued',
  mapping_config text,
  preview_summary text,
  result_summary text,
  progress_percent integer default 0,
  started_at text,
  finished_at text,
  created_at text not null,
  updated_at text not null,
  deleted_at text
);

create index if not exists idx_import_job_user_status
  on import_jobs (user_id, status);

create index if not exists idx_import_job_user_created
  on import_jobs (user_id, created_at);
