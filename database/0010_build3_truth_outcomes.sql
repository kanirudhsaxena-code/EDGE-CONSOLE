-- MDOS Build 3.0 Wave 3 — Truth / automatic outcome scoring.
-- Additive only. Frozen forecasts/decisions remain immutable.

create table if not exists build3_session_ohlc_sources (
  id bigserial primary key,
  source_version text not null,
  engine text not null check (engine in ('5DR','EDGE_STOCKS')),
  instrument text not null,
  session_date date not null,
  captured_at timestamptz not null,
  source_ref text not null,
  provider_hash text not null check (length(provider_hash)=64),
  actual_open double precision not null check (actual_open > 0),
  actual_high double precision not null check (actual_high > 0),
  actual_low double precision not null check (actual_low > 0),
  actual_close double precision not null check (actual_close > 0),
  corporate_action_state text not null check (
    corporate_action_state in ('NOT_APPLICABLE','CLEAR','ADJUSTED','UNKNOWN','CONFLICT')
  ),
  adjustment_basis text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(engine,instrument,session_date,provider_hash),
  check (actual_low <= least(actual_open,actual_close)),
  check (actual_high >= greatest(actual_open,actual_close)),
  check (actual_low <= actual_high)
);

create index if not exists build3_session_ohlc_lookup_idx
  on build3_session_ohlc_sources(engine,instrument,session_date,captured_at,id);

create or replace function prevent_build3_session_ohlc_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'build3_session_ohlc_sources are immutable';
end $$;

drop trigger if exists trg_build3_session_ohlc_immutable on build3_session_ohlc_sources;
create trigger trg_build3_session_ohlc_immutable
before update or delete on build3_session_ohlc_sources
for each row execute function prevent_build3_session_ohlc_mutation();

alter table build3_precision_outcomes
  add column if not exists outcome_version text,
  add column if not exists source_captured_at timestamptz,
  add column if not exists provider_hash text,
  add column if not exists corporate_action_state text,
  add column if not exists adjustment_basis text,
  add column if not exists direction_result text,
  add column if not exists direction_margin_points double precision,
  add column if not exists outer_touch boolean,
  add column if not exists outer_close_hit boolean,
  add column if not exists core_touch boolean,
  add column if not exists core_close_hit boolean,
  add column if not exists probability_state text,
  add column if not exists realized_probability_class text,
  add column if not exists brier_score double precision,
  add column if not exists brier_components jsonb,
  add column if not exists scorability_state text,
  add column if not exists scorability_reason text;

alter table build3_precision_outcomes
  drop constraint if exists build3_precision_outcomes_direction_result_check;
alter table build3_precision_outcomes
  add constraint build3_precision_outcomes_direction_result_check
  check (direction_result is null or direction_result in ('HIT','MISS','NOT_SCORABLE'));

alter table build3_precision_outcomes
  drop constraint if exists build3_precision_outcomes_probability_state_check;
alter table build3_precision_outcomes
  add constraint build3_precision_outcomes_probability_state_check
  check (probability_state is null or probability_state in ('SCORABLE','NOT_SCORABLE'));

alter table build3_precision_outcomes
  drop constraint if exists build3_precision_outcomes_realized_probability_class_check;
alter table build3_precision_outcomes
  add constraint build3_precision_outcomes_realized_probability_class_check
  check (
    realized_probability_class is null
    or realized_probability_class in ('BULL','RANGE','BEAR')
  );

alter table build3_precision_outcomes
  drop constraint if exists build3_precision_outcomes_scorability_state_check;
alter table build3_precision_outcomes
  add constraint build3_precision_outcomes_scorability_state_check
  check (scorability_state is null or scorability_state in ('SCORABLE','NOT_SCORABLE'));

alter table build3_decisions
  add column if not exists execution_snapshot jsonb not null default '{}'::jsonb;

create table if not exists build3_outcome_attempts (
  id bigserial primary key,
  attempt_version text not null,
  engine text not null check (engine in ('5DR','EDGE_STOCKS')),
  instrument text not null,
  source_id text not null,
  horizon text not null check (horizon in ('D','D+1','D+2','D+3','D+4')),
  target_session date not null,
  attempted_at timestamptz not null,
  attempt_state text not null check (
    attempt_state in (
      'SOURCE_NOT_AVAILABLE',
      'SOURCE_INVALID',
      'BLOCKED_CORPORATE_ACTION',
      'SCORED',
      'ALREADY_SCORED'
    )
  ),
  source_ref text,
  detail text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (engine,source_id,horizon)
    references build3_forecast_horizons(engine,source_id,horizon)
);

create index if not exists build3_outcome_attempt_lookup_idx
  on build3_outcome_attempts(engine,source_id,horizon,attempted_at desc);

create or replace function prevent_build3_outcome_attempt_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'build3_outcome_attempts are append-only';
end $$;

drop trigger if exists trg_build3_outcome_attempts_immutable on build3_outcome_attempts;
create trigger trg_build3_outcome_attempts_immutable
before update or delete on build3_outcome_attempts
for each row execute function prevent_build3_outcome_attempt_mutation();

create table if not exists build3_decision_outcomes (
  id bigserial primary key,
  decision_outcome_version text not null,
  engine text not null check (engine in ('5DR','EDGE_STOCKS')),
  instrument text not null,
  source_id text not null,
  evaluated_at timestamptz not null,
  scorability_state text not null check (scorability_state in ('SCORABLE','NOT_SCORABLE')),
  outcome_classification text not null check (
    outcome_classification in (
      'WIN','LOSS','FLAT',
      'GOOD_AVOID','MISSED_OPPORTUNITY','AMBIGUOUS',
      'DATA_FAILURE','EVIDENCE_CONFLICT','EXECUTION_REJECTION','NOT_SCORABLE'
    )
  ),
  entry_price double precision,
  exit_price double precision,
  stop_hit boolean,
  target1_hit boolean,
  target2_hit boolean,
  mfe_pct double precision,
  mae_pct double precision,
  r_multiple double precision,
  pnl_pct double precision,
  reason text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(engine,source_id),
  foreign key (engine,source_id)
    references build3_decisions(engine,source_id)
);

create or replace function prevent_build3_decision_outcome_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'build3_decision_outcomes are immutable';
end $$;

drop trigger if exists trg_build3_decision_outcome_immutable on build3_decision_outcomes;
create trigger trg_build3_decision_outcome_immutable
before update or delete on build3_decision_outcomes
for each row execute function prevent_build3_decision_outcome_mutation();
