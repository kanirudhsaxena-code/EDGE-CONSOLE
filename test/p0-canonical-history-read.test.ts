import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('production entry routes P0-12 canonical history before legacy handlers', () => {
  const entry = readFileSync('src/production-entry.ts', 'utf8');
  assert.match(entry, /handleP0CanonicalHistoryRead/);
  assert.match(entry, /const p0CanonicalHistory = await handleP0CanonicalHistoryRead\(request, env\)/);
  assert.match(entry, /if \(p0CanonicalHistory\) return p0CanonicalHistory/);
});

test('P0-12 exposes one governed cross-engine canonical history contract with isolated stores', () => {
  const source = readFileSync('src/p0-canonical-history-read.ts', 'utf8');
  assert.match(source, /\/api\/canonical-history/);
  assert.match(source, /CANONICAL_READ_V1/);
  assert.match(source, /FIVEDR_DATABASE_URL/);
  assert.match(source, /EDGE_DATABASE_URL/);
  assert.match(source, /IPO_DATABASE_URL/);
  assert.match(source, /reconstructed_from_latest_run: false/);
  assert.match(source, /inferred_from_workflow_name: false/);
  assert.match(source, /fail_closed: true/);
});

test('5DR history uses the canonical database rather than Console DATABASE_URL', () => {
  const source = readFileSync('src/p0-canonical-history-read.ts', 'utf8');
  const fn = source.slice(source.indexOf('async function fiveDrHistory'), source.indexOf('async function edgeStocksHistory'));
  assert.match(fn, /env\.FIVEDR_DATABASE_URL/);
  assert.match(fn, /neon\(env\.FIVEDR_DATABASE_URL\)/);
  assert.doesNotMatch(fn, /neon\(env\.DATABASE_URL\)/);
  assert.match(fn, /5DR canonical database is not configured on the Console read gateway/);
});

test('5DR resolves immutable canonical selection before reading forecast detail', () => {
  const source = readFileSync('src/p0-canonical-history-read.ts', 'utf8');
  const fn = source.slice(source.indexOf('async function fiveDrHistory'), source.indexOf('async function edgeStocksHistory'));
  assert.match(fn, /from canonical_selections/);
  assert.match(fn, /selected_forecast_id=\$\{forecastId\}/);
  assert.match(fn, /target_trading_date=\$\{tradingDate\}/);
  assert.match(fn, /NO_VALID_CANDIDATE is preserved as the immutable canonical state and is never backfilled/);
  assert.match(fn, /selected_for_headline_efficacy: false/);
});

test('5DR exact forecast ID can be audited without being promoted into canonical efficacy', () => {
  const source = readFileSync('src/p0-canonical-history-read.ts', 'utf8');
  const fn = source.slice(source.indexOf('async function fiveDrHistory'), source.indexOf('async function edgeStocksHistory'));
  assert.match(fn, /from forecast_governance fg/);
  assert.match(fn, /status: 'NON_SELECTED_CANDIDATE'/);
  assert.match(fn, /exact_candidate_identity: forecastId/);
  assert.match(fn, /Candidate is preserved for audit but is not a selected canonical/);
});

test('5DR exact selected history returns persisted forecast, D1-D5, components, execution and efficacy', () => {
  const source = readFileSync('src/p0-canonical-history-read.ts', 'utf8');
  const fn = source.slice(source.indexOf('async function fiveDrHistory'), source.indexOf('async function edgeStocksHistory'));
  assert.match(fn, /from forecasts f/);
  assert.match(fn, /join runs r/);
  assert.match(fn, /left join forecast_governance/);
  assert.match(fn, /left join lineage_deltas/);
  assert.match(fn, /from daily_forecasts/);
  assert.match(fn, /order by day_number/);
  assert.match(fn, /from component_scores/);
  assert.match(fn, /from execution_plans/);
  assert.match(fn, /from forecast_checkpoint_evaluations/);
  assert.match(fn, /from recommendation_events/);
  assert.match(fn, /from assessment_snapshots/);
  assert.match(fn, /PENDING_SCHEMA_BOUND_ADAPTER/);
  assert.match(fn, /NOT_AVAILABLE_UNTIL_P0_11/);
});

test('EDGE Stocks historical retrieval resolves selected canonical identity before detail', () => {
  const source = readFileSync('src/p0-canonical-history-read.ts', 'utf8');
  assert.match(source, /from edge_canonical_selections/);
  assert.match(source, /selected_recommendation_id=\$\{recommendationId\}/);
  assert.match(source, /target_trading_date=\$\{tradingDate\}/);
  assert.match(source, /Ambiguous canonical identity/);
  assert.match(source, /CANONICAL_MISSED is preserved as a governed historical state/);
  assert.doesNotMatch(source, /order by r\.run_timestamp desc[\s\S]*limit 1/);
});

test('EDGE Stocks exact history includes analytical, evidence, execution and outcome lineage', () => {
  const source = readFileSync('src/p0-canonical-history-read.ts', 'utf8');
  assert.match(source, /from recommendations r/);
  assert.match(source, /edge_recommendation_governance/);
  assert.match(source, /from component_scores/);
  assert.match(source, /from execution_plans/);
  assert.match(source, /recommendation_evidence/);
  assert.match(source, /join evidence_items/);
  assert.match(source, /recommendation_research_bundle/);
  assert.match(source, /join edge_research_bundles/);
  assert.match(source, /from outcome_checkpoints/);
  assert.match(source, /left join efficacy_results/);
  assert.match(source, /presentation_snapshot: false/);
  assert.match(source, /NOT_AVAILABLE_UNTIL_P0_11/);
});

test('P0-12 read gateway is additive and cannot mutate canonical or efficacy state', () => {
  const source = readFileSync('src/p0-canonical-history-read.ts', 'utf8');
  assert.doesNotMatch(source, /insert\s+into/i);
  assert.doesNotMatch(source, /update\s+(canonical_selections|edge_canonical_selections|forecasts|recommendations|recommendation_performance|efficacy_results)/i);
  assert.doesNotMatch(source, /delete\s+from/i);
});

test('remaining IPO adapter fails closed instead of substituting data', () => {
  const source = readFileSync('src/p0-canonical-history-read.ts', 'utf8');
  assert.match(source, /engine === 'IPO_EDGE' \|\| engine === 'IPO'/);
  assert.match(source, /CANONICAL_READ_V1 route for this engine is not implemented yet/);
  assert.match(source, /501/);
  assert.match(source, /supported_engines: \['5DR', 'EDGE_STOCKS', 'IPO_EDGE'\]/);
});
