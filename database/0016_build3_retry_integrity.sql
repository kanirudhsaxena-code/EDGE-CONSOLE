-- MDOS Build 3.0 Wave 6 — local failure isolation and retry audit.
-- Additive/fail-safe only; no analytical methodology changes.

alter table build3_outcome_attempts
  drop constraint if exists build3_outcome_attempts_attempt_state_check;
alter table build3_outcome_attempts
  add constraint build3_outcome_attempts_attempt_state_check
  check (
    attempt_state in (
      'SOURCE_NOT_AVAILABLE','SOURCE_INVALID','BLOCKED_CORPORATE_ACTION',
      'SCORED','ALREADY_SCORED','RETRYABLE_ERROR'
    )
  );

alter table build3_recommendation_observation_attempts
  drop constraint if exists build3_recommendation_observation_attempts_attempt_state_check;
alter table build3_recommendation_observation_attempts
  add constraint build3_recommendation_observation_attempts_attempt_state_check
  check (
    attempt_state in ('SCORED','PENDING_SOURCE','NOT_SCORABLE','ALREADY_SCORED','RETRYABLE_ERROR')
  );

create table if not exists build3_no_trade_observation_attempts (
  id bigserial primary key,
  attempt_version text not null,
  engine text not null check (engine in ('5DR','EDGE_STOCKS')),
  instrument text not null,
  source_id text not null,
  attempted_at timestamptz not null,
  attempt_state text not null check (
    attempt_state in ('SCORED','PENDING_SOURCE','NOT_SCORABLE','ALREADY_SCORED','RETRYABLE_ERROR')
  ),
  reason text,
  evidence jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (engine,source_id)
    references build3_decisions(engine,source_id)
);

create index if not exists build3_no_trade_observation_attempt_idx
  on build3_no_trade_observation_attempts(engine,source_id,attempted_at desc);

create or replace function prevent_build3_no_trade_observation_attempt_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'build3_no_trade_observation_attempts are append-only';
end $$;

drop trigger if exists trg_build3_no_trade_observation_attempts_immutable
  on build3_no_trade_observation_attempts;
create trigger trg_build3_no_trade_observation_attempts_immutable
before update or delete on build3_no_trade_observation_attempts
for each row execute function prevent_build3_no_trade_observation_attempt_mutation();
