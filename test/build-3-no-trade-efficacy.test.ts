import test from 'node:test';
import assert from 'node:assert/strict';
import type { Build3DecisionRecord } from '../src/build-3-decision';
import {
  scoreBuild3NoTradeOutcome,
  summarizeBuild3NoTradeOutcomes,
  type Build3NoTradeTruthRow,
} from '../src/build-3-no-trade-efficacy';

const baseDecision:Build3DecisionRecord={
  decision_version:'MDOS_BUILD_3_DECISION_V1',
  engine:'EDGE_STOCKS',
  instrument:'LTF',
  source_id:'nt-1',
  issued_at:'2026-10-01T04:00:00.000Z',
  forecast_direction:'BULL',
  decision_state:'NO_TRADE',
  recommendation:'HOLD',
  tradeable:false,
  evidence_snapshot_id:'snap-1',
  evidence_hash:'a'.repeat(64),
  gate_results:[
    {gate:'MARKET_TRUST',passed:false,observed:45,threshold:'>=50'},
  ],
  rejecting_gates:['MARKET_TRUST'],
  counterfactual:{
    applicable:true,diagnostic_only:true,issued_trade:false,availability:'AVAILABLE',
    direction_candidate:'BULL',instrument_expression:'EQUITY',
    entry_logic:'issued diagnostic entry band 100..101',invalidation:'below 95',
    expected_rr:2,target1:110,target2:115,rejecting_gates:['MARKET_TRUST'],
  },
  execution_snapshot:{
    applicable:false,availability:'NOT_AVAILABLE',action:'NONE',instrument_expression:null,
    provider_instrument_key:null,entry_low:null,entry_high:null,stop:null,target1:null,target2:null,
    time_exit:null,efficacy_target:null,efficacy_target_label:null,entry_activation_rule:null,
    lifecycle_end:null,lifecycle_end_at:null,exact_contract_verified:false,reason:'NO_ISSUED_TRADE',
  },
};

function truth(pattern:Array<'HIT'|'MISS'|'NOT_SCORABLE'>):Build3NoTradeTruthRow[]{
  const labels=['D','D+1','D+2','D+3','D+4'] as const;
  return labels.map((horizon,index)=>({
    horizon,
    target_session:'2026-10-'+String(index+1).padStart(2,'0'),
    direction_result:pattern[index],
    scorability_state:pattern[index]==='NOT_SCORABLE'?'NOT_SCORABLE':'SCORABLE',
    scorability_reason:pattern[index]==='NOT_SCORABLE'?'SOURCE_INVALID':null,
  }));
}

test('directional counterfactual supported on four of five horizons is a missed opportunity',()=>{
  const row=scoreBuild3NoTradeOutcome({
    decision:baseDecision,
    truth:truth(['HIT','HIT','HIT','HIT','MISS']),
    evaluated_at:'2026-10-10T10:00:00.000Z',
  });
  assert.equal(row.outcome_classification,'MISSED_OPPORTUNITY');
  assert.equal(row.quality_hint,'MISSED');
  assert.equal(row.scorability_state,'SCORABLE');
});

test('directional counterfactual rejected on four of five horizons is a good avoid',()=>{
  const row=scoreBuild3NoTradeOutcome({
    decision:baseDecision,
    truth:truth(['MISS','MISS','MISS','MISS','HIT']),
  });
  assert.equal(row.outcome_classification,'GOOD_AVOID');
  assert.equal(row.quality_hint,'PROTECTED');
});

test('three-two split remains ambiguous rather than overclaiming',()=>{
  const row=scoreBuild3NoTradeOutcome({
    decision:baseDecision,
    truth:truth(['HIT','HIT','HIT','MISS','MISS']),
  });
  assert.equal(row.outcome_classification,'AMBIGUOUS');
  assert.equal(row.quality_hint,'INCONCLUSIVE');
});

test('range counterfactual supported across the lifecycle is a good avoid',()=>{
  const decision:Build3DecisionRecord={
    ...baseDecision,source_id:'nt-range',forecast_direction:'RANGE',
    counterfactual:{...baseDecision.counterfactual,direction_candidate:'RANGE'},
  };
  const row=scoreBuild3NoTradeOutcome({
    decision,truth:truth(['HIT','HIT','HIT','HIT','HIT']),
  });
  assert.equal(row.outcome_classification,'GOOD_AVOID');
  assert.equal(row.quality_hint,'PROTECTED');
});

