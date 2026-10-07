import test from 'node:test';
import assert from 'node:assert/strict';
import { observeBuild3RecommendationFromDailySessions, observeBuild3RecommendationFromMinuteSources } from '../src/build-3-recommendation-observation';
import type { Build3DecisionRecord } from '../src/build-3-decision';
import type { Build3SessionOhlcSource } from '../src/build-3-outcome-types';
import type { Build3RecommendationIntradaySource } from '../src/build-3-recommendation-intraday-source';

const baseDecision:Build3DecisionRecord={
  decision_version:'MDOS_BUILD_3_DECISION_V1',engine:'EDGE_STOCKS',instrument:'LTF',source_id:'life-1',
  issued_at:'2026-10-07T03:30:00.000Z',forecast_direction:'BULL',decision_state:'ACTIONABLE',
  recommendation:'BUY',tradeable:true,evidence_snapshot_id:'snap-1',evidence_hash:'a'.repeat(64),
  gate_results:[],rejecting_gates:[],counterfactual:{
    applicable:false,diagnostic_only:true,issued_trade:false,availability:'NOT_AVAILABLE',
    direction_candidate:null,instrument_expression:null,entry_logic:null,invalidation:null,
    expected_rr:null,target1:null,target2:null,rejecting_gates:[],
  },
  execution_snapshot:{
    applicable:true,availability:'COMPLETE',action:'LONG_ENTRY',instrument_expression:'EQUITY',provider_instrument_key:'NSE_EQ|LTF',
    entry_low:100,entry_high:101,stop:95,target1:110,target2:115,time_exit:null,
    efficacy_target:110,efficacy_target_label:'T1',
    entry_activation_rule:'FIRST_ELIGIBLE_TRADE_IN_ENTRY_BAND_AFTER_ISSUANCE',
    lifecycle_end:'2026-10-09',lifecycle_end_at:'2026-10-09T10:00:00.000Z',
    exact_contract_verified:true,reason:null,
  },
};

function bar(date:string,o:number,h:number,l:number,c:number):Build3SessionOhlcSource{
  return {
    source_version:'BUILD3_SESSION_OHLC_V1',engine:'EDGE_STOCKS',instrument:'LTF',
    session_date:date,captured_at:date+'T10:30:00.000Z',source_ref:'upstox:'+date,
    provider_hash:(date.replaceAll('-','')+'b'.repeat(64)).slice(0,64),
    actual_open:o,actual_high:h,actual_low:l,actual_close:c,
    corporate_action_state:'CLEAR',adjustment_basis:'RAW_CLEAR',
  };
}
const expected=['2026-10-07','2026-10-08','2026-10-09'];
const now=new Date('2026-10-09T11:00:00.000Z');

test('pre-open open-in-band activation makes same-session target/SL facts eligible',()=>{
  const o=observeBuild3RecommendationFromDailySessions({
    decision:baseDecision,expected_sessions:expected,now,
    sessions:[bar('2026-10-07',100.5,111,94,106),bar('2026-10-08',106,108,104,107),bar('2026-10-09',107,109,105,108)],
  });
  assert.equal(o.state,'SCORABLE');
  assert.equal(o.entry_triggered,true);
  assert.equal(o.entry_triggered_basis,'OPEN_IN_BAND');
  assert.equal(o.target_hit,true);
  assert.equal(o.sl_hit,true);
});

test('range-entered entry refuses same-session target/SL sequencing from a daily bar',()=>{
  const o=observeBuild3RecommendationFromDailySessions({
    decision:baseDecision,expected_sessions:expected,now,
    sessions:[bar('2026-10-07',103,111,99,106),bar('2026-10-08',106,108,104,107),bar('2026-10-09',107,109,105,108)],
  });
  assert.equal(o.state,'NOT_SCORABLE');
  assert.equal(o.reason,'ENTRY_SESSION_TARGET_SL_SEQUENCE_REQUIRES_INTRADAY_EVIDENCE');
});

test('range-entered entry can use later sessions when entry session did not touch target or SL',()=>{
  const o=observeBuild3RecommendationFromDailySessions({
    decision:baseDecision,expected_sessions:expected,now,
    sessions:[bar('2026-10-07',103,104,99,102),bar('2026-10-08',102,111,96,109),bar('2026-10-09',109,111,94,100)],
  });
  assert.equal(o.state,'SCORABLE');
  assert.equal(o.entry_triggered,true);
  assert.equal(o.target_hit,true);
  assert.equal(o.sl_hit,true);
});

test('intraday issuance fails closed when daily bar cannot sequence same-session entry',()=>{
  const decision={...baseDecision,issued_at:'2026-10-07T05:00:00.000Z'};
  const o=observeBuild3RecommendationFromDailySessions({
    decision,expected_sessions:expected,now,
    sessions:[bar('2026-10-07',103,105,99,102),bar('2026-10-08',102,104,101,103),bar('2026-10-09',103,104,102,103)],
  });
  assert.equal(o.state,'NOT_SCORABLE');
  assert.equal(o.reason,'SAME_SESSION_ENTRY_SEQUENCE_REQUIRES_INTRADAY_EVIDENCE');
});

