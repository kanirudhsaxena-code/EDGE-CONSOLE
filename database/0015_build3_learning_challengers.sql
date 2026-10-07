-- MDOS Build 3.0 Wave 5 — immutable Learning Lab and governed challenger registry.
-- Additive only. Learning may propose; production methodology cannot mutate from these tables.

create table if not exists build3_learning_lab_snapshots (
  id bigserial primary key,
  snapshot_id text not null unique,
  snapshot_version text not null,
  generated_at timestamptz not null,
  scope jsonb not null,
  payload_hash text not null check (length(payload_hash)=64),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists build3_learning_lab_generated_idx
  on build3_learning_lab_snapshots(generated_at desc);

create or replace function prevent_build3_learning_lab_snapshot_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'build3_learning_lab_snapshots are immutable';
end $$;

drop trigger if exists trg_build3_learning_lab_snapshots_immutable on build3_learning_lab_snapshots;
create trigger trg_build3_learning_lab_snapshots_immutable
before update or delete on build3_learning_lab_snapshots
for each row execute function prevent_build3_learning_lab_snapshot_mutation();

create table if not exists build3_challengers (
  id bigserial primary key,
  challenger_id text not null unique,
  challenger_version text not null,
  created_at timestamptz not null,
  source_learning_snapshot_id text not null references build3_learning_lab_snapshots(snapshot_id),
  challenger_type text not null check (
    challenger_type in ('ZONE_DEVIATION_TOLERANCE','ENTRY_SL_GEOMETRY','NO_TRADE_GATE','OTHER')
  ),
  target_cohort jsonb not null,
  hypothesis jsonb not null,
  expected_benefit text not null,
  risks jsonb not null,
  evidence jsonb not null,
  status text not null default 'PROPOSED' check (status='PROPOSED'),
  production_mutation_allowed boolean not null default false check (production_mutation_allowed=false),
  payload jsonb not null,
  created_at_db timestamptz not null default now()
);

create or replace function prevent_build3_challenger_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'build3_challengers are immutable proposals';
end $$;

drop trigger if exists trg_build3_challengers_immutable on build3_challengers;
create trigger trg_build3_challengers_immutable
before update or delete on build3_challengers
for each row execute function prevent_build3_challenger_mutation();

create table if not exists build3_challenger_events (
  id bigserial primary key,
  event_version text not null,
  challenger_id text not null references build3_challengers(challenger_id),
  event_type text not null check (event_type in ('APPROVED','REJECTED','PROMOTED','WITHDRAWN')),
  event_at timestamptz not null,
  explicit_user_approval boolean not null,
  actor text,
  details jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  check (
    event_type not in ('APPROVED','PROMOTED')
    or explicit_user_approval=true
  )
);

create index if not exists build3_challenger_event_lookup_idx
  on build3_challenger_events(challenger_id,event_at asc,id asc);

create or replace function prevent_build3_challenger_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'build3_challenger_events are append-only';
end $$;

drop trigger if exists trg_build3_challenger_events_immutable on build3_challenger_events;
create trigger trg_build3_challenger_events_immutable
before update or delete on build3_challenger_events
for each row execute function prevent_build3_challenger_event_mutation();
