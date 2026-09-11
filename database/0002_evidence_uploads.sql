create table if not exists evidence_uploads (
  id bigserial primary key,
  upload_id text not null unique,
  batch_id text not null,
  engine text not null references engine_registry(engine),
  provenance_mode text not null,
  object_key text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  captured_at timestamptz,
  status text not null default 'STAGED',
  run_id text references analysis_runs(run_id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
