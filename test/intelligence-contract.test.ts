import assert from 'node:assert/strict';
import test from 'node:test';
import { canAdvanceIntelligenceHandoff, validateIntelligenceHandoff } from '../src/intelligence-contract';

const makeNormalized = () => ({
  regime: 'TREND',
  component_scores: {PRICE_STRUCTURE:20,PVPO:10,PARTICIPATION:0,MACRO_CATALYSTS:-10},
  market_trust_inputs: {price_confirmation:70,pvpo_confirmation:65,participation_confirmation:55,cross_engine_consistency:65,closing_confirmation:70,evidence_freshness_completeness:90},
  event_shock: 'LOW', event_transmission:'TWO_SIDED', convexity_warranted:false,
  execution_inputs: {rr_score:80,premium_iv_theta_score:70,strike_expiry_fit_score:75,liquidity_spread_score:85,entry_invalidation_score:75},
  data_adequate: true, event_kill_switch: false,
  expected_rr: 2, horizon_slots: {
    'D+1': {direction:'BULLISH',probabilities:{BULL:50,RANGE:35,BEAR:15},zone_low:23000,zone_high:23300,basis:'Price structure'},
    'D+2': {direction:'BULLISH',probabilities:{BULL:48,RANGE:37,BEAR:15},zone_low:22950,zone_high:23400,basis:'Price structure'},
    'D+3': {direction:'RANGE',probabilities:{BULL:25,RANGE:55,BEAR:20},zone_low:22900,zone_high:23450,basis:'Mixed confirmation'},
    'D+4': {direction:'RANGE',probabilities:{BULL:23,RANGE:54,BEAR:23},zone_low:22850,zone_high:23500,basis:'Mixed confirmation'},
    'D+5': {direction:'RANGE',probabilities:{BULL:24,RANGE:53,BEAR:23},zone_low:22800,zone_high:23550,basis:'Wider uncertainty'}
  },
});

const makeObservations = () => [
  ['PRICE_TECHNICALS', 'SCREENSHOT'], ['DERIVATIVES_OI', 'SCREENSHOT'],
  ['MARKET_TRUST', 'WEB_RESEARCH'], ['EVENT_SHOCK', 'WEB_RESEARCH'], ['EXECUTION_RISK', 'WEB_RESEARCH'],
].map(([category, source_kind]) => ({
  category, source_kind, source_ref: `test://${category}`, observed_at: '2026-09-15T10:00:00Z',
  retrieved_at: '2026-09-15T10:01:00Z', verification: 'VERIFIED',
}));

const packet = () => ({ producer: 'test-intelligence', producer_version: '1', request_id: '5drreq_test', observations: makeObservations(), normalized: makeNormalized() });

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


test('day-wise three-class vectors are mandatory in normalized handoff',()=>{
  const body:any=packet();
  body.normalized.horizon_slots['D+5']={direction:'BULLISH',probability:35,zone_low:23250,zone_high:23600,basis:'legacy single confidence'};
  const errors=validateIntelligenceHandoff(body);
  assert.ok(errors.some(error=>error.includes('horizon_slots')));
});

test('selected daily direction must match the highest scenario probability',()=>{
  const body:any=packet();
  body.normalized.horizon_slots['D+5']={direction:'BULLISH',probabilities:{BULL:35,RANGE:45,BEAR:20},zone_low:23250,zone_high:23600,basis:'test'};
  const errors=validateIntelligenceHandoff(body);
  assert.ok(errors.some(error=>error.includes('highest scenario probability')));
});
