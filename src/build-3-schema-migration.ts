import { neon } from '@neondatabase/serverless';

export const BUILD3_SCHEMA_VERSION='MDOS_BUILD_3_SCHEMA_V1' as const;
export const BUILD3_SCHEMA_TABLES=[
  'build3_run_registry',
  'build3_evidence_snapshots',
  'build3_data_quality_assessments',
  'build3_forecast_horizons',
  'build3_precision_issuance',
  'build3_precision_outcomes',
  'build3_decisions',
  'build3_session_ohlc_sources',
  'build3_outcome_attempts',
  'build3_decision_outcomes',
  'build3_recommendation_efficacy',
] as const;

export const BUILD3_SCHEMA_REQUIRED_COLUMNS=[
  ['build3_decisions','execution_snapshot'],
  ['build3_precision_outcomes','direction_result'],
  ['build3_precision_outcomes','brier_score'],
  ['build3_precision_outcomes','scorability_state'],
  ['build3_precision_outcomes','zone_efficacy_version'],
  ['build3_precision_outcomes','outer_quality_status'],
  ['build3_precision_outcomes','core_quality_status'],
  ['build3_recommendation_efficacy','classification'],
] as const;

export const BUILD3_SCHEMA_MIGRATIONS=[
  {
    "path": "database/0005_build3_run_registry.sql",
    "sql": "create table if not exists build3_run_registry (\n  id bigserial primary key,\n  engine text not null check (engine in ('5DR','EDGE_STOCKS')),\n  source_id text not null,\n  instrument text not null,\n  registry_schema_version text not null,\n  contract_version text not null,\n  model_version text not null,\n  run_timestamp timestamptz not null,\n  trigger_type text not null check (trigger_type in ('MANUAL','AUTOMATIC')),\n  market_phase text not null check (market_phase in ('PRE_OPEN','OPEN','INTRADAY','POST_CLOSE','CLOSED_SESSION')),\n  payload jsonb not null,\n  created_at timestamptz not null default now(),\n  updated_at timestamptz not null default now(),\n  unique(engine,source_id)\n);\n\ncreate index if not exists build3_run_registry_timestamp_idx\n  on build3_run_registry(run_timestamp desc);\n\ncreate index if not exists build3_run_registry_instrument_idx\n  on build3_run_registry(engine,instrument,run_timestamp desc);\n"
  },
  {
    "path": "database/0006_build3_evidence_snapshots.sql",
    "sql": "create table if not exists build3_evidence_snapshots (\n  id bigserial primary key,\n  snapshot_id text not null unique,\n  snapshot_version text not null,\n  engine text not null check (engine in ('5DR','EDGE_STOCKS')),\n  instrument text not null,\n  source_id text not null,\n  evidence_hash text not null check (length(evidence_hash)=64),\n  frozen_at timestamptz not null,\n  payload jsonb not null,\n  created_at timestamptz not null default now(),\n  unique(engine,source_id)\n);\n\ncreate index if not exists build3_evidence_snapshot_hash_idx\n  on build3_evidence_snapshots(evidence_hash);\n\ncreate index if not exists build3_evidence_snapshot_instrument_idx\n  on build3_evidence_snapshots(engine,instrument,frozen_at desc);\n\ncreate or replace function prevent_build3_evidence_snapshot_mutation()\nreturns trigger language plpgsql as $$\nbegin\n  raise exception 'build3_evidence_snapshots are immutable';\nend $$;\n\ndrop trigger if exists trg_build3_evidence_snapshots_immutable on build3_evidence_snapshots;\ncreate trigger trg_build3_evidence_snapshots_immutable\nbefore update or delete on build3_evidence_snapshots\nfor each row execute function prevent_build3_evidence_snapshot_mutation();\n"
  },
  {
    "path": "database/0007_build3_data_quality.sql",
    "sql": "create table if not exists build3_data_quality_assessments (\n  id bigserial primary key,\n  quality_version text not null,\n  engine text not null check (engine in ('5DR','EDGE_STOCKS')),\n  instrument text not null,\n  source_id text not null,\n  evidence_snapshot_id text not null references build3_evidence_snapshots(snapshot_id),\n  evidence_hash text not null check (length(evidence_hash)=64),\n  assessed_at timestamptz not null,\n  overall_state text not null check (overall_state in ('VERIFIED','PARTIAL','MISSING','STALE')),\n  valid_for_forecast boolean not null,\n  payload jsonb not null,\n  created_at timestamptz not null default now(),\n  unique(engine,source_id)\n);\n\ncreate index if not exists build3_data_quality_state_idx\n  on build3_data_quality_assessments(engine,overall_state,assessed_at desc);\n\ncreate or replace function prevent_build3_data_quality_mutation()\nreturns trigger language plpgsql as $$\nbegin\n  raise exception 'build3_data_quality_assessments are immutable';\nend $$;\n\ndrop trigger if exists trg_build3_data_quality_immutable on build3_data_quality_assessments;\ncreate trigger trg_build3_data_quality_immutable\nbefore update or delete on build3_data_quality_assessments\nfor each row execute function prevent_build3_data_quality_mutation();\n"
  },
  {
    "path": "database/0008_build3_forecast_horizons.sql",
    "sql": "create table if not exists build3_forecast_horizons (\n  id bigserial primary key,\n  forecast_version text not null,\n  engine text not null check (engine in ('5DR','EDGE_STOCKS')),\n  instrument text not null,\n  source_id text not null,\n  model_version text not null,\n  issued_at timestamptz not null,\n  reference_price_p0 double precision not null check (reference_price_p0 > 0),\n  evidence_snapshot_id text not null references build3_evidence_snapshots(snapshot_id),\n  evidence_hash text not null check (length(evidence_hash)=64),\n  data_quality_state text not null check (data_quality_state='VERIFIED'),\n  horizon text not null check (horizon in ('D','D+1','D+2','D+3','D+4')),\n  horizon_index integer not null check (horizon_index between 0 and 4),\n  target_session date not null,\n  direction text not null check (direction in ('BULL','RANGE','BEAR')),\n  bull_probability double precision not null check (bull_probability between 0 and 100),\n  range_probability double precision not null check (range_probability between 0 and 100),\n  bear_probability double precision not null check (bear_probability between 0 and 100),\n  regime text not null check (regime in ('TREND','RANGE','TRANSITION','EVENT_SHOCK')),\n  reasoning text not null,\n  expected_centre double precision not null check (expected_centre > 0),\n  core_low double precision not null check (core_low > 0),\n  core_high double precision not null check (core_high > 0),\n  outer_low double precision not null check (outer_low > 0),\n  outer_high double precision not null check (outer_high > 0),\n  payload jsonb not null,\n  created_at timestamptz not null default now(),\n  unique(engine,source_id,horizon),\n  unique(engine,source_id,horizon_index)\n);\n\ncreate index if not exists build3_forecast_target_idx\n  on build3_forecast_horizons(engine,instrument,target_session,horizon_index);\n\ncreate or replace function prevent_build3_forecast_mutation()\nreturns trigger language plpgsql as $$\nbegin\n  raise exception 'build3_forecast_horizons are immutable';\nend $$;\n\ndrop trigger if exists trg_build3_forecast_horizons_immutable on build3_forecast_horizons;\ncreate trigger trg_build3_forecast_horizons_immutable\nbefore update or delete on build3_forecast_horizons\nfor each row execute function prevent_build3_forecast_mutation();\n"
  },
  {
    "path": "database/0009_build3_precision_decisions.sql",
    "sql": "-- MDOS Build 3.0 Wave 2: precision issuance, outcome-ready interval metrics,\n-- and forecast/recommendation separation.\n-- Additive only. No production scoring, probability, recommendation or trading rule is changed.\n\ncreate table if not exists build3_precision_issuance (\n  id bigserial primary key,\n  precision_version text not null,\n  engine text not null check (engine in ('5DR','EDGE_STOCKS')),\n  instrument text not null,\n  source_id text not null,\n  horizon text not null check (horizon in ('D','D+1','D+2','D+3','D+4')),\n  target_session date not null,\n  calibration_version text not null,\n  calibration_state text not null check (\n    calibration_state in (\n      'CALIBRATED_SHADOW',\n      'UNVALIDATED_SHADOW',\n      'CALIBRATION_PENDING',\n      'CALIBRATION_BLOCKED'\n    )\n  ),\n  normalization_basis text not null,\n  expected_centre double precision not null check (expected_centre > 0),\n  core_low double precision not null check (core_low > 0),\n  core_high double precision not null check (core_high > 0),\n  outer_low double precision not null check (outer_low > 0),\n  outer_high double precision not null check (outer_high > 0),\n  core_width_points double precision not null check (core_width_points >= 0),\n  core_width_percent double precision not null check (core_width_percent >= 0),\n  outer_width_points double precision not null check (outer_width_points > 0),\n  outer_width_percent double precision not null check (outer_width_percent > 0),\n  calibration_inputs jsonb not null,\n  payload jsonb not null,\n  created_at timestamptz not null default now(),\n  unique(engine,source_id,horizon),\n  foreign key (engine,source_id,horizon)\n    references build3_forecast_horizons(engine,source_id,horizon),\n  check (outer_low <= core_low and core_low <= expected_centre and expected_centre <= core_high and core_high <= outer_high),\n  check (core_width_points < outer_width_points)\n);\n\ncreate index if not exists build3_precision_target_idx\n  on build3_precision_issuance(engine,instrument,target_session,horizon);\n\ncreate or replace function prevent_build3_precision_issuance_mutation()\nreturns trigger language plpgsql as $$\nbegin\n  raise exception 'build3_precision_issuance is immutable';\nend $$;\n\ndrop trigger if exists trg_build3_precision_issuance_immutable on build3_precision_issuance;\ncreate trigger trg_build3_precision_issuance_immutable\nbefore update or delete on build3_precision_issuance\nfor each row execute function prevent_build3_precision_issuance_mutation();\n\n-- Outcome rows are introduced now so Wave 3 can append the exact precision result\n-- without changing the Wave 2 issuance contract. No outcome is backfilled here.\ncreate table if not exists build3_precision_outcomes (\n  id bigserial primary key,\n  precision_outcome_version text not null,\n  engine text not null check (engine in ('5DR','EDGE_STOCKS')),\n  instrument text not null,\n  source_id text not null,\n  horizon text not null check (horizon in ('D','D+1','D+2','D+3','D+4')),\n  target_session date not null,\n  outcome_source text not null,\n  evaluated_at timestamptz not null,\n  actual_open double precision,\n  actual_high double precision,\n  actual_low double precision,\n  actual_close double precision not null check (actual_close > 0),\n  core_hit boolean not null,\n  outer_hit boolean not null,\n  core_width_points double precision not null check (core_width_points >= 0),\n  core_width_percent double precision not null check (core_width_percent >= 0),\n  outer_width_points double precision not null check (outer_width_points > 0),\n  outer_width_percent double precision not null check (outer_width_percent > 0),\n  centre_error double precision not null check (centre_error >= 0),\n  normalized_centre_error double precision not null check (normalized_centre_error >= 0),\n  miss_distance double precision not null check (miss_distance >= 0),\n  edge_proximity double precision,\n  payload jsonb not null,\n  created_at timestamptz not null default now(),\n  unique(engine,source_id,horizon),\n  foreign key (engine,source_id,horizon)\n    references build3_precision_issuance(engine,source_id,horizon)\n);\n\ncreate or replace function prevent_build3_precision_outcome_mutation()\nreturns trigger language plpgsql as $$\nbegin\n  raise exception 'build3_precision_outcomes are append-only';\nend $$;\n\ndrop trigger if exists trg_build3_precision_outcomes_immutable on build3_precision_outcomes;\ncreate trigger trg_build3_precision_outcomes_immutable\nbefore update or delete on build3_precision_outcomes\nfor each row execute function prevent_build3_precision_outcome_mutation();\n\ncreate table if not exists build3_decisions (\n  id bigserial primary key,\n  decision_version text not null,\n  engine text not null check (engine in ('5DR','EDGE_STOCKS')),\n  instrument text not null,\n  source_id text not null,\n  issued_at timestamptz not null,\n  forecast_direction text not null check (forecast_direction in ('BULL','RANGE','BEAR')),\n  decision_state text not null check (decision_state in ('ACTIONABLE','NO_TRADE')),\n  recommendation text not null,\n  tradeable boolean not null,\n  evidence_snapshot_id text not null references build3_evidence_snapshots(snapshot_id),\n  evidence_hash text not null check (length(evidence_hash)=64),\n  gate_results jsonb not null,\n  rejecting_gates jsonb not null,\n  counterfactual jsonb not null,\n  payload jsonb not null,\n  created_at timestamptz not null default now(),\n  unique(engine,source_id),\n  foreign key (engine,source_id)\n    references build3_run_registry(engine,source_id)\n);\n\ncreate index if not exists build3_decision_state_idx\n  on build3_decisions(engine,decision_state,issued_at desc);\n\ncreate or replace function prevent_build3_decision_mutation()\nreturns trigger language plpgsql as $$\nbegin\n  raise exception 'build3_decisions are immutable';\nend $$;\n\ndrop trigger if exists trg_build3_decisions_immutable on build3_decisions;\ncreate trigger trg_build3_decisions_immutable\nbefore update or delete on build3_decisions\nfor each row execute function prevent_build3_decision_mutation();\n"
  },
  {
    "path": "database/0010_build3_truth_outcomes.sql",
    "sql": "-- MDOS Build 3.0 Wave 3 — Truth / automatic outcome scoring.\n-- Additive only. Frozen forecasts/decisions remain immutable.\n\ncreate table if not exists build3_session_ohlc_sources (\n  id bigserial primary key,\n  source_version text not null,\n  engine text not null check (engine in ('5DR','EDGE_STOCKS')),\n  instrument text not null,\n  session_date date not null,\n  captured_at timestamptz not null,\n  source_ref text not null,\n  provider_hash text not null check (length(provider_hash)=64),\n  actual_open double precision not null check (actual_open > 0),\n  actual_high double precision not null check (actual_high > 0),\n  actual_low double precision not null check (actual_low > 0),\n  actual_close double precision not null check (actual_close > 0),\n  corporate_action_state text not null check (\n    corporate_action_state in ('NOT_APPLICABLE','CLEAR','ADJUSTED','UNKNOWN','CONFLICT')\n  ),\n  adjustment_basis text not null,\n  payload jsonb not null,\n  created_at timestamptz not null default now(),\n  unique(engine,instrument,session_date,provider_hash),\n  check (actual_low <= least(actual_open,actual_close)),\n  check (actual_high >= greatest(actual_open,actual_close)),\n  check (actual_low <= actual_high)\n);\n\ncreate index if not exists build3_session_ohlc_lookup_idx\n  on build3_session_ohlc_sources(engine,instrument,session_date,captured_at,id);\n\ncreate or replace function prevent_build3_session_ohlc_mutation()\nreturns trigger language plpgsql as $$\nbegin\n  raise exception 'build3_session_ohlc_sources are immutable';\nend $$;\n\ndrop trigger if exists trg_build3_session_ohlc_immutable on build3_session_ohlc_sources;\ncreate trigger trg_build3_session_ohlc_immutable\nbefore update or delete on build3_session_ohlc_sources\nfor each row execute function prevent_build3_session_ohlc_mutation();\n\nalter table build3_precision_outcomes\n  add column if not exists outcome_version text,\n  add column if not exists source_captured_at timestamptz,\n  add column if not exists provider_hash text,\n  add column if not exists corporate_action_state text,\n  add column if not exists adjustment_basis text,\n  add column if not exists direction_result text,\n  add column if not exists direction_margin_points double precision,\n  add column if not exists outer_touch boolean,\n  add column if not exists outer_close_hit boolean,\n  add column if not exists core_touch boolean,\n  add column if not exists core_close_hit boolean,\n  add column if not exists probability_state text,\n  add column if not exists realized_probability_class text,\n  add column if not exists brier_score double precision,\n  add column if not exists brier_components jsonb,\n  add column if not exists scorability_state text,\n  add column if not exists scorability_reason text;\n\nalter table build3_precision_outcomes\n  drop constraint if exists build3_precision_outcomes_direction_result_check;\nalter table build3_precision_outcomes\n  add constraint build3_precision_outcomes_direction_result_check\n  check (direction_result is null or direction_result in ('HIT','MISS','NOT_SCORABLE'));\n\nalter table build3_precision_outcomes\n  drop constraint if exists build3_precision_outcomes_probability_state_check;\nalter table build3_precision_outcomes\n  add constraint build3_precision_outcomes_probability_state_check\n  check (probability_state is null or probability_state in ('SCORABLE','NOT_SCORABLE'));\n\nalter table build3_precision_outcomes\n  drop constraint if exists build3_precision_outcomes_realized_probability_class_check;\nalter table build3_precision_outcomes\n  add constraint build3_precision_outcomes_realized_probability_class_check\n  check (\n    realized_probability_class is null\n    or realized_probability_class in ('BULL','RANGE','BEAR')\n  );\n\nalter table build3_precision_outcomes\n  drop constraint if exists build3_precision_outcomes_scorability_state_check;\nalter table build3_precision_outcomes\n  add constraint build3_precision_outcomes_scorability_state_check\n  check (scorability_state is null or scorability_state in ('SCORABLE','NOT_SCORABLE'));\n\nalter table build3_decisions\n  add column if not exists execution_snapshot jsonb not null default '{}'::jsonb;\n\ncreate table if not exists build3_outcome_attempts (\n  id bigserial primary key,\n  attempt_version text not null,\n  engine text not null check (engine in ('5DR','EDGE_STOCKS')),\n  instrument text not null,\n  source_id text not null,\n  horizon text not null check (horizon in ('D','D+1','D+2','D+3','D+4')),\n  target_session date not null,\n  attempted_at timestamptz not null,\n  attempt_state text not null check (\n    attempt_state in (\n      'SOURCE_NOT_AVAILABLE',\n      'SOURCE_INVALID',\n      'BLOCKED_CORPORATE_ACTION',\n      'SCORED',\n      'ALREADY_SCORED'\n    )\n  ),\n  source_ref text,\n  detail text,\n  payload jsonb not null,\n  created_at timestamptz not null default now(),\n  foreign key (engine,source_id,horizon)\n    references build3_forecast_horizons(engine,source_id,horizon)\n);\n\ncreate index if not exists build3_outcome_attempt_lookup_idx\n  on build3_outcome_attempts(engine,source_id,horizon,attempted_at desc);\n\ncreate or replace function prevent_build3_outcome_attempt_mutation()\nreturns trigger language plpgsql as $$\nbegin\n  raise exception 'build3_outcome_attempts are append-only';\nend $$;\n\ndrop trigger if exists trg_build3_outcome_attempts_immutable on build3_outcome_attempts;\ncreate trigger trg_build3_outcome_attempts_immutable\nbefore update or delete on build3_outcome_attempts\nfor each row execute function prevent_build3_outcome_attempt_mutation();\n\ncreate table if not exists build3_decision_outcomes (\n  id bigserial primary key,\n  decision_outcome_version text not null,\n  engine text not null check (engine in ('5DR','EDGE_STOCKS')),\n  instrument text not null,\n  source_id text not null,\n  evaluated_at timestamptz not null,\n  scorability_state text not null check (scorability_state in ('SCORABLE','NOT_SCORABLE')),\n  outcome_classification text not null check (\n    outcome_classification in (\n      'WIN','LOSS','FLAT',\n      'GOOD_AVOID','MISSED_OPPORTUNITY','AMBIGUOUS',\n      'DATA_FAILURE','EVIDENCE_CONFLICT','EXECUTION_REJECTION','NOT_SCORABLE'\n    )\n  ),\n  entry_price double precision,\n  exit_price double precision,\n  stop_hit boolean,\n  target1_hit boolean,\n  target2_hit boolean,\n  mfe_pct double precision,\n  mae_pct double precision,\n  r_multiple double precision,\n  pnl_pct double precision,\n  reason text,\n  payload jsonb not null,\n  created_at timestamptz not null default now(),\n  unique(engine,source_id),\n  foreign key (engine,source_id)\n    references build3_decisions(engine,source_id)\n);\n\ncreate or replace function prevent_build3_decision_outcome_mutation()\nreturns trigger language plpgsql as $$\nbegin\n  raise exception 'build3_decision_outcomes are immutable';\nend $$;\n\ndrop trigger if exists trg_build3_decision_outcome_immutable on build3_decision_outcomes;\ncreate trigger trg_build3_decision_outcome_immutable\nbefore update or delete on build3_decision_outcomes\nfor each row execute function prevent_build3_decision_outcome_mutation();\n"
  },
  {
    "path": "database/0011_build3_efficacy_scoring_contract.sql",
    "sql": "-- MDOS Build 3.0 Efficacy Scoring Contract V1.0 — 07-Oct-2026.\n-- Additive only. Does not alter frozen Build 2.0/2.5 production methodology or tables.\n\nalter table build3_precision_outcomes\n  add column if not exists zone_efficacy_version text,\n  add column if not exists outer_efficacy_state text,\n  add column if not exists outer_high_breach_points double precision,\n  add column if not exists outer_low_breach_points double precision,\n  add column if not exists outer_high_deviation_pct double precision,\n  add column if not exists outer_low_deviation_pct double precision,\n  add column if not exists outer_range_deviation_pct double precision,\n  add column if not exists outer_deviation_hit boolean,\n  add column if not exists outer_challenger_3pct_hit boolean,\n  add column if not exists outer_quality_status text,\n  add column if not exists core_efficacy_state text,\n  add column if not exists core_high_breach_points double precision,\n  add column if not exists core_low_breach_points double precision,\n  add column if not exists core_high_deviation_pct double precision,\n  add column if not exists core_low_deviation_pct double precision,\n  add column if not exists core_range_deviation_pct double precision,\n  add column if not exists core_deviation_hit boolean,\n  add column if not exists core_challenger_3pct_hit boolean,\n  add column if not exists core_quality_status text;\n\nalter table build3_precision_outcomes\n  drop constraint if exists build3_precision_outcomes_outer_efficacy_state_check;\nalter table build3_precision_outcomes\n  add constraint build3_precision_outcomes_outer_efficacy_state_check\n  check (outer_efficacy_state is null or outer_efficacy_state in ('SCORABLE','NOT_SCORABLE'));\n\nalter table build3_precision_outcomes\n  drop constraint if exists build3_precision_outcomes_core_efficacy_state_check;\nalter table build3_precision_outcomes\n  add constraint build3_precision_outcomes_core_efficacy_state_check\n  check (core_efficacy_state is null or core_efficacy_state in ('SCORABLE','NOT_SCORABLE'));\n\nalter table build3_precision_outcomes\n  drop constraint if exists build3_precision_outcomes_outer_quality_status_check;\nalter table build3_precision_outcomes\n  add constraint build3_precision_outcomes_outer_quality_status_check\n  check (outer_quality_status is null or outer_quality_status in ('GREEN','AMBER','RED','NOT_SCORABLE'));\n\nalter table build3_precision_outcomes\n  drop constraint if exists build3_precision_outcomes_core_quality_status_check;\nalter table build3_precision_outcomes\n  add constraint build3_precision_outcomes_core_quality_status_check\n  check (core_quality_status is null or core_quality_status in ('GREEN','AMBER','RED','NOT_SCORABLE'));\n\ncreate table if not exists build3_recommendation_efficacy (\n  id bigserial primary key,\n  efficacy_version text not null,\n  engine text not null check (engine in ('5DR','EDGE_STOCKS')),\n  instrument text not null,\n  source_id text not null,\n  evaluated_at timestamptz not null,\n  entry_triggered boolean not null,\n  lifecycle_complete boolean not null,\n  primary_target_label text not null,\n  primary_target_hit boolean not null,\n  sl_hit boolean not null,\n  classification text not null check (\n    classification in ('TARGET_ONLY','SL_ONLY','DUAL_TOUCH','TIMEOUT_NO_TARGET','OPEN','UNTRIGGERED')\n  ),\n  conservative_result text check (conservative_result is null or conservative_result in ('HIT','LOSS','MISS')),\n  liberal_result text check (liberal_result is null or liberal_result in ('HIT','LOSS','MISS')),\n  finalized_triggered boolean not null,\n  evidence jsonb not null default '{}'::jsonb,\n  payload jsonb not null,\n  created_at timestamptz not null default now(),\n  unique(engine,source_id),\n  foreign key (engine,source_id)\n    references build3_decisions(engine,source_id)\n);\n\ncreate or replace function prevent_build3_recommendation_efficacy_mutation()\nreturns trigger language plpgsql as $\nbegin\n  raise exception 'build3_recommendation_efficacy is immutable';\nend $;\n\ndrop trigger if exists trg_build3_recommendation_efficacy_immutable on build3_recommendation_efficacy;\ncreate trigger trg_build3_recommendation_efficacy_immutable\nbefore update or delete on build3_recommendation_efficacy\nfor each row execute function prevent_build3_recommendation_efficacy_mutation();\n"
  }
] as const;


