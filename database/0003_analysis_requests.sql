begin;

create table if not exists analysis_requests (
  id bigserial primary key,
  request_id text not null unique,
  engine text not null references engine_registry(engine),
  batch_id text not null unique,
  provenance_mode text not null check (provenance_mode in ('MANUAL','HYBRID','AUTOMATED')),
  framework_version text not null,
  output_contract_version text not null,
  status text not null default 'READY_FOR_ENGINE'
    check (status in ('READY_FOR_ENGINE','PROCESSING','COMPLETED','FAILED','CANCELLED')),
  run_id text references analysis_runs(run_id),
  metadata jsonb not null default '{}'::jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_analysis_requests_engine_created
  on analysis_requests(engine, created_at desc);

alter table evidence_uploads
  add column if not exists request_id text references analysis_requests(request_id);

create index if not exists idx_evidence_uploads_request_id
  on evidence_uploads(request_id);

commit;
