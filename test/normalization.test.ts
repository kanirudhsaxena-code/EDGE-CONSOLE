import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCompleteness, jsonEquivalent, validateNormalizedEvidence } from '../src/normalization';

const fullNormalized = {
  regime:'TREND',
  component_scores:{PRICE_STRUCTURE:40,PVPO:35,PARTICIPATION:20,MACRO_CATALYSTS:10},
  market_trust_inputs:{price_confirmation:70,pvpo_confirmation:65,participation_confirmation:60,cross_engine_consistency:70,closing_confirmation:75,evidence_freshness_completeness:90},
  event_shock:'LOW',
  execution_inputs:{rr_score:75,premium_iv_theta_score:70,strike_expiry_fit_score:80,liquidity_spread_score:85,entry_invalidation_score:70},
  data_adequate:true,
  event_kill_switch:false,
  expected_rr:2.4,
  horizon_slots:{
  'D+1':{direction:'BULLISH',probabilities:{BULL:58,RANGE:30,BEAR:12},zone_low:23000,zone_high:23300,basis:'Price structure'},
  'D+2':{direction:'BULLISH',probabilities:{BULL:57,RANGE:31,BEAR:12},zone_low:22950,zone_high:23400,basis:'Price structure'},
  'D+3':{direction:'RANGE',probabilities:{BULL:25,RANGE:55,BEAR:20},zone_low:22900,zone_high:23450,basis:'Mixed confirmation'},
  'D+4':{direction:'RANGE',probabilities:{BULL:25,RANGE:54,BEAR:21},zone_low:22850,zone_high:23500,basis:'Mixed confirmation'},
  'D+5':{direction:'RANGE',probabilities:{BULL:25,RANGE:53,BEAR:22},zone_low:22800,zone_high:23550,basis:'Wider uncertainty'}
}
};
const item = (normalized: Record<string, unknown>, source_ref = 'evidence://one') => ({ evidence_type: 'STRUCTURED', source_ref, captured_at: '2026-09-15T07:00:00.000Z', normalized });

test('complete governed evidence is executable', () => {
  const evidence = [item(fullNormalized)];
  assert.deepEqual(validateNormalizedEvidence({ evidence }), []);
  assert.deepEqual(assessCompleteness(evidence), { missing: [], conflicts: [] });
});

test('incomplete evidence reports missing required inputs', () => {
  const evidence = [item({ regime: 'TREND' })];
  const result = assessCompleteness(evidence);
  assert.ok(result.missing.includes('component_scores'));
  assert.equal(result.conflicts.length, 0);
});

test('conflicting evidence reports the conflicting required input', () => {
  const evidence = [item(fullNormalized, 'evidence://one'), item({ regime: 'RANGE' }, 'evidence://two')];
  const result = assessCompleteness(evidence);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.conflicts, ['regime']);
});

test('malformed evidence fails structural validation', () => {
  const errors = validateNormalizedEvidence({ evidence: [{ evidence_type: '', source_ref: '', captured_at: 'not-a-date', normalized: {} }] });
  assert.ok(errors.some((error) => error.includes('evidence_type')));
  assert.ok(errors.some((error) => error.includes('source_ref')));
  assert.ok(errors.some((error) => error.includes('captured_at')));
  assert.ok(errors.some((error) => error.includes('normalized')));
});

test('rejects unsupported normalized keys instead of silently passing them',()=>{
  const errors=validateNormalizedEvidence({evidence:[item({regime:'TREND',invented_score:99})]});
  assert.ok(errors.some(error=>error.includes('unsupported normalized input invented_score')));
});

test('rejects malformed governed ranges and horizon slots',()=>{
  const errors=validateNormalizedEvidence({evidence:[item({
    component_scores:{PRICE_STRUCTURE:101,PVPO:0,PARTICIPATION:0,MACRO_CATALYSTS:0},
    expected_rr:-1,
    horizon_slots:{'D+1':{},'D+2':{}}
  })]});
  assert.ok(errors.some(error=>error.includes('component_scores')));
  assert.ok(errors.some(error=>error.includes('expected_rr')));
  assert.ok(errors.some(error=>error.includes('horizon_slots')));
});


test('semantic JSON equality ignores object key ordering from jsonb persistence',()=>{
  const a={component_scores:{PRICE_STRUCTURE:20,PVPO:12.5,PARTICIPATION:0,MACRO_CATALYSTS:0}};
  const b={component_scores:{MACRO_CATALYSTS:0,PARTICIPATION:0,PVPO:12.5,PRICE_STRUCTURE:20}};
  assert.equal(jsonEquivalent(a,b),true);
});


test('rejects daily scenario vectors that do not total 100 or match selected direction',()=>{
  const bad=structuredClone(fullNormalized);
  bad.horizon_slots['D+5']={direction:'BULLISH',probabilities:{BULL:35,RANGE:45,BEAR:20},zone_low:22800,zone_high:23550,basis:'Invalid selected direction'};
  const errors=validateNormalizedEvidence({evidence:[item(bad)]});
  assert.ok(errors.some(error=>error.includes('D+5')&&error.includes('highest scenario probability')));
});
