-- MDOS Build 3.0 Wave 3 — immutable one-minute recommendation truth sources.
-- Additive only. Provider identity must match the frozen decision execution snapshot.

create table if not exists build3_recommendation_intraday_sources (
  id bigserial primary key,
  source_version text not null,
  engine text not null check (engine in ('5DR','EDGE_STOCKS')),
  instrument text not null,
  source_id text not null,
  provider_instrument_key text not null,
  session_date date not null,
  captured_at timestamptz not null,
  source_ref text not null,
  provider_hash text not null check (length(provider_hash)=64),
  candle_interval_minutes integer not null check (candle_interval_minutes=1),
  candles jsonb not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(engine,source_id,provider_instrument_key,session_date),
  foreign key (engine,source_id)
    references build3_decisions(engine,source_id)
);

create index if not exists build3_recommendation_intraday_lookup_idx
  on build3_recommendation_intraday_sources(engine,source_id,session_date);

create or replace function prevent_build3_recommendation_intraday_source_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'build3_recommendation_intraday_sources are immutable';
end $$;

drop trigger if exists trg_build3_recommendation_intraday_sources_immutable
  on build3_recommendation_intraday_sources;
create trigger trg_build3_recommendation_intraday_sources_immutable
before update or delete on build3_recommendation_intraday_sources
for each row execute function prevent_build3_recommendation_intraday_source_mutation();
