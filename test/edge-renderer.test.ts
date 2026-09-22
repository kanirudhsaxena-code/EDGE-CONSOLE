import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    stock_assessment:{
      ticker:'TCS',recommendations:2,open_recommendations:2,closed_recommendations:0,
      official_scorable_recommendations:0,recommendation_hit_rate_pct:null,
      avg_gain_pct:null,avg_loss_pct:null,cumulative_model_pnl_units:null,
      provisional_captured_checkpoints:3,provisional_due_checkpoints:17,
      provisional_forecast_scorable:3,provisional_forecast_hits:2,provisional_forecast_accuracy_pct:66.7,
      provisional_zone_scorable:3,provisional_zone_hits:3,provisional_zone_accuracy_pct:100,
      previous_recommendation:{
        recommendation_id:'EDGE-TCS-PREV',definitive_forecast:'BASE_RANGE',
        definitive_recommendation:'NO TRADE',outcome_verdict:'OPEN',current_return_pct:1.2
      }
    }
  },
  active_calls:[{ticker:'TCS',recommendation_id:'EDGE-TCS-X',call_timestamp:'2026-09-17T11:15:00Z',definitive_forecast:'BASE_RANGE',definitive_recommendation:'NO TRADE; NO OPTION TRADE.',expected_price_zone:{low:3000,high:3200},outcome_verdict:'OPEN'}],
  current_stock_outcome:{
    des:-30,market_trust:{score:92,band:'VERY HIGH'},directional_agreement:80,effective_conviction:.276,
    probabilities:{bull:5,base:60,bear:35},definitive_forecast:'BASE_RANGE',expected_price_zone:{low:3000,high:3200},
    forecast_horizon:'D+5',risk_override:{status:'CLEAR',code:null},primary_action:'NO TRADE; NO OPTION TRADE.',
    decision_ladder:'INVESTIGATION',bot:{score:65,grade:'B'},execution:{instrument:'NONE',option_suitability_status:'NO OPTION TRADE',execution_quality_score:60},current_price:3100
  },
  drilldown:[
    {component:'BUSINESS_FUNDAMENTALS',score_or_level:1,verification_status:'VERIFIED',key_outcome:'POSITIVE',narrative_source:'LEGACY_SCORE_RECONSTRUCTION',interpretation:'Legacy active run: the original narrative field was not persisted. The immutable verified component score is 1 (positive); Business fundamentals are therefore acting as a medium-term support or drag within the five-day framework.'},
    {component:'PV_PVPO',score_or_level:-1,verification_status:'VERIFIED',key_outcome:'NEGATIVE',narrative_source:'PERSISTED_EVIDENCE_NARRATIVE',interpretation:'Price weakened while participation and available derivatives confirmation did not support a bullish continuation.'},
    {component:'VALUATION',score_or_level:'N/A',verification_status:'NOT_VERIFIED',key_outcome:'NOT VERIFIED',interpretation:'Required structured evidence was unavailable or insufficient; no interpretation inferred.'}
  ]
};

test('Efficacy V2 renderer produces four mobile-first sections in approved order',()=>{
  const html=renderEdgeV13(report);
  const i1=html.indexOf('1 — EDGE MASTER ASSESSMENT');
  const i2=html.indexOf('2 — ACTIVE CALLS');
  const i3=html.indexOf('3 — CURRENT STOCK OUTCOME');
  const i4=html.indexOf('4 — DRILL-DOWN');
  assert.ok(i1<i2 && i2<i3 && i3<i4);
  assert.equal((html.match(/data-edge-section=/g)||[]).length,4);
});

test('user-facing EDGE renderer uses cards rather than horizontally scrolling tables',()=>{
  const html=renderEdgeV13(report);
  assert.equal((html.match(/<table /g)||[]).length,0);
  assert.ok(html.includes('edge-user-output'));
  assert.ok(html.includes('edge-user-metric'));
  assert.ok(html.includes('edge-drill-card'));
});

test('drill-down uses finding, explanation and outcome without fabricating legacy detail',()=>{
  const html=renderEdgeV13(report);
  assert.ok(html.includes('FINDING'));
  assert.ok(html.includes('WHY IT MATTERS'));
  assert.ok(!html.includes('<b>Outcome:</b>'));
  assert.ok(html.includes('This older run preserved a verified component score of 1 (positive)'));
  assert.ok(html.includes('did not preserve the detailed source narrative'));
  assert.ok(!html.includes('Legacy active run'));
  assert.ok(!html.includes('original narrative field was not persisted'));
  assert.ok(!html.includes('immutable verified component score'));
});

test('drill-down shows each outcome only once as the outcome badge',()=>{
  const html=renderEdgeV13(report);
  assert.equal((html.match(/<b>Outcome:<\/b>/g)||[]).length,0);
  assert.ok(html.includes('score-pill positive'));
  assert.ok(html.includes('score-pill negative'));
});

test('drill-down prefers exact published finding over audit jargon',()=>{
  const current=structuredClone(report);
  current.drilldown[0].finding='FY26 PAT rose 14% YoY to Rs 3,003 crore and the retail book rose 26% YoY.';
  current.drilldown[0].interpretation='Verified income-statement growth evidence produced governed fundamentals score +1. Independent ChatGPT web research validated this component using 2 sources. Research direction(s): POSITIVE.';
  const html=renderEdgeV13(current);
  assert.ok(html.includes('FY26 PAT rose 14% YoY to Rs 3,003 crore'));
  assert.ok(!html.includes('governed fundamentals score'));
  assert.ok(!html.includes('Independent ChatGPT web research'));
  assert.ok(!html.includes('Research direction(s)'));
});

