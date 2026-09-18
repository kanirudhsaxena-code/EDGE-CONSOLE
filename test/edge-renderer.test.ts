import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEdgeV13 } from '../public/edge-live.js';
import { validateEdgeStocksResult } from '../src/edge-stocks';

const report = {
  contract_version:'EDGE_STOCKS_V1_3',
  presentation_contract:'EFFICACY_V2',
  engine:'EDGE_STOCKS',
  framework_version:'EDGE_V1',
  ticker:'TCS',
  run_id:'EDGE-TCS-20260918-TEST',
  generated_at:'2026-09-18T18:00:00Z',
  presentation:{
    standard_table_count:4,
    table_1:'EDGE_MASTER_ASSESSMENT',
    table_2:'ACTIVE_CALLS',
    table_3:'CURRENT_STOCK_OUTCOME',
    table_4:'DRILLDOWN'
  },
  master_assessment:{
    recommendations:5,unique_stocks:3,open_recommendations:5,closed_recommendations:0,
    official_scorable_recommendations:0,recommendation_hit_rate_pct:null,direction_hit_rate_pct:null,target_hit_rate_pct:null,
    avg_gain_pct:null,avg_loss_pct:null,avg_mfe_pct:null,avg_mae_pct:null,cumulative_model_pnl_units:null,
    provisional_captured_checkpoints:3,provisional_due_checkpoints:17,
    provisional_forecast_scorable:3,provisional_forecast_hits:2,provisional_forecast_misses:1,provisional_forecast_accuracy_pct:66.7,
    provisional_zone_scorable:3,provisional_zone_hits:3,provisional_zone_misses:0,provisional_zone_accuracy_pct:100,
    stock_assessment:{ticker:'TCS'}
  },
  active_calls:[{ticker:'TCS',recommendation_id:'EDGE-TCS-X',definitive_forecast:'BASE_RANGE',definitive_recommendation:'NO TRADE; NO OPTION TRADE.',expected_price_zone:{low:3000,high:3200},outcome_verdict:'OPEN'}],
  current_stock_outcome:{
    des:-30,market_trust:{score:92,band:'VERY HIGH'},directional_agreement:80,effective_conviction:.276,
    probabilities:{bull:5,base:60,bear:35},definitive_forecast:'BASE_RANGE',expected_price_zone:{low:3000,high:3200},
    forecast_horizon:'D+5',risk_override:{status:'CLEAR',code:null},primary_action:'NO TRADE; NO OPTION TRADE.',
    decision_ladder:'INVESTIGATION',bot:{score:65,grade:'B'},execution:{instrument:'NONE'},current_price:3100
  },
  drilldown:[
    {component:'PRICE_STRUCTURE',score_or_level:-1,verification_status:'VERIFIED',key_outcome:'NEGATIVE',interpretation:'Price structure is negative under the frozen trend rules; latest structure pattern is TREND_CONTINUATION.'},
    {component:'VALUATION',score_or_level:'N/A',verification_status:'NOT_VERIFIED',key_outcome:'NOT VERIFIED',interpretation:'Required structured evidence was unavailable or insufficient; no interpretation inferred.'}
  ]
};

test('Efficacy V2 renderer produces exactly four tables in mandatory order',()=>{
  const html=renderEdgeV13(report);
  assert.equal((html.match(/<table /g)||[]).length,4);
  const i1=html.indexOf('1 — EDGE MASTER ASSESSMENT');
  const i2=html.indexOf('2 — ACTIVE CALLS');
  const i3=html.indexOf('3 — CURRENT STOCK OUTCOME');
  const i4=html.indexOf('4 — DRILL-DOWN');
  assert.ok(i1<i2 && i2<i3 && i3<i4);
});

test('assessment is the first user-facing table',()=>{
  const html=renderEdgeV13(report);
  assert.ok(html.indexOf('EDGE MASTER ASSESSMENT') < html.indexOf('CURRENT STOCK OUTCOME'));
});

test('verified drill-down requires meaningful interpretation',()=>{
  const bad=structuredClone(report);
  bad.drilldown[0].interpretation='No additional interpretation recorded in the governed audit record.';
  assert.throws(()=>renderEdgeV13(bad),/interpretation missing/);
  assert.ok(validateEdgeStocksResult(bad).some(e=>e.includes('interpretation must be meaningful')));
});

test('validator rejects obsolete two-table presentation',()=>{
  const bad=structuredClone(report);
  bad.presentation.standard_table_count=2;
  bad.presentation.table_1='EDGE_OUTCOME_DECISION';
  assert.ok(validateEdgeStocksResult(bad).length>0);
});

test('official metrics remain null when no closed scorable sample exists',()=>{
  assert.equal(validateEdgeStocksResult(report).length,0);
});
