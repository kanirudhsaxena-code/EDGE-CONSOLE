-- MDOS Build 3.0 Wave 2: precision issuance, outcome-ready interval metrics,
-- and forecast/recommendation separation.
-- Additive only. No production scoring, probability, recommendation or trading rule is changed.

create table if not exists build3_precision_issuance (
  id bigserial primary key,
  precision_version text not null,
  engine text not null check (engine in ('5DR','EDGE_STOCKS')),
  instrument text not null,
  source_id text not null,
  horizon text not null check (horizon in ('D','D+1','D+2','D+3','D+4')),
  target_session date not null,
  calibration_version text not null,
  calibration_state text not null check (
    calibration_state in (
      'CALIBRATED_SHADOW',
      'UNVALIDATED_SHADOW',
      'CALIBRATION_PENDING',
      'CALIBRATION_BLOCKED'
    )
  ),
  normalization_basis text not null,
  expected_centre double precision not null check (expected_centre > 0),
  core_low double precision not null check (core_low > 0),
  core_high double precision not null check (core_high > 0),
  outer_low double precision not null check (outer_low > 0),
  outer_high double precision not null check (outer_high > 0),
  core_width_points double precision not null check (core_width_points >= 0),
  core_width_percent double precision not null check (core_width_percent >= 0),
  outer_width_points double precision not null check (outer_width_points > 0),
  outer_width_percent double precision not null check (outer_width_percent > 0),
  calibration_inputs jsonb not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(engine,source_id,horizon),
  foreign key (engine,source_id,horizon)
    references build3_forecast_horizons(engine,source_id,horizon),
  check (outer_low <= core_low and core_low <= expected_centre and expected_centre <= core_high and core_high <= outer_high),
  check (core_width_points < outer_width_points)
);

create index if not exists build3_precision_target_idx
  on build3_precision_issuance(engine,instrument,target_session,horizon);

create or replace function prevent_build3_precision_issuance_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'build3_precision_issuance is immutable';
end $$;

drop trigger if exists trg_build3_precision_issuance_immutable on build3_precision_issuance;
create trigger trg_build3_precision_issuance_immutable
before update or delete on build3_precision_issuance
for each row execute function prevent_build3_precision_issuance_mutation();

-- Outcome rows are introduced now so Wave 3 can append the exact precision result
-- without changing the Wave 2 issuance contract. No outcome is backfilled here.
create table if not exists build3_precision_outcomes (
  id bigserial primary key,
  precision_outcome_version text not null,
  engine text not null check (engine in ('5DR','EDGE_STOCKS')),
  instrument text not null,
  source_id text not null,
  horizon text not null check (horizon in ('D','D+1','D+2','D+3','D+4')),
  target_session date not null,
  outcome_source text not null,
  evaluated_at timestamptz not null,
  actual_open double precision,
  actual_high double precision,
  actual_low double precision,
  actual_close double precision not null check (actual_close > 0),
  core_hit boolean not null,
  outer_hit boolean not null,
  core_width_points double precision not null check (core_width_points >= 0),
  core_width_percent double precision not null check (core_width_percent >= 0),
  outer_width_points double precision not null check (outer_width_points > 0),
  outer_width_percent double precision not null check (outer_width_percent > 0),
  centre_error double precision not null check (centre_error >= 0),
  normalized_centre_error double precision not null check (normalized_centre_error >= 0),
  miss_distance double precision not null check (miss_distance >= 0),
  edge_proximity double precision,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(engine,source_id,horizon),
  foreign key (engine,source_id,horizon)
    references build3_precision_issuance(engine,source_id,horizon)
);

create or replace function prevent_build3_precision_outcome_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'build3_precision_outcomes are append-only';
end $$;

drop trigger if exists trg_build3_precision_outcomes_immutable on build3_precision_outcomes;
create trigger trg_build3_precision_outcomes_immutable
before update or delete on build3_precision_outcomes
for each row execute function prevent_build3_precision_outcome_mutation();

create table if not exists build3_decisions (
  id bigserial primary key,
  decision_version text not null,
  engine text not null check (engine in ('5DR','EDGE_STOCKS')),
  instrument text not null,
  source_id text not null,
  issued_at timestamptz not null,
  forecast_direction text not null check (forecast_direction in ('BULL','RANGE','BEAR')),
  decision_state text not null check (decision_state in ('ACTIONABLE','NO_TRADE')),
  recommendation text not null,
  tradeable boolean not null,
  evidence_snapshot_id text not null references build3_evidence_snapshots(snapshot_id),
  evidence_hash text not null check (length(evidence_hash)=64),
  gate_results jsonb not null,
  rejecting_gates jsonb not null,
  counterfactual jsonb not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(engine,source_id),
  foreign key (engine,source_id)
    references build3_run_registry(engine,source_id)
);

create index if not exists build3_decision_state_idx
  on build3_decisions(engine,decision_state,issued_at desc);

create or replace function prevent_build3_decision_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'build3_decisions are immutable';
end $$;

drop trigger if exists trg_build3_decisions_immutable on build3_decisions;
create trigger trg_build3_decisions_immutable
before update or delete on build3_decisions
for each row execute function prevent_build3_decision_mutation();
