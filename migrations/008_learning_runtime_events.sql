-- Shared MDOS Learning Lab governance ledger.
-- Engine methodologies and engine-specific learning tables remain authoritative.
CREATE TABLE IF NOT EXISTS learning_runtime_events (
  id bigserial PRIMARY KEY,
  event_id text NOT NULL UNIQUE,
  engine text NOT NULL REFERENCES engine_registry(engine),
  cycle_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'DEFERRED','OBSERVING','CANDIDATE','VALIDATING',
    'APPROVAL_REQUIRED','ADOPTED','REJECTED'
  )),
  sample_size integer NOT NULL CHECK (sample_size >= 0),
  candidate_count integer NOT NULL CHECK (candidate_count >= 0),
  source_ref text NOT NULL,
  occurred_at timestamptz NOT NULL,
  automatic_adoption boolean NOT NULL DEFAULT false CHECK (automatic_adoption = false),
  methodology_changed boolean NOT NULL DEFAULT false CHECK (methodology_changed = false),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_runtime_events_engine_time_idx
  ON learning_runtime_events(engine, occurred_at DESC);
