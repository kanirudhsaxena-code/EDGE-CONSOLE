create table if not exists build3_data_quality_assessments (
  id bigserial primary key,
  quality_version text not null,
  engine text not null check (engine in ('5DR','EDGE_STOCKS')),
  instrument text not null,
  source_id text not null,
  evidence_snapshot_id text not null references build3_evidence_snapshots(snapshot_id),
  evidence_hash text not null check (length(evidence_hash)=64),
  assessed_at timestamptz not null,
  overall_state text not null check (overall_state in ('VERIFIED','PARTIAL','MISSING','STALE')),
  valid_for_forecast boolean not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(engine,source_id)
);

create index if not exists build3_data_quality_state_idx
  on build3_data_quality_assessments(engine,overall_state,assessed_at desc);

create or replace function prevent_build3_data_quality_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'build3_data_quality_assessments are immutable';
end $$;

drop trigger if exists trg_build3_data_quality_immutable on build3_data_quality_assessments;
create trigger trg_build3_data_quality_immutable
before update or delete on build3_data_quality_assessments
for each row execute function prevent_build3_data_quality_mutation();
