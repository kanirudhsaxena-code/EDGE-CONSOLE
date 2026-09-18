-- EDGE Console UI Adaptive Modular Refresh V1
-- Cumulative assessment rollups are intentionally separate from run-scoped outcome_assessments.
-- The authoritative engine may use forecast IDs that are not Console analysis_run IDs.

CREATE TABLE IF NOT EXISTS public.assessment_rollups (
  id BIGSERIAL PRIMARY KEY,
  engine TEXT NOT NULL,
  source_id TEXT NOT NULL,
  assessed_at TIMESTAMPTZ NOT NULL,
  headline TEXT,
  score NUMERIC,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(engine, source_id, assessed_at)
);

CREATE INDEX IF NOT EXISTS idx_assessment_rollups_engine_latest
  ON public.assessment_rollups(engine, assessed_at DESC, id DESC);
