import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attributeBuild3Observation,
  summarizeBuild3Attribution,
  type Build3AttributionObservation,
} from '../src/build-3-attribution';

function observation(overrides:Partial<Build3AttributionObservation>={}):Build3AttributionObservation{
  return {
    engine:'5DR',instrument:'NIFTY',source_id:'a1',horizon:'D',
    forecast_direction:'BULL',regime:'TREND',direction_result:'HIT',
    outer_close_hit:true,core_close_hit:true,
    outer_quality_status:'GREEN',core_quality_status:'GREEN',
    outer_high_breach_points:0,outer_low_breach_points:0,
    core_high_breach_points:0,core_low_breach_points:0,
    component_scores:{PRICE_STRUCTURE:40,PVPO:30,PARTICIPATION:20,MACRO_CATALYSTS:10},
    gate_results:[{gate:'MARKET_TRUST',passed:true,observed:75,threshold:'>=50'}],
    verified_inputs:['regime','component_scores'],
    recommendation_classification:null,no_trade_classification:null,
    ...overrides,
  };
}

test('successful observation credits only frozen aligned components and passed gates',()=>{
  const a=attributeBuild3Observation(observation());
  assert.ok(a.success_signals.includes('DIRECTION_HIT'));
  assert.ok(a.success_signals.includes('ALIGNED_COMPONENT:PVPO'));
  assert.ok(a.success_signals.includes('PASSED_GATE:MARKET_TRUST'));
  assert.ok(a.success_signals.includes('VERIFIED_INPUT:COMPONENT_SCORES'));
  assert.equal(a.unknown_direction_cause,false);
});

test('direction miss maps a frozen opposing PVPO score to governed PVPO conflict',()=>{
  const a=attributeBuild3Observation(observation({
    source_id:'pvpo-miss',direction_result:'MISS',
    component_scores:{PRICE_STRUCTURE:40,PVPO:-30,PARTICIPATION:20,MACRO_CATALYSTS:10},
  }));
  assert.ok(a.failure_signals.includes('PVPO_ERROR:PVPO_CONFLICT'));
  assert.equal(a.unknown_direction_cause,false);
});

test('direction miss without supported conflicting evidence remains UNKNOWN',()=>{
  const a=attributeBuild3Observation(observation({
    source_id:'unknown',direction_result:'MISS',component_scores:{},
    gate_results:[{gate:'MARKET_TRUST',passed:true,observed:80,threshold:'>=50'}],
  }));
  assert.ok(a.failure_signals.includes('UNKNOWN_DIRECTION_CAUSE'));
  assert.equal(a.unknown_direction_cause,true);
});

test('zone-side and recommendation failure facts are attributed without causal invention',()=>{
  const a=attributeBuild3Observation(observation({
    source_id:'zone',direction_result:'HIT',outer_close_hit:false,core_close_hit:false,
    outer_quality_status:'RED',core_quality_status:'RED',
    outer_high_breach_points:12,core_high_breach_points:20,
    recommendation_classification:'DUAL_TOUCH',
  }));
  assert.ok(a.failure_signals.includes('OUTER_CLOSE_MISS'));
  assert.ok(a.failure_signals.includes('HIGH_SIDE_BREACH'));
  assert.ok(a.failure_signals.includes('DUAL_TOUCH'));
  assert.ok(!a.failure_signals.includes('UNKNOWN_DIRECTION_CAUSE'));
});

test('recommendation lifecycle signal is counted once on D, not multiplied across horizons',()=>{
  const d=attributeBuild3Observation(observation({horizon:'D',recommendation_classification:'SL_ONLY'}));
  const d1=attributeBuild3Observation(observation({horizon:'D+1',recommendation_classification:'SL_ONLY'}));
  assert.ok(d.failure_signals.includes('SL_ONLY'));
  assert.ok(!d1.failure_signals.includes('SL_ONLY'));
});

test('attribution confidence cannot become STRONG from small samples',()=>{
  const small=Array.from({length:9},(_,i)=>observation({source_id:'s'+i}));
  const summary=summarizeBuild3Attribution(small,'2026-10-07T12:00:00.000Z');
  const hit=summary.success_insights.find(row=>row.signal==='DIRECTION_HIT');
  assert.equal(hit?.confidence,'INSUFFICIENT');
  assert.equal(summary.policy.single_observation_never_changes_production,true);
});

test('strong label requires both sample size and Wilson lower bound',()=>{
  const strong=Array.from({length:40},(_,i)=>observation({
    source_id:'strong'+i,
    direction_result:i<36?'HIT':'MISS',
    component_scores:i<36?{PVPO:20}:{PVPO:-20},
  }));
  const summary=summarizeBuild3Attribution(strong);
  const hit=summary.success_insights.find(row=>row.signal==='DIRECTION_HIT');
  assert.equal(hit?.occurrences,36);
  assert.equal(hit?.confidence,'STRONG');
  assert.ok(Number(hit?.wilson_lower_95)>0.5);
});
