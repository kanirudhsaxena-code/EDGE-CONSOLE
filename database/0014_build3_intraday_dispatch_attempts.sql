-- MDOS Build 3.0 Wave 3 — append-only intraday truth dispatch ledger.
-- Prevents duplicate provider dispatch while retaining retryable failure history.

create table if not exists build3_recommendation_intraday_dispatch_attempts (
  id bigserial primary key,
  dispatch_version text not null,
  engine text not null check (engine in ('5DR','EDGE_STOCKS')),
  instrument text not null,
  source_id text not null,
  provider_instrument_key text not null,
  session_date date not null,
  attempted_at timestamptz not null,
  dispatch_state text not null check (
    dispatch_state in ('DISPATCHED','CONFIGURATION_BLOCKED','DISPATCH_REJECTED','DISPATCH_UNAVAILABLE')
  ),
  detail text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (engine,source_id)
    references build3_decisions(engine,source_id)
);

create index if not exists build3_intraday_dispatch_lookup_idx
  on build3_recommendation_intraday_dispatch_attempts(engine,source_id,session_date,attempted_at desc);

create or replace function prevent_build3_intraday_dispatch_attempt_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'build3_recommendation_intraday_dispatch_attempts are append-only';
end $$;

drop trigger if exists trg_build3_intraday_dispatch_attempts_immutable
  on build3_recommendation_intraday_dispatch_attempts;
create trigger trg_build3_intraday_dispatch_attempts_immutable
before update or delete on build3_recommendation_intraday_dispatch_attempts
for each row execute function prevent_build3_intraday_dispatch_attempt_mutation();
