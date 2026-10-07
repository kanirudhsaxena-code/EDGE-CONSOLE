-- MDOS Build 3.0 Wave 3 — recommendation primitive observation attempts.
-- Additive only. Stores retryable acquisition/scorability evidence; never mutates frozen decisions.

create table if not exists build3_recommendation_observation_attempts (
  id bigserial primary key,
  attempt_version text not null,
  engine text not null check (engine in ('5DR','EDGE_STOCKS')),
  instrument text not null,
  source_id text not null,
  attempted_at timestamptz not null,
  attempt_state text not null check (
    attempt_state in ('SCORED','PENDING_SOURCE','NOT_SCORABLE','ALREADY_SCORED')
  ),
  reason text,
  evidence jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (engine,source_id)
    references build3_decisions(engine,source_id)
);

create index if not exists build3_recommendation_observation_attempt_idx
  on build3_recommendation_observation_attempts(engine,source_id,attempted_at desc);

create or replace function prevent_build3_recommendation_observation_attempt_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'build3_recommendation_observation_attempts are append-only';
end $$;

drop trigger if exists trg_build3_recommendation_observation_attempts_immutable
  on build3_recommendation_observation_attempts;
create trigger trg_build3_recommendation_observation_attempts_immutable
before update or delete on build3_recommendation_observation_attempts
for each row execute function prevent_build3_recommendation_observation_attempt_mutation();
