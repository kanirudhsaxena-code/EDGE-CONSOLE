create table if not exists build3_forecast_horizons (
  id bigserial primary key,
  forecast_version text not null,
  engine text not null check (engine in ('5DR','EDGE_STOCKS')),
  instrument text not null,
  source_id text not null,
  model_version text not null,
  issued_at timestamptz not null,
  reference_price_p0 double precision not null check (reference_price_p0 > 0),
  evidence_snapshot_id text not null references build3_evidence_snapshots(snapshot_id),
  evidence_hash text not null check (length(evidence_hash)=64),
  data_quality_state text not null check (data_quality_state='VERIFIED'),
  horizon text not null check (horizon in ('D','D+1','D+2','D+3','D+4')),
  horizon_index integer not null check (horizon_index between 0 and 4),
  target_session date not null,
  direction text not null check (direction in ('BULL','RANGE','BEAR')),
  bull_probability double precision not null check (bull_probability between 0 and 100),
  range_probability double precision not null check (range_probability between 0 and 100),
  bear_probability double precision not null check (bear_probability between 0 and 100),
  regime text not null check (regime in ('TREND','RANGE','TRANSITION','EVENT_SHOCK')),
  reasoning text not null,
  expected_centre double precision not null check (expected_centre > 0),
  core_low double precision not null check (core_low > 0),
  core_high double precision not null check (core_high > 0),
  outer_low double precision not null check (outer_low > 0),
  outer_high double precision not null check (outer_high > 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(engine,source_id,horizon),
  unique(engine,source_id,horizon_index)
);

create index if not exists build3_forecast_target_idx
  on build3_forecast_horizons(engine,instrument,target_session,horizon_index);

create or replace function prevent_build3_forecast_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'build3_forecast_horizons are immutable';
end $$;

drop trigger if exists trg_build3_forecast_horizons_immutable on build3_forecast_horizons;
create trigger trg_build3_forecast_horizons_immutable
before update or delete on build3_forecast_horizons
for each row execute function prevent_build3_forecast_mutation();
