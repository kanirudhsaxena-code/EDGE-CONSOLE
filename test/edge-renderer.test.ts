import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEdgeV12 } from '../public/edge-live.js';

const report = {
  contract_version: 'EDGE_STOCKS_V1_2',
  presentation: { standard_table_count: 2 },
  ticker: 'LTF',
  run_id: 'EDGE-LTF-20260918-01',
  decision: {
    des: 42.5,
    market_trust: { score: 91.2, band: 'VERY HIGH' },
    directional_agreement: 84,
    effective_conviction: 0.3876,
    probabilities: { bull: 44, base: 54, bear: 2 },
    definitive_forecast: 'BASE_RANGE',
    expected_price_zone: { low: 300, high: 315 },
    forecast_horizon: 'D+1 to D+5',
    risk_override: { status: 'CLEAR', code: null },
    primary_action: 'HOLD',
    decision_ladder: 'WATCHLIST',
    bot: { score: 66, grade: 'B' },
    execution: { instrument: 'NONE', entry_low: null, entry_high: null, stop_price: null, target1: null, target2: null, time_exit: 'D+5' },
    current_price: 304
  },
  official_efficacy: {
    label: 'OFFICIAL', sample_size: 3, recommendation_hit_rate_pct: 66.7,
    directional_accuracy_pct: 66.7, forecast_accuracy_pct: 66.7
  },
  provisional_checkpoint_diagnostics: {
    label: 'PROVISIONAL', forecast_accuracy_pct: 75, forecast_hits: 3, forecast_scorable: 4,
    zone_accuracy_pct: 50, zone_hits: 2, zone_scorable: 4
  },
  institutional_drilldown: [
    { component: 'Price Structure', score_or_level: 1, verification_status: 'VERIFIED', key_outcome: 'AVAILABLE', interpretation: 'Constructive structure.' },
    { component: 'Derivatives', score_or_level: 'N/A', verification_status: 'NOT_VERIFIED', key_outcome: 'NOT_VERIFIED', interpretation: 'No verified chain evidence.' }
  ]
};

test('V1.2 renderer produces exactly the two canonical table captions', () => {
  const html = renderEdgeV12(report, { open_recommendations: 1 });
  assert.equal((html.match(/<table /g) || []).length, 2);
  assert.match(html, /Table 1 — EDGE Outcome \/ Decision/);
  assert.match(html, /Table 2 — Institutional Drill-down/);
});

test('V1.2 renderer exposes governed decision values', () => {
  const html = renderEdgeV12(report, {});
  for (const expected of ['Primary action','HOLD','DES','Market Trust','Directional agreement','Effective conviction','Decision Ladder','Risk override']) {
    assert.ok(html.includes(expected), expected);
  }
});

test('V1.2 renderer keeps efficacy outside standard tables', () => {
  const html = renderEdgeV12(report, {});
  const secondTableEnd = html.lastIndexOf('</table>');
  const efficacy = html.indexOf('Efficacy — separate from the two standard tables');
  assert.ok(efficacy > secondTableEnd);
  assert.match(html, /OFFICIAL recommendation hit rate/);
  assert.match(html, /PROVISIONAL forecast accuracy/);
});

test('V1.2 renderer surfaces verification state', () => {
  const html = renderEdgeV12(report, {});
  assert.match(html, /VERIFIED/);
  assert.match(html, /NOT_VERIFIED/);
});

test('renderer fails closed for legacy contract', () => {
  const legacy = structuredClone(report);
  legacy.contract_version = 'EDGE_STOCKS_V1_1';
  assert.throws(() => renderEdgeV12(legacy, {}), /contract mismatch/);
});

test('renderer fails closed when drill-down is empty', () => {
  const bad = structuredClone(report);
  bad.institutional_drilldown = [];
  assert.throws(() => renderEdgeV12(bad, {}), /drill-down unavailable/);
});