export type Build3SchemaStatus={
  version:typeof BUILD3_SCHEMA_VERSION;
  ready:boolean;
  missing_tables:string[];
  missing_columns:string[];
};

export function splitBuild3MigrationStatements(source:string):string[]{
  const out:string[]=[];
  let start=0;
  let i=0;
  let single=false;
  let double=false;
  let lineComment=false;
  let blockComment=false;
  let dollar:string|null=null;
  while(i<source.length){
    if(lineComment){
      if(source[i]==='\n')lineComment=false;
      i++;continue;
    }
    if(blockComment){
      if(source[i]==='*'&&source[i+1]==='/'){blockComment=false;i+=2;continue;}
      i++;continue;
    }
    if(dollar){
      if(source.startsWith(dollar,i)){i+=dollar.length;dollar=null;continue;}
      i++;continue;
    }
    const ch=source[i],next=source[i+1];
    if(single){
      if(ch==="'"&&next==="'"){i+=2;continue;}
      if(ch==="'")single=false;
      i++;continue;
    }
    if(double){
      if(ch==='"'&&next==='"'){i+=2;continue;}
      if(ch==='"')double=false;
      i++;continue;
    }
    if(ch==='-'&&next==='-'){lineComment=true;i+=2;continue;}
    if(ch==='/'&&next==='*'){blockComment=true;i+=2;continue;}
    if(ch==="'"){single=true;i++;continue;}
    if(ch==='"'){double=true;i++;continue;}
    if(ch==='$'){
      const match=source.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if(match){dollar=match[0];i+=dollar.length;continue;}
    }
    if(ch===';'){
      const statement=source.slice(start,i).trim();
      if(statement)out.push(statement);
      start=i+1;
    }
    i++;
  }
  const tail=source.slice(start).trim();
  if(tail)out.push(tail);
  return out;
}

