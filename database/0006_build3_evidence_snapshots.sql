create table if not exists build3_evidence_snapshots (
  id bigserial primary key,
  snapshot_id text not null unique,
  snapshot_version text not null,
  engine text not null check (engine in ('5DR','EDGE_STOCKS')),
  instrument text not null,
  source_id text not null,
  evidence_hash text not null check (length(evidence_hash)=64),
  frozen_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(engine,source_id)
);

create index if not exists build3_evidence_snapshot_hash_idx
  on build3_evidence_snapshots(evidence_hash);

create index if not exists build3_evidence_snapshot_instrument_idx
  on build3_evidence_snapshots(engine,instrument,frozen_at desc);

create or replace function prevent_build3_evidence_snapshot_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'build3_evidence_snapshots are immutable';
end $$;

drop trigger if exists trg_build3_evidence_snapshots_immutable on build3_evidence_snapshots;
create trigger trg_build3_evidence_snapshots_immutable
before update or delete on build3_evidence_snapshots
for each row execute function prevent_build3_evidence_snapshot_mutation();
