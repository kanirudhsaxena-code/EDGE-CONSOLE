import test from 'node:test';
import assert from 'node:assert/strict';
import { componentVerificationStatus, validateEdgeStocksResult } from '../src/edge-stocks';

const valid = {
  contract_version:'EDGE_STOCKS_V1_3',
  presentation_contract:'EFFICACY_V2',
  engine:'EDGE_STOCKS',
  framework_version:'EDGE_V1',
  ticker:'TCS',
  run_id:'EDGE-TCS-20260918-181704-AUTO',
  generated_at:'2026-09-18T18:20:00Z',
  presentation:{
    standard_table_count:4,
    table_1:'EDGE_MASTER_ASSESSMENT',
    table_2:'ACTIVE_CALLS',
    table_3:'CURRENT_STOCK_OUTCOME',
    table_4:'DRILLDOWN'
  },
  master_assessment:{
    recommendations:6,unique_stocks:4,open_recommendations:6,closed_recommendations:0,
    official_scorable_recommendations:0,
    recommendation_hit_rate_pct:null,direction_hit_rate_pct:null,target_hit_rate_pct:null,
    provisional_captured_checkpoints:0,provisional_due_checkpoints:30,
    provisional_forecast_scorable:0,provisional_forecast_hits:0,provisional_forecast_misses:0,provisional_forecast_accuracy_pct:null,
    provisional_zone_scorable:0,provisional_zone_hits:0,provisional_zone_misses:0,provisional_zone_accuracy_pct:null
  },
  active_calls:[],
  current_stock_outcome:{
    des:-3.5,directional_agreement:52.1,effective_conviction:.0243,
    market_trust:{score:69.474,band:'MODERATE'},
    bot:{score:68.941,grade:'B'},
    risk_override:{status:'CLEAR',code:null},
    expected_price_zone:{low:2162.5,high:2240.86},
    execution:{instrument:'NONE'},
    probabilities:{bull:4.02,base:73.663,bear:22.317},
    definitive_forecast:'BASE_RANGE',
    forecast_horizon:'D+5',
    primary_action:'NO TRADE; NO OPTION TRADE.',
    decision_ladder:'INVESTIGATION'
  },
  drilldown:[
    {component:'PRICE_STRUCTURE',score_or_level:-1,verification_status:'VERIFIED',key_outcome:'NEGATIVE',interpretation:'Price structure is negative under the frozen trend rules; latest structure pattern is FAILED_BREAKDOWN.'}
  ]
};

test('valid EDGE Stocks V1.3 Efficacy V2 report passes',()=>{
  assert.deepEqual(validateEdgeStocksResult(valid),[]);
});

test('mandatory presentation is exactly four sections in order',()=>{
  const bad=structuredClone(valid);
  bad.presentation.standard_table_count=2;
  bad.presentation.table_1='EDGE_OUTCOME_DECISION';
  const errors=validateEdgeStocksResult(bad);
  assert.ok(errors.some(x=>x.includes('exactly 4')));
  assert.ok(errors.some(x=>x.includes('EDGE_MASTER_ASSESSMENT')));
});

test('official efficacy cannot be populated with zero closed sample',()=>{
  const bad=structuredClone(valid);
  bad.master_assessment.recommendation_hit_rate_pct=50;
  assert.ok(validateEdgeStocksResult(bad).some(x=>x.includes('must be null when official_scorable_recommendations is 0')));
});

test('probabilities must sum to 100 within 0.01',()=>{
  const bad=structuredClone(valid);
  bad.current_stock_outcome.probabilities.bull=50;
  assert.ok(validateEdgeStocksResult(bad).some(x=>x.includes('sum to 100')));
});

test('verification status is mandatory and bounded',()=>{
  const bad=structuredClone(valid);
  bad.drilldown[0].verification_status='MAYBE';
  assert.ok(validateEdgeStocksResult(bad).some(x=>x.includes('verification_status is invalid')));
});

test('verified components require meaningful interpretations',()=>{
  const bad=structuredClone(valid);
  bad.drilldown[0].interpretation='Component evidence retained in immutable audit record';
  assert.ok(validateEdgeStocksResult(bad).some(x=>x.includes('interpretation must be meaningful')));
});

test('empty drill-down is rejected',()=>{
  const bad=structuredClone(valid);
  bad.drilldown=[];
  assert.ok(validateEdgeStocksResult(bad).some(x=>x.includes('at least one component')));
});

test('component verification status fails unknown states closed',()=>{
  assert.equal(componentVerificationStatus('AVAILABLE','HIGH'),'VERIFIED');
  assert.equal(componentVerificationStatus('AVAILABLE',null),'NOT_VERIFIED');
  assert.equal(componentVerificationStatus('NOT_AVAILABLE','HIGH'),'NOT_AVAILABLE');
});