test('unverified institutional behaviour explains the missing evidence plainly',()=>{
  const current=structuredClone(report);
  current.drilldown.push({
    component:'INSTITUTIONAL_BEHAVIOUR',
    score_or_level:'N/A',
    verification_status:'NOT_VERIFIED',
    key_outcome:'NOT VERIFIED',
    interpretation:'Supporting provider evidence was excluded because fresh independent ChatGPT web validation was unavailable.'
  });
  const html=renderEdgeV13(current);
  assert.ok(html.includes('did not contain independently verified FII, DII or mutual-fund holding/flow evidence'));
  assert.ok(html.includes('left Institutional Behaviour unscored'));
  assert.ok(!html.includes('Supporting provider evidence was excluded'));
});

test('current outcome makes direction and five-day range the primary visual highlights',()=>{
  const html=renderEdgeV13(report);
  assert.ok(html.includes('5-DAY DIRECTION'));
  assert.ok(html.includes('Range-bound'));
  assert.ok(html.includes('EXPECTED 5-DAY RANGE'));
  assert.ok(html.includes('₹3,000 – ₹3,200'));
  assert.ok(html.includes('edge-decision-highlights'));
  assert.ok(html.includes('edge-key-grid'));
});

test('PV/PVPO is expanded for users',()=>{
  const html=renderEdgeV13(report);
  assert.ok(html.includes('Price &amp; Volume / Price, Volume, Premium &amp; Open Interest (PV/PVPO)'));
  assert.ok(html.includes('PV means Price &amp; Volume. PVPO means Price, Volume, Premium &amp; Open Interest.'));
});

test('assessment and decision labels are user-friendly',()=>{
  const html=renderEdgeV13(report);
  assert.ok(html.includes('Outcome checks recorded'));
  assert.ok(html.includes('Internal model P/L score'));
  assert.ok(html.includes('Early forecast tracking'));
  assert.ok(html.includes('Official recommendation accuracy'));
  assert.ok(html.includes('Audit-only model score. It is not your portfolio return'));
  assert.ok(html.includes('Evidence confidence'));
  assert.ok(html.includes('High evidence confidence does not mean bullish'));
  assert.ok(html.includes('Signals pointing the same way'));
  assert.ok(html.includes('Overall conviction after checks'));
  assert.ok(html.includes('Extra safety block'));
  assert.ok(!html.includes('Captured / due checkpoints'));
});

test('EDGE Stocks result shows the actual run date/time',()=>{
  const html=renderEdgeV13(report);
  assert.ok(html.includes('Run date/time:'));
  assert.match(html,/18 Sep(?:t)? 2026/);
});

test('active calls show the actual stored call date/time',()=>{
  const html=renderEdgeV13(report);
  assert.ok(html.includes('Call date/time:'));
  assert.match(html,/17 Sep(?:t)? 2026/);
});

test('what-could-change stays collapsed until the user opens it',()=>{
  const html=renderEdgeV13(report);
  assert.ok(html.includes('<details class="change-details"><summary>What could change the view?</summary>'));
  assert.ok(!html.includes('<details class="change-details" open>'));
});

test('execution keeps trade quality and options fit side by side with explanations',()=>{
  const html=renderEdgeV13(report);
  assert.ok(html.includes('execution-key-grid'));
  assert.ok(html.includes('Trade setup quality'));
  assert.ok(html.includes('Measures how complete and usable the governed entry, stop, target and risk structure is.'));
  assert.ok(html.includes('Options fit'));
  assert.ok(html.includes('Shows whether an options trade is suitable for this stock view and current evidence.'));
  assert.ok(html.includes('The forecast remains valid only for its governed time window unless invalidated earlier.'));
});

test('non-optionable execution remains explicit and user-friendly',()=>{
  const html=renderEdgeV13(report);
  assert.ok(html.includes('No executable trade'));
  assert.ok(html.includes('No Option Trade'));
  assert.ok(html.includes('Wait — no trade setup currently passes the EDGE execution gates.'));
});

test('verified drill-down still requires meaningful persisted evidence',()=>{
  const bad=structuredClone(report);
  bad.drilldown[0].interpretation='No additional interpretation recorded in the governed audit record.';
  assert.throws(()=>renderEdgeV13(bad),/interpretation missing/);
  assert.ok(validateEdgeStocksResult(bad).some(e=>e.includes('interpretation must be meaningful')));
});

test('validator rejects obsolete presentation order',()=>{
  const bad=structuredClone(report);
  bad.presentation.table_2='CURRENT_STOCK_OUTCOME';
  bad.presentation.table_3='DRILLDOWN';
  bad.presentation.table_4='ACTIVE_CALLS';
  assert.ok(validateEdgeStocksResult(bad).length>0);
});

test('current approved presentation contract validates cleanly',()=>{
  assert.equal(validateEdgeStocksResult(report).length,0);
});


test('EDGE Stocks renderer exposes canonical governance status',()=>{
  const js=readFileSync('public/edge-live.js','utf8');
  assert.ok(js.includes('Official canonical status'));
  assert.ok(js.includes('Only selected canonical recommendations enter official efficacy'));
  assert.ok(js.includes('No qualifying canonical was selected for this target'));
  assert.ok(js.includes('current_run_is_selected'));
});
