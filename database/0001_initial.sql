begin;

create table if not exists engine_registry (
  engine text primary key check (engine in ('5DR','EDGE_STOCKS','EDGE_IPO')),
  display_name text not null,
  production_version text not null,
  status text not null default 'ACTIVE',
  updated_at timestamptz not null default now()
);

create table if not exists analysis_runs (
  id bigserial primary key,
  run_id text not null unique,
  engine text not null references engine_registry(engine),
  contract_version text not null,
  framework_version text not null,
  status text not null check (status in ('SUCCESS','PARTIAL','FAILED','SHADOW')),
  provenance_mode text not null check (provenance_mode in ('MANUAL','HYBRID','AUTOMATED')),
  sources jsonb not null default '[]'::jsonb,
  freshness_at timestamptz,
  generated_at timestamptz not null,
  result jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  learning_eligible boolean not null default true,
  published boolean not null default false,
  supersedes_run_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_analysis_runs_engine_generated
  on analysis_runs(engine, generated_at desc);
create index if not exists idx_analysis_runs_published
  on analysis_runs(published, generated_at desc);

create table if not exists evidence_items (
  id bigserial primary key,
  run_id text not null references analysis_runs(run_id) on delete cascade,
  evidence_type text not null,
  source_name text,
  source_ref text,
  captured_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists outcome_assessments (
  id bigserial primary key,
  run_id text not null references analysis_runs(run_id) on delete cascade,
  assessment_horizon text not null,
  outcome text,
  score numeric,
  metrics jsonb not null default '{}'::jsonb,
  assessed_at timestamptz not null default now(),
  unique(run_id, assessment_horizon)
);

create table if not exists learning_proposals (
  id bigserial primary key,
  proposal_id text not null unique,
  engine text not null references engine_registry(engine),
  source_run_ids jsonb not null default '[]'::jsonb,
  hypothesis text not null,
  proposed_change jsonb not null,
  validation_result jsonb,
  status text not null default 'PROPOSED'
    check (status in ('PROPOSED','SHADOW_TEST','REJECTED','APPROVED','PROMOTED')),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

insert into engine_registry(engine, display_name, production_version, status)
values
  ('5DR','5DR','2.1','ACTIVE'),
  ('EDGE_STOCKS','EDGE Stocks','1.0','ACTIVE'),
  ('EDGE_IPO','EDGE IPO','1.0','ACTIVE')
on conflict (engine) do nothing;

commit;