export async function readBuild3SchemaStatus(databaseUrl:string|undefined):Promise<Build3SchemaStatus>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_SCHEMA_DATABASE_NOT_CONFIGURED');
  const sql=neon(databaseUrl);
  const tablePlaceholders=BUILD3_SCHEMA_TABLES.map((_,index)=>'$'+(index+1)).join(',');
  const tableRows=await sql.query(
    "select name,to_regclass('public.'||name) as relation from unnest(array["+tablePlaceholders+"]::text[]) as name",
    [...BUILD3_SCHEMA_TABLES],
  );
  const presentTables=new Set(tableRows.filter((row:any)=>row.relation!==null).map((row:any)=>String(row.name)));
  const missingTables=BUILD3_SCHEMA_TABLES.filter(table=>!presentTables.has(table));

  const requiredPairs=BUILD3_SCHEMA_REQUIRED_COLUMNS.map(([table,column])=>table+'.'+column);
  const columnRows=await sql`
    select table_name,column_name
      from information_schema.columns
     where table_schema='public'
       and table_name in ('build3_decisions','build3_precision_outcomes','build3_recommendation_efficacy')
  `;
  const presentColumns=new Set(columnRows.map((row:any)=>String(row.table_name)+'.'+String(row.column_name)));
  const missingColumns=requiredPairs.filter(pair=>!presentColumns.has(pair));
  return {
    version:BUILD3_SCHEMA_VERSION,
    ready:missingTables.length===0&&missingColumns.length===0,
    missing_tables:[...missingTables],
    missing_columns:[...missingColumns],
  };
}

export async function applyBuild3Schema(databaseUrl:string|undefined){
  const before=await readBuild3SchemaStatus(databaseUrl);
  if(before.ready)return {status:'ALREADY_READY' as const,before,after:before,statements_executed:0};
  if(!databaseUrl?.trim())throw new Error('BUILD3_SCHEMA_DATABASE_NOT_CONFIGURED');
  const sql=neon(databaseUrl);
  const statements=BUILD3_SCHEMA_MIGRATIONS.flatMap(migration=>splitBuild3MigrationStatements(migration.sql));
  const queries=statements.map(statement=>sql`${sql.unsafe(statement)}`);
  await sql.transaction(queries);
  const after=await readBuild3SchemaStatus(databaseUrl);
  if(!after.ready)throw new Error('BUILD3_SCHEMA_APPLY_INCOMPLETE:'+JSON.stringify(after));
  return {status:'APPLIED' as const,before,after,statements_executed:statements.length};
}