test('untriggered lifecycle is final and scorable with false primitives',()=>{
  const o=observeBuild3RecommendationFromDailySessions({
    decision:baseDecision,expected_sessions:expected,now,
    sessions:[bar('2026-10-07',103,105,102,104),bar('2026-10-08',104,106,102,105),bar('2026-10-09',105,107,102,106)],
  });
  assert.equal(o.state,'SCORABLE');
  assert.equal(o.entry_triggered,false);
  assert.equal(o.target_hit,false);
  assert.equal(o.sl_hit,false);
});

test('missing target-session evidence remains retryable instead of becoming a miss',()=>{
  const o=observeBuild3RecommendationFromDailySessions({
    decision:baseDecision,expected_sessions:expected,now,
    sessions:[bar('2026-10-07',103,105,102,104),bar('2026-10-08',104,106,102,105)],
  });
  assert.equal(o.state,'PENDING');
  assert.match(String(o.reason),/SESSION_EVIDENCE_MISSING/);
});

test('5DR option recommendation cannot be scored from NIFTY index OHLC',()=>{
  const decision={...baseDecision,engine:'5DR' as const,instrument:'NIFTY',source_id:'n-1',
    execution_snapshot:{...baseDecision.execution_snapshot,action:'OPTION_CALL' as const,instrument_expression:'NIFTY_OPTION'}};
  const o=observeBuild3RecommendationFromDailySessions({decision,expected_sessions:expected,now,sessions:[]});
  assert.equal(o.state,'NOT_SCORABLE');
  assert.equal(o.reason,'OPTION_CONTRACT_LEVEL_OHLC_REQUIRED');
});


function minuteSource(
  decision:Build3DecisionRecord,
  date:string,
  rows:Array<[string,number,number,number,number]>,
):Build3RecommendationIntradaySource{
  return {
    source_version:'MDOS_BUILD_3_RECOMMENDATION_INTRADAY_SOURCE_V1',
    engine:decision.engine,instrument:decision.instrument,source_id:decision.source_id,
    provider_instrument_key:String(decision.execution_snapshot.provider_instrument_key),
    session_date:date,captured_at:date+'T11:00:00.000Z',
    source_ref:'upstox:minute:'+date,provider_hash:(date.replaceAll('-','')+'c'.repeat(64)).slice(0,64),
    candle_interval_minutes:1,
    candles:rows.map(([timestamp,open,high,low,close])=>({
      timestamp:new Date(timestamp).toISOString(),open,high,low,close,volume:10,open_interest:100,
    })),
  };
}

test('one-minute option truth scores post-entry target and SL without first-touch ordering',()=>{
  const decision:Build3DecisionRecord={
    ...baseDecision,engine:'5DR',instrument:'NIFTY',source_id:'n-minute',
    issued_at:'2026-10-07T03:30:00.000Z',recommendation:'BUY_CE',
    execution_snapshot:{
      ...baseDecision.execution_snapshot,action:'OPTION_CALL',instrument_expression:'NIFTY 08 OCT 25000 CE',
      provider_instrument_key:'NSE_FO|CE25000',
    },
  };
  const sources=[
    minuteSource(decision,'2026-10-07',[
      ['2026-10-07T09:15:00+05:30',100.5,102,100,101],
      ['2026-10-07T10:00:00+05:30',105,111,104,110],
    ]),
    minuteSource(decision,'2026-10-08',[
      ['2026-10-08T09:15:00+05:30',108,109,94,96],
    ]),
    minuteSource(decision,'2026-10-09',[
      ['2026-10-09T09:15:00+05:30',96,99,95,98],
    ]),
  ];
  const o=observeBuild3RecommendationFromMinuteSources({decision,expected_sessions:expected,sources,now});
  assert.equal(o.state,'SCORABLE');
  assert.equal(o.evidence_mode,'ONE_MINUTE');
  assert.equal(o.entry_triggered,true);
  assert.equal(o.target_hit,true);
  assert.equal(o.sl_hit,true);
});

test('one-minute truth still fails closed when entry and target share an unresolved entry minute',()=>{
  const decision={...baseDecision,source_id:'minute-ambiguous'};
  const sources=[
    minuteSource(decision,'2026-10-07',[
      ['2026-10-07T09:15:00+05:30',103,111,99,105],
    ]),
    minuteSource(decision,'2026-10-08',[
      ['2026-10-08T09:15:00+05:30',105,106,104,105],
    ]),
    minuteSource(decision,'2026-10-09',[
      ['2026-10-09T09:15:00+05:30',105,106,104,105],
    ]),
  ];
  const o=observeBuild3RecommendationFromMinuteSources({decision,expected_sessions:expected,sources,now});
  assert.equal(o.state,'NOT_SCORABLE');
  assert.equal(o.reason,'ENTRY_MINUTE_TARGET_SL_SEQUENCE_AMBIGUOUS');
});

test('one-minute truth requires every governed lifecycle session before final classification',()=>{
  const decision={...baseDecision,source_id:'minute-missing'};
  const sources=[
    minuteSource(decision,'2026-10-07',[
      ['2026-10-07T09:15:00+05:30',100.5,102,100,101],
    ]),
    minuteSource(decision,'2026-10-08',[
      ['2026-10-08T09:15:00+05:30',101,105,100,103],
    ]),
  ];
  const o=observeBuild3RecommendationFromMinuteSources({decision,expected_sessions:expected,sources,now});
  assert.equal(o.state,'PENDING');
  assert.match(String(o.reason),/INTRADAY_SOURCE_MISSING:2026-10-09/);
});
