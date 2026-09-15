import assert from 'node:assert/strict';
import test from 'node:test';
import { canAdvanceIntelligenceHandoff, validateIntelligenceHandoff } from '../src/intelligence-contract';

const normalized = {
  regime: 'TREND', component_scores: {}, market_trust_inputs: {}, event_shock: 0,
  execution_inputs: {}, data_adequate: true, event_kill_switch: false,
  expected_rr: 2, horizon_slots: { 'D+1': {}, 'D+2': {}, 'D+3': {}, 'D+4': {}, 'D+5': {} },
};

const observations = [
  ['PRICE_TECHNICALS', 'SCREENSHOT'], ['DERIVATIVES_OI', 'SCREENSHOT'],
  ['MARKET_TRUST', 'WEB_RESEARCH'], ['EVENT_SHOCK', 'WEB_RESEARCH'], ['EXECUTION_RISK', 'WEB_RESEARCH'],
].map(([category, source_kind]) => ({
  category, source_kind, source_ref: `test://${category}`, observed_at: '2026-09-15T10:00:00Z',
  retrieved_at: '2026-09-15T10:01:00Z', verification: 'VERIFIED',
}));

const packet = () => ({ producer: 'test-intelligence', producer_version: '1', request_id: '5drreq_test', observations, normalized });

test('complete provenance-bearing nine-input packet is ready', () => {
  assert.deepEqual(validateIntelligenceHandoff(packet()), []);
  assert.equal(canAdvanceIntelligenceHandoff(packet()).ready, true);
});

test('missing screenshot family blocks', () => {
  const body = packet();
  body.observations = body.observations.filter(item => item.category !== 'DERIVATIVES_OI');
  assert.ok(validateIntelligenceHandoff(body).includes('missing intelligence observation category DERIVATIVES_OI'));
});

test('missing normalized input blocks', () => {
  const body: any = packet();
  delete body.normalized.expected_rr;
  assert.ok(validateIntelligenceHandoff(body).includes('missing normalized input expected_rr'));
});

test('unavailable required intelligence blocks', () => {
  const body = packet();
  body.observations[2] = { ...body.observations[2], verification: 'UNAVAILABLE' };
  assert.equal(canAdvanceIntelligenceHandoff(body).ready, false);
});

test('degraded evidence is surfaced explicitly', () => {
  const body = packet();
  body.observations[2] = { ...body.observations[2], verification: 'DEGRADED' };
  assert.deepEqual(canAdvanceIntelligenceHandoff(body), { ready: true, errors: [], degraded: true });
});
