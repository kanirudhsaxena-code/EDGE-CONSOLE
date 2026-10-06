import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD3_FORECAST_VERSION, type Build3Forecast } from '../src/build-3-forecast-contract';
import { buildNiftyBuild3Decision, buildStockBuild3Decision } from '../src/build-3-decision';

const forecast=(engine:'5DR'|'EDGE_STOCKS'):Build3Forecast=>({
  forecast_version:BUILD3_FORECAST_VERSION,
  engine,
  instrument:engine==='5DR'?'NIFTY':'LTF',
  source_id:engine==='5DR'?'5drreq-1':'edge-ltf-1',
  model_version:engine==='5DR'?'5DR_V2_1':'EDGE_V1',
  issued_at:'2026-10-06T06:00:00.000Z',
  reference_price_p0:100,
  evidence_snapshot_id:'b3es_decision',
  evidence_hash:'b'.repeat(64),
  data_quality_state:'VERIFIED',
  horizons:['D','D+1','D+2','D+3','D+4'].map((horizon,index)=>({
    horizon:horizon as any,target_session:['2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-12'][index],
    direction:'BULL' as const,probabilities:{BULL:60,RANGE:30,BEAR:10},regime:'TREND' as const,
    reasoning:'decision fixture',expected_centre:100,core_zone_kind:'CENTRE_ONLY' as const,
    core_zone:{low:100,high:100},outer_zone:{low:95,high:105},
  })),
});

test('NIFTY forecast direction stays separate from NO_TRADE recommendation and exact gates',()=>{
  const decision=buildNiftyBuild3Decision(forecast('5DR'),{
    definitive_forecast:'BULLISH',
    recommendation:'NO_TRADE',
    tradeable:false,
    market_trust:72,
    des5:45,
    execution_edge:54,
    expected_rr:1.6,
    tradeability_blockers:['Execution Edge below threshold','Expected R:R below 2.0'],
    event_shock:{kill_switch:false},
    engine_diagnostics:{data_adequate:true},
  });
  assert.equal(decision.forecast_direction,'BULL');
  assert.equal(decision.decision_state,'NO_TRADE');
  assert.equal(decision.recommendation,'NO_TRADE');
  assert.equal(decision.tradeable,false);
  assert.ok(decision.rejecting_gates.includes('EXECUTION_EDGE'));
  assert.ok(decision.rejecting_gates.includes('EXPECTED_RR'));
});

test('NO_TRADE counterfactual is diagnostic and never fabricates an option or entry',()=>{
  const decision=buildNiftyBuild3Decision(forecast('5DR'),{
    definitive_forecast:'BEARISH',recommendation:'NO_TRADE',tradeable:false,
    market_trust:60,des5:-40,execution_edge:50,expected_rr:1.7,
    tradeability_blockers:['EXECUTION_EDGE'],event_shock:{kill_switch:false},
    engine_diagnostics:{data_adequate:true},
  });
  assert.equal(decision.counterfactual.applicable,true);
  assert.equal(decision.counterfactual.diagnostic_only,true);
  assert.equal(decision.counterfactual.issued_trade,false);
  assert.equal(decision.counterfactual.instrument_expression,null);
  assert.equal(decision.counterfactual.entry_logic,null);
  assert.equal(decision.counterfactual.direction_candidate,'BEAR');
  assert.equal(decision.counterfactual.expected_rr,1.7);
});

test('NIFTY actionable recommendation remains distinct from the horizon forecast object',()=>{
  const decision=buildNiftyBuild3Decision(forecast('5DR'),{
    definitive_forecast:'BULLISH',recommendation:'BUY_CE',tradeable:true,
    market_trust:75,des5:55,execution_edge:80,expected_rr:2.4,
    tradeability_blockers:[],event_shock:{kill_switch:false},
    engine_diagnostics:{data_adequate:true},
  });
  assert.equal(decision.decision_state,'ACTIONABLE');
  assert.equal(decision.recommendation,'BUY_CE');
  assert.equal(decision.counterfactual.applicable,false);
  assert.equal(decision.execution_snapshot.applicable,true);
  assert.equal(decision.execution_snapshot.availability,'NOT_AVAILABLE');
  assert.equal(decision.execution_snapshot.exact_contract_verified,false);
});

test('stock NO_TRADE/HOLD path preserves only actually persisted rejected setup fields',()=>{
  const decision=buildStockBuild3Decision(forecast('EDGE_STOCKS'),{
    definitive_forecast:'BULLISH',
    definitive_recommendation:'NO TRADE',
    des:35,market_trust_score:62,bot_grade:'B',decision_ladder:'INVESTIGATION',
    evidence_gate_status:'PASS',event_shock_level:'LOW',active_override:null,
    rationale:'Execution did not qualify under frozen EDGE decision ladder.',
    execution_plan:{
      instrument:'NONE',entry_low:null,entry_high:null,stop_price:null,target1:null,target2:null,
      rr_t1:null,execution_quality_score:45,notes:'No directional equity execution required.'
    },
  });
  assert.equal(decision.decision_state,'NO_TRADE');
  assert.equal(decision.counterfactual.instrument_expression,null);
  assert.equal(decision.counterfactual.entry_logic,null);
  assert.equal(decision.counterfactual.issued_trade,false);
  assert.ok(decision.rejecting_gates.some(reason=>reason.includes('Execution did not qualify')));
});

test('stock actionable BUY remains ACTIONABLE without being confused with forecast direction',()=>{
  const decision=buildStockBuild3Decision(forecast('EDGE_STOCKS'),{
    definitive_forecast:'BULLISH',definitive_recommendation:'BUY',
    des:60,market_trust_score:80,bot_grade:'A+',decision_ladder:'FULL',
    evidence_gate_status:'PASS',event_shock_level:'LOW',active_override:null,rationale:'Qualified.',
    execution_plan:{instrument:'EQUITY',rr_t1:2.1,execution_quality_score:80},
  });
  assert.equal(decision.forecast_direction,'BULL');
  assert.equal(decision.decision_state,'ACTIONABLE');
  assert.equal(decision.recommendation,'BUY');
  assert.equal(decision.counterfactual.applicable,false);
});


test('stock actionable execution levels are frozen as a complete decision snapshot',()=>{
  const decision=buildStockBuild3Decision(forecast('EDGE_STOCKS'),{
    definitive_forecast:'BULLISH',definitive_recommendation:'BUY',
    des:65,market_trust_score:82,bot_grade:'A+',decision_ladder:'FULL',
    evidence_gate_status:'PASS',event_shock_level:'LOW',active_override:null,rationale:'Qualified.',
    execution_plan:{
      instrument:'EQUITY',entry_low:101,entry_high:101,stop_price:96,target1:111,target2:118,
      rr_t1:2,execution_quality_score:90,time_exit:'Frozen forecast horizon',
    },
  });
  assert.equal(decision.execution_snapshot.applicable,true);
  assert.equal(decision.execution_snapshot.availability,'COMPLETE');
  assert.equal(decision.execution_snapshot.action,'LONG_ENTRY');
  assert.equal(decision.execution_snapshot.entry_low,101);
  assert.equal(decision.execution_snapshot.stop,96);
  assert.equal(decision.execution_snapshot.target1,111);
  assert.equal(decision.execution_snapshot.exact_contract_verified,true);
});
