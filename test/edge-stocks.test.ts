import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEdgeStocksResult } from '../src/edge-stocks';

const base = {
  contract_version: 'EDGE_STOCKS_V1_1',
  engine: 'EDGE_STOCKS',
  framework_version: 'EDGE_V1',
  ticker: 'LTF',
  run_id: 'EDGE-LTF-20260917-01',
  generated_at: '2026-09-17T11:17:00.000Z',
  decision: {
    forecast: 'BASE_RANGE',
    probabilities: { bull: 43.1, base: 55.3, bear: 1.6 },
    expected_zone: { low: 298, high: 315 },
    market_trust: { score: 92.97, band: 'VERY HIGH' },
    bot: { score: 65.8, grade: 'B' },
    recommendation: 'HOLD existing delivery; NO OPTION TRADE',
    execution: { instrument: 'NONE' }
  },
  official_efficacy: {
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
  institutional_drilldown: []
};

test('valid EDGE Stocks report passes', () => {
  assert.deepEqual(validateEdgeStocksResult(base), []);
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

test('probabilities must approximately sum to 100', () => {
  const bad = structuredClone(base);
  bad.decision.probabilities = { bull: 50, base: 50, bear: 20 };
  assert.ok(validateEdgeStocksResult(bad).some(x => x.includes('sum to approximately 100')));
});
