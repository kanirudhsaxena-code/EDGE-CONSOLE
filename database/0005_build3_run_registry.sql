create table if not exists build3_run_registry (
  id bigserial primary key,
  engine text not null check (engine in ('5DR','EDGE_STOCKS')),
  source_id text not null,
  instrument text not null,
  registry_schema_version text not null,
  contract_version text not null,
  model_version text not null,
  run_timestamp timestamptz not null,
  trigger_type text not null check (trigger_type in ('MANUAL','AUTOMATIC')),
  market_phase text not null check (market_phase in ('PRE_OPEN','OPEN','INTRADAY','POST_CLOSE','CLOSED_SESSION')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(engine,source_id)
);

create index if not exists build3_run_registry_timestamp_idx
  on build3_run_registry(run_timestamp desc);

create index if not exists build3_run_registry_instrument_idx
  on build3_run_registry(engine,instrument,run_timestamp desc);
