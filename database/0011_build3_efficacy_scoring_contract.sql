-- MDOS Build 3.0 Efficacy Scoring Contract V1.0 — 07-Oct-2026.
-- Additive only. Does not alter frozen Build 2.0/2.5 production methodology or tables.

alter table build3_precision_outcomes
  add column if not exists zone_efficacy_version text,
  add column if not exists outer_efficacy_state text,
  add column if not exists outer_high_breach_points double precision,
  add column if not exists outer_low_breach_points double precision,
  add column if not exists outer_high_deviation_pct double precision,
  add column if not exists outer_low_deviation_pct double precision,
  add column if not exists outer_range_deviation_pct double precision,
  add column if not exists outer_deviation_hit boolean,
  add column if not exists outer_challenger_3pct_hit boolean,
  add column if not exists outer_quality_status text,
  add column if not exists core_efficacy_state text,
  add column if not exists core_high_breach_points double precision,
  add column if not exists core_low_breach_points double precision,
  add column if not exists core_high_deviation_pct double precision,
  add column if not exists core_low_deviation_pct double precision,
  add column if not exists core_range_deviation_pct double precision,
  add column if not exists core_deviation_hit boolean,
  add column if not exists core_challenger_3pct_hit boolean,
  add column if not exists core_quality_status text;

alter table build3_precision_outcomes
  drop constraint if exists build3_precision_outcomes_outer_efficacy_state_check;
alter table build3_precision_outcomes
  add constraint build3_precision_outcomes_outer_efficacy_state_check
  check (outer_efficacy_state is null or outer_efficacy_state in ('SCORABLE','NOT_SCORABLE'));

alter table build3_precision_outcomes
  drop constraint if exists build3_precision_outcomes_core_efficacy_state_check;
alter table build3_precision_outcomes
  add constraint build3_precision_outcomes_core_efficacy_state_check
  check (core_efficacy_state is null or core_efficacy_state in ('SCORABLE','NOT_SCORABLE'));

alter table build3_precision_outcomes
  drop constraint if exists build3_precision_outcomes_outer_quality_status_check;
alter table build3_precision_outcomes
  add constraint build3_precision_outcomes_outer_quality_status_check
  check (outer_quality_status is null or outer_quality_status in ('GREEN','AMBER','RED','NOT_SCORABLE'));

alter table build3_precision_outcomes
  drop constraint if exists build3_precision_outcomes_core_quality_status_check;
alter table build3_precision_outcomes
  add constraint build3_precision_outcomes_core_quality_status_check
  check (core_quality_status is null or core_quality_status in ('GREEN','AMBER','RED','NOT_SCORABLE'));

create table if not exists build3_recommendation_efficacy (
  id bigserial primary key,
  efficacy_version text not null,
  engine text not null check (engine in ('5DR','EDGE_STOCKS')),
  instrument text not null,
  source_id text not null,
  evaluated_at timestamptz not null,
  entry_triggered boolean not null,
  lifecycle_complete boolean not null,
  primary_target_label text not null,
  primary_target_hit boolean not null,
  sl_hit boolean not null,
  classification text not null check (
    classification in ('TARGET_ONLY','SL_ONLY','DUAL_TOUCH','TIMEOUT_NO_TARGET','OPEN','UNTRIGGERED')
  ),
  conservative_result text check (conservative_result is null or conservative_result in ('HIT','LOSS','MISS')),
  liberal_result text check (liberal_result is null or liberal_result in ('HIT','LOSS','MISS')),
  finalized_triggered boolean not null,
  evidence jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(engine,source_id),
  foreign key (engine,source_id)
    references build3_decisions(engine,source_id)
);

create or replace function prevent_build3_recommendation_efficacy_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'build3_recommendation_efficacy is immutable';
end $$;

drop trigger if exists trg_build3_recommendation_efficacy_immutable on build3_recommendation_efficacy;
create trigger trg_build3_recommendation_efficacy_immutable
before update or delete on build3_recommendation_efficacy
for each row execute function prevent_build3_recommendation_efficacy_mutation();
