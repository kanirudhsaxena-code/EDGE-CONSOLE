import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('production entry routes engine-specific P0-12 adapters before legacy handlers', () => {
  const entry = readFileSync('src/production-entry.ts', 'utf8');
  const fiveDrPos = entry.indexOf('handleP05drCanonicalHistoryRead(request, env)');
  const ipoPos = entry.indexOf('handleP0IpoCanonicalHistoryRead(request, env)');
  const stocksPos = entry.indexOf('handleP0CanonicalHistoryRead(request, env)');
  assert.ok(fiveDrPos >= 0);
  assert.ok(ipoPos > fiveDrPos);
  assert.ok(stocksPos > ipoPos);
});

test('5DR exact history uses isolated canonical store and common CANONICAL_READ_V1 contract', () => {
  const source = readFileSync('src/p0-5dr-canonical-history-read.ts', 'utf8');
  assert.match(source, /\/api\/canonical-history/);
  assert.match(source, /CANONICAL_READ_V1/);
  assert.match(source, /env\.FIVEDR_DATABASE_URL/);
  assert.match(source, /neon\(env\.FIVEDR_DATABASE_URL\)/);
  assert.doesNotMatch(source, /(?:^|\s)DATABASE_URL\?:/m);
  assert.match(source, /reconstructed_from_latest_run: false/);
  assert.match(source, /inferred_from_workflow_name: false/);
  assert.match(source, /fail_closed: true/);
});

test('5DR resolves immutable canonical selection before reading forecast detail', () => {
  const source = readFileSync('src/p0-5dr-canonical-history-read.ts', 'utf8');
  assert.match(source, /from canonical_selections/);
  assert.match(source, /selected_forecast_id=\$\{forecastId\}/);
  assert.match(source, /target_trading_date=\$\{tradingDate\}/);
  assert.match(source, /NO_VALID_CANDIDATE is preserved as the immutable canonical state and is never backfilled/);
  assert.match(source, /selected_for_headline_efficacy: false/);
});

test('5DR exact non-selected forecast remains audit-only', () => {
  const source = readFileSync('src/p0-5dr-canonical-history-read.ts', 'utf8');
  assert.match(source, /from forecast_governance fg/);
  assert.match(source, /status: 'NON_SELECTED_CANDIDATE'/);
  assert.match(source, /exact_candidate_identity: forecastId/);
  assert.match(source, /cannot enter canonical efficacy/);
});

test('5DR selected history uses production-schema verified evidence and efficacy relations', () => {
  const source = readFileSync('src/p0-5dr-canonical-history-read.ts', 'utf8');
  assert.match(source, /from forecasts f/);
  assert.match(source, /join runs r/);
  assert.match(source, /left join forecast_governance/);
  assert.match(source, /from lineage_deltas/);
  assert.match(source, /from daily_forecasts/);
  assert.match(source, /from component_scores/);
  assert.match(source, /from execution_plans/);
  assert.match(source, /from forecast_evidence fe/);
  assert.match(source, /join evidence_items e on e\.evidence_id=fe\.evidence_id/);
  assert.match(source, /from forecast_checkpoint_evaluations/);
  assert.match(source, /from recommendation_events/);
  assert.match(source, /order by event_timestamp,event_id/);
  assert.match(source, /from assessment_snapshots/);
  assert.match(source, /assessment_snapshot_id desc/);
  assert.doesNotMatch(source, /order by observed_at,event_id/);
  assert.doesNotMatch(source, /snapshot_id desc/);
  assert.doesNotMatch(source, /PENDING_SCHEMA_BOUND_ADAPTER/);
});

test('5DR canonical type comes from persisted canonical selection rule, not timing class or workflow names', () => {
  const source = readFileSync('src/p0-5dr-canonical-history-read.ts', 'utf8');
  assert.match(source, /canonical\.selection_rule/);
  assert.match(source, /source: 'canonical_selections\.selection_rule'/);
  assert.match(source, /timing_class/);
  assert.match(source, /source: runClass \? 'forecast_governance\.run_class'/);
  assert.match(source, /inferred_from_workflow_name: false/);
  assert.doesNotMatch(source, /\bgithub\b/i);
  assert.doesNotMatch(source, /(?:^|[^A-Za-z0-9_])workflow_name\s*[:=]/i);
});

test('EDGE Stocks fallback reader contains no duplicate NIFTY or IPO database implementation', () => {
  const source = readFileSync('src/p0-canonical-history-read.ts', 'utf8');
  assert.match(source, /EDGE_DATABASE_URL/);
  assert.doesNotMatch(source, /FIVEDR_DATABASE_URL/);
  assert.doesNotMatch(source, /IPO_DATABASE_URL/);
  assert.doesNotMatch(source, /canonical_selections\b/);
  assert.doesNotMatch(source, /T2_FINAL_DAY/);
});

test('EDGE Stocks historical retrieval resolves selected canonical identity before detail', () => {
  const source = readFileSync('src/p0-canonical-history-read.ts', 'utf8');
  assert.match(source, /from edge_canonical_selections/);
  assert.match(source, /selected_recommendation_id=\$\{recommendationId\}/);
  assert.match(source, /target_trading_date=\$\{tradingDate\}/);
  assert.match(source, /Ambiguous canonical identity/);
  assert.match(source, /CANONICAL_MISSED is preserved as a governed historical state/);
});

test('EDGE Stocks exact history includes analytical, evidence, research, execution and outcome lineage', () => {
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
  assert.match(source, /NOT_AVAILABLE_UNTIL_P0_11/);
});

test('all P0-12 canonical readers remain read-only', () => {
  const sources = [
    readFileSync('src/p0-5dr-canonical-history-read.ts', 'utf8'),
    readFileSync('src/p0-canonical-history-read.ts', 'utf8'),
    readFileSync('src/p0-ipo-canonical-history-read.ts', 'utf8'),
  ];
  for (const source of sources) {
    assert.doesNotMatch(source, /insert\s+into/i);
    assert.doesNotMatch(source, /delete\s+from/i);
  }
});
