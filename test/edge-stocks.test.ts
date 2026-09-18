import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEdgeStocksResult } from '../src/edge-stocks';

const base = {
  contract_version: 'EDGE_STOCKS_V1_2',
  engine: 'EDGE_STOCKS',
  framework_version: 'EDGE_V1',
  ticker: 'LTF',
  run_id: 'EDGE-LTF-20260917-01',
  generated_at: '2026-09-17T11:17:00.000Z',
  presentation: {
    standard_table_count: 2,
    table_1: 'EDGE_OUTCOME_DECISION',
    table_2: 'INSTITUTIONAL_DRILLDOWN',
    efficacy_position: 'SEPARATE_AFTER_STANDARD_TABLES'
  },
  decision: {
    des: 43.1,
    market_trust: { score: 92.97, band: 'VERY HIGH' },
    directional_agreement: 88,
    effective_conviction: 0.4007,
    probabilities: { bull: 43.1, base: 55.3, bear: 1.6 },
    definitive_forecast: 'BASE_RANGE',
    expected_price_zone: { low: 298, high: 315 },
    forecast_horizon: 'D+1 to D+5',
    risk_override: { status: 'CLEAR', code: null },
    primary_action: 'HOLD',
    decision_ladder: 'WATCHLIST',
    bot: { score: 65.8, grade: 'B' },
    execution: { instrument: 'NONE' }
  },
  official_efficacy: {
    label: 'OFFICIAL',
    sample_size: 0,
    recommendation_hit_rate_pct: null,
    directional_accuracy_pct: null,
    forecast_accuracy_pct: null
  },
  provisional_checkpoint_diagnostics: {
    label: 'PROVISIONAL',
    captured_checkpoints: 3,
    forecast_scorable: 3,
    forecast_hits: 2,
    forecast_misses: 1,
    forecast_accuracy_pct: 66.7,
    zone_scorable: 3,
    zone_hits: 3,
    zone_misses: 0,
    zone_accuracy_pct: 100.0,
    latest_checkpoint_observed_at: '2026-09-17T11:17:00.000Z'
  },
  institutional_drilldown: [{
    component: 'Price Structure',
    score_or_level: 1,
    verification_status: 'VERIFIED',
    key_outcome: 'AVAILABLE',
    interpretation: 'Structure evidence verified.'
  }]
};

test('valid EDGE Stocks V1.2 report passes', () => {
  assert.deepEqual(validateEdgeStocksResult(base), []);
});

test('standard presentation must contain exactly two tables', () => {
  const bad = structuredClone(base);
  bad.presentation.standard_table_count = 3;
  assert.ok(validateEdgeStocksResult(bad).some(x => x.includes('exactly 2')));
});

test('official efficacy cannot be populated with zero closed sample', () => {
  const bad = structuredClone(base);
  bad.official_efficacy.recommendation_hit_rate_pct = 66.7;
  assert.ok(validateEdgeStocksResult(bad).some(x => x.includes('must be null when sample_size is 0')));
});

test('provisional label is mandatory', () => {
  const bad = structuredClone(base);
  bad.provisional_checkpoint_diagnostics.label = 'OFFICIAL';
  assert.ok(validateEdgeStocksResult(bad).some(x => x.includes('label must be PROVISIONAL')));
});

test('probabilities must sum to 100 within 0.01', () => {
  const bad = structuredClone(base);
  bad.decision.probabilities = { bull: 50, base: 50, bear: 0.02 };
  assert.ok(validateEdgeStocksResult(bad).some(x => x.includes('sum to 100')));
});

test('verification status is mandatory and bounded', () => {
  const bad = structuredClone(base);
  bad.institutional_drilldown[0].verification_status = 'ASSUMED';
  assert.ok(validateEdgeStocksResult(bad).some(x => x.includes('verification_status is invalid')));
});

test('risk override code is mandatory only when active', () => {
  const bad = structuredClone(base);
  bad.decision.risk_override = { status: 'ACTIVE', code: null };
  assert.ok(validateEdgeStocksResult(bad).some(x => x.includes('code is mandatory when ACTIVE')));
});
