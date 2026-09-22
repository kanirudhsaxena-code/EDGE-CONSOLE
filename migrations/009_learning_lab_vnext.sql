-- MDOS VNext G3: additive Learning Lab read model and immutable governance records.
-- This migration does not alter production engine configuration, canonical selection, or official efficacy tables.

CREATE TABLE IF NOT EXISTS learning_observations_vnext (
  id bigserial PRIMARY KEY,
  observation_id text NOT NULL UNIQUE,
  engine text NOT NULL REFERENCES engine_registry(engine),
  source_run_id text NOT NULL,
  run_role text NOT NULL CHECK (run_role IN ('CANONICAL','DIAGNOSTIC','MANUAL','SHADOW')),
  official_efficacy_eligible boolean NOT NULL DEFAULT false,
  target_trading_date date NOT NULL,
  horizon text NOT NULL,
  dimension text NOT NULL,
  observation_type text NOT NULL,
  outcome_classification text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  exclusion_reason text,
  observed_at timestamptz NOT NULL,
  source_ref text NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (official_efficacy_eligible OR exclusion_reason IS NOT NULL OR run_role = 'CANONICAL')
);

CREATE INDEX IF NOT EXISTS learning_observations_vnext_engine_target_idx
  ON learning_observations_vnext(engine, target_trading_date DESC, observed_at DESC);
CREATE INDEX IF NOT EXISTS learning_observations_vnext_run_idx
  ON learning_observations_vnext(engine, source_run_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS learning_daily_snapshots_vnext (
  id bigserial PRIMARY KEY,
  snapshot_id text NOT NULL UNIQUE,
  engine text NOT NULL REFERENCES engine_registry(engine),
  cycle_id text NOT NULL,
  as_of timestamptz NOT NULL,
  snapshot_status text NOT NULL CHECK (snapshot_status IN ('COMPLETE','PARTIAL')),
  runs_analyzed integer NOT NULL CHECK (runs_analyzed >= 0),
  canonical_runs integer NOT NULL CHECK (canonical_runs >= 0),
  diagnostic_runs integer NOT NULL CHECK (diagnostic_runs >= 0),
  manual_runs integer NOT NULL CHECK (manual_runs >= 0),
  shadow_runs integer NOT NULL CHECK (shadow_runs >= 0),
  matured_outcomes integer NOT NULL CHECK (matured_outcomes >= 0),
  scorable_outcomes integer NOT NULL CHECK (scorable_outcomes >= 0),
  data_gap_outcomes integer NOT NULL CHECK (data_gap_outcomes >= 0),
  new_observations integer NOT NULL CHECK (new_observations >= 0),
  active_hypotheses integer NOT NULL CHECK (active_hypotheses >= 0),
  active_challengers integer NOT NULL CHECK (active_challengers >= 0),
  approval_required integer NOT NULL CHECK (approval_required >= 0),
  data_quality_state text NOT NULL,
  methodology_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_lineage jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(engine, cycle_id),
  CHECK (canonical_runs + diagnostic_runs + manual_runs + shadow_runs <= runs_analyzed),
  CHECK (scorable_outcomes + data_gap_outcomes <= matured_outcomes)
);

CREATE INDEX IF NOT EXISTS learning_daily_snapshots_vnext_engine_asof_idx
  ON learning_daily_snapshots_vnext(engine, as_of DESC, id DESC);

CREATE TABLE IF NOT EXISTS learning_hypotheses_vnext (
  id bigserial PRIMARY KEY,
  hypothesis_id text NOT NULL UNIQUE,
  engine text NOT NULL REFERENCES engine_registry(engine),
  dimension text NOT NULL,
  status text NOT NULL CHECK (status IN ('OBSERVING','HYPOTHESIS','CANDIDATE','VALIDATING','PENDING_USER_APPROVAL','APPROVED_FOR_BUILD','REJECTED','DEFERRED')),
  title text NOT NULL,
  hypothesis jsonb NOT NULL,
  source_population jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_hypotheses_vnext_engine_status_idx
  ON learning_hypotheses_vnext(engine, status, created_at DESC);

CREATE TABLE IF NOT EXISTS learning_candidates_vnext (
  id bigserial PRIMARY KEY,
  candidate_id text NOT NULL UNIQUE,
  engine text NOT NULL REFERENCES engine_registry(engine),
  hypothesis_id text REFERENCES learning_hypotheses_vnext(hypothesis_id),
  status text NOT NULL CHECK (status IN ('CANDIDATE','VALIDATING','PENDING_USER_APPROVAL','APPROVED_FOR_BUILD','REJECTED','DEFERRED')),
  proposal jsonb NOT NULL,
  baseline_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  challenger_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  automatic_adoption boolean NOT NULL DEFAULT false CHECK (automatic_adoption = false),
  production_change_allowed boolean NOT NULL DEFAULT false CHECK (production_change_allowed = false),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_candidates_vnext_engine_status_idx
  ON learning_candidates_vnext(engine, status, created_at DESC);

CREATE TABLE IF NOT EXISTS learning_approval_events_vnext (
  id bigserial PRIMARY KEY,
  approval_event_id text NOT NULL UNIQUE,
  candidate_id text NOT NULL REFERENCES learning_candidates_vnext(candidate_id),
  candidate_hash text NOT NULL,
  action text NOT NULL CHECK (action IN ('APPROVE','REJECT','DEFER')),
  prior_status text NOT NULL CHECK (prior_status = 'PENDING_USER_APPROVAL'),
  new_status text NOT NULL CHECK (new_status IN ('APPROVED_FOR_BUILD','REJECTED','DEFERRED')),
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL,
  decision_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (action = 'APPROVE' AND new_status = 'APPROVED_FOR_BUILD') OR
    (action = 'REJECT' AND new_status = 'REJECTED') OR
    (action = 'DEFER' AND new_status = 'DEFERRED')
  )
);

CREATE INDEX IF NOT EXISTS learning_approval_events_vnext_candidate_idx
  ON learning_approval_events_vnext(candidate_id, decided_at DESC);

COMMENT ON TABLE learning_observations_vnext IS 'Immutable VNext Learning Lab evidence. Not an official efficacy population by itself.';
COMMENT ON TABLE learning_daily_snapshots_vnext IS 'Immutable daily Learning Lab read model; production forecast release is independent.';
COMMENT ON TABLE learning_candidates_vnext IS 'Governed challenger candidates; records cannot authorize production mutation.';
COMMENT ON TABLE learning_approval_events_vnext IS 'User governance decisions. APPROVE authorizes build/validation only, not production promotion.';