test('supported counterfactual rejected only by execution gates is classified separately',()=>{
  const decision:Build3DecisionRecord={
    ...baseDecision,source_id:'nt-exec',
    gate_results:[
      {gate:'EXECUTION_EDGE',passed:false,observed:55,threshold:'>=65'},
      {gate:'EXPECTED_RR',passed:false,observed:1.4,threshold:'>=2.0'},
    ],
    rejecting_gates:['EXECUTION_EDGE','EXPECTED_RR'],
  };
  const row=scoreBuild3NoTradeOutcome({
    decision,truth:truth(['HIT','HIT','HIT','HIT','HIT']),
  });
  assert.equal(row.outcome_classification,'EXECUTION_REJECTION');
  assert.equal(row.execution_only_rejection,true);
  assert.equal(row.quality_hint,'MISSED');
});

test('conflicted frozen evidence is preserved as its own forensic class',()=>{
  const decision:Build3DecisionRecord={
    ...baseDecision,source_id:'nt-conflict',
    gate_results:[{gate:'EVIDENCE_GATE',passed:false,observed:'CONFLICTED',threshold:'PASS'}],
    rejecting_gates:['EVIDENCE_CONFLICT'],
  };
  const row=scoreBuild3NoTradeOutcome({
    decision,truth:truth(['HIT','HIT','HIT','HIT','HIT']),
  });
  assert.equal(row.outcome_classification,'EVIDENCE_CONFLICT');
  assert.equal(row.evidence_conflict,true);
  assert.equal(row.quality_hint,'MISSED');
});

test('unscorable matured truth becomes DATA_FAILURE, not a fabricated quality verdict',()=>{
  const row=scoreBuild3NoTradeOutcome({
    decision:baseDecision,
    truth:truth(['HIT','HIT','NOT_SCORABLE','HIT','HIT']),
  });
  assert.equal(row.outcome_classification,'DATA_FAILURE');
  assert.equal(row.scorability_state,'NOT_SCORABLE');
});

test('missing frozen counterfactual is explicitly NOT_SCORABLE',()=>{
  const decision:Build3DecisionRecord={
    ...baseDecision,source_id:'nt-none',
    counterfactual:{...baseDecision.counterfactual,availability:'NOT_AVAILABLE',direction_candidate:null},
  };
  const row=scoreBuild3NoTradeOutcome({
    decision,truth:truth(['HIT','HIT','HIT','HIT','HIT']),
  });
  assert.equal(row.outcome_classification,'NOT_SCORABLE');
  assert.equal(row.scorability_state,'NOT_SCORABLE');
});

test('NO TRADE summary reconciles forensic and quality-hint populations',()=>{
  const rows=[
    scoreBuild3NoTradeOutcome({decision:{...baseDecision,source_id:'a'},truth:truth(['MISS','MISS','MISS','MISS','HIT'])}),
    scoreBuild3NoTradeOutcome({decision:{...baseDecision,source_id:'b'},truth:truth(['HIT','HIT','HIT','HIT','MISS'])}),
    scoreBuild3NoTradeOutcome({decision:{...baseDecision,source_id:'c'},truth:truth(['HIT','HIT','HIT','MISS','MISS'])}),
  ];
  const s=summarizeBuild3NoTradeOutcomes(rows);
  assert.equal(s.total,3);
  assert.equal(s.good_avoid,1);
  assert.equal(s.missed_opportunity,1);
  assert.equal(s.ambiguous,1);
  assert.equal(s.protected_hint,1);
  assert.equal(s.missed_hint,1);
  assert.equal(s.inconclusive_hint,1);
  assert.equal(s.rejecting_gate_breakdown.MARKET_TRUST.observations,3);
  assert.equal(s.rejecting_gate_breakdown.MARKET_TRUST.good_avoid,1);
  assert.equal(s.rejecting_gate_breakdown.MARKET_TRUST.missed_opportunity,1);
});
