-- G6/Core Zone SHADOW persistence only.
-- Additive and production-isolated: no production EDGE methodology, recommendation,
-- tradeability, canonical selection, efficacy population, or trading table is changed.

CREATE TABLE IF NOT EXISTS core_zone_shadow_runs (
  shadow_run_id TEXT PRIMARY KEY,
  engine TEXT NOT NULL CHECK (engine IN ('5DR', 'EDGE_STOCKS')),
  source_run_id TEXT NOT NULL,
  source_report_hash TEXT NOT NULL,
  evidence_snapshot_id TEXT NOT NULL,
  spec_version TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  horizons JSONB NOT NULL,
  payload JSONB NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  production_isolated BOOLEAN NOT NULL DEFAULT TRUE CHECK (production_isolated = TRUE),
  automatic_observation BOOLEAN NOT NULL DEFAULT TRUE CHECK (automatic_observation = TRUE),
  automatic_promotion BOOLEAN NOT NULL DEFAULT FALSE CHECK (automatic_promotion = FALSE),
  user_decision_required TEXT NOT NULL DEFAULT 'APPROVE_REJECT_DEFER' CHECK (user_decision_required = 'APPROVE_REJECT_DEFER'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (horizons = '["D","D+1","D+2","D+3","D+4"]'::jsonb),
  CHECK (NOT (horizons ? 'D+5'))
);

CREATE UNIQUE INDEX IF NOT EXISTS core_zone_shadow_source_engine_uq
  ON core_zone_shadow_runs (source_run_id, engine, spec_version);

CREATE INDEX IF NOT EXISTS core_zone_shadow_issued_idx
  ON core_zone_shadow_runs (engine, issued_at DESC);

COMMENT ON TABLE core_zone_shadow_runs IS
  'G6 additive SHADOW-only Core Zone outputs. Never a production recommendation or official efficacy population.';
