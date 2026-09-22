import test from 'node:test';
import assert from 'node:assert/strict';
import { FIVE_DR_DIRECTIONAL_LABELS, validate5drResult } from '../src/index';

const horizons={
  'D+1':{direction:'BULLISH',probabilities:{BULL:58,RANGE:30,BEAR:12},zone_low:23000,zone_high:23300,basis:'Price structure'},
  'D+2':{direction:'BULLISH',probabilities:{BULL:57,RANGE:31,BEAR:12},zone_low:22950,zone_high:23400,basis:'Price structure'},
  'D+3':{direction:'RANGE',probabilities:{BULL:25,RANGE:55,BEAR:20},zone_low:22900,zone_high:23450,basis:'Mixed confirmation'},
  'D+4':{direction:'RANGE',probabilities:{BULL:25,RANGE:54,BEAR:21},zone_low:22850,zone_high:23500,basis:'Mixed confirmation'},
  'D+5':{direction:'RANGE',probabilities:{BULL:25,RANGE:53,BEAR:22},zone_low:22800,zone_high:23550,basis:'Wider uncertainty'}
};

const validResult=(directional_label:string)=>{
  const scenario=directional_label.includes('BULL')?'BULL':directional_label.includes('BEAR')?'BEAR':'RANGE';
  const probabilities=scenario==='BULL'?{BULL:60,RANGE:30,BEAR:10}:scenario==='BEAR'?{BULL:10,RANGE:30,BEAR:60}:{BULL:25,RANGE:50,BEAR:25};
  return {
    model_version:'5DR_V2_1',
    output_contract_version:'5DR_V2_1_2',
    forecast_assessment:'UNCHANGED — governed forecast assessment with evidence, predecessor change and principal risk.',
    forecast_assessment_class:'UNCHANGED',
    recommendation_assessment:'REJECTED — governed thresholds, Event Shock and trade-specific risk recorded.',
    assessment_snapshot_complete:true,
    assessment_snapshot:{metrics:{assessment_snapshot_complete:true,recommendation_ledger_complete:true}},
    horizon_slots:horizons,
    recommendation_ledger_complete:true,
    recommendation_ledger:[],
    des5:scenario==='BULL'?35:scenario==='BEAR'?-35:0,
    directional_label,
    market_trust:70,
    market_trust_band:'GOOD',
    probabilities,
    regime:'RANGE',
    event_shock:{level:'LOW',expected_transmission:'TWO_SIDED',convexity_warranted:'NO',kill_switch:false},
    expected_nifty_zone:{low:22800,high:23550,source_horizon:'D+5'},
    execution_edge:0,
    tradeable:false,
    directional_trade:false,
    tradeability_blockers:['DES5_LT_30'],
    recommendation:'NO_TRADE',
    trade_plan:{recommendation:'NO_TRADE',instrument:'NONE'},
    engine_diagnostics:{},
    evidence_delta:{}
  };
};

test('Console accepts every canonical frozen 5DR directional label with complete release package',()=>{
  assert.deepEqual(FIVE_DR_DIRECTIONAL_LABELS,[
    'STRONG_BULL','BULL','MILD_BULL','RANGE','MILD_BEAR','BEAR','STRONG_BEAR'
  ]);
  for(const label of FIVE_DR_DIRECTIONAL_LABELS){
    assert.deepEqual(validate5drResult(validResult(label)),[],label);
  }
});

test('Console rejects directional labels outside canonical 5DR contract',()=>{
  const errors=validate5drResult(validResult('UP'));
  assert.ok(errors.some(error=>error.includes('canonical 5DR directional label set')));
});

test('Console rejects raw deterministic engine result that bypasses the release package',()=>{
  const bad:any=validResult('RANGE');
  delete bad.forecast_assessment;
  delete bad.recommendation_assessment;
  delete bad.assessment_snapshot;
  delete bad.recommendation_ledger;
  const errors=validate5drResult(bad);
  assert.ok(errors.some(error=>error.includes('forecast_assessment')));
  assert.ok(errors.some(error=>error.includes('recommendation_assessment')));
  assert.ok(errors.some(error=>error.includes('assessment_snapshot')));
  assert.ok(errors.some(error=>error.includes('recommendation_ledger')));
});

test('Console rejects obsolete one-number D+5 probability',()=>{
  const bad:any=validResult('RANGE');
  bad.horizon_slots={...bad.horizon_slots,'D+5':{direction:'BULLISH',probability:35,zone_low:22800,zone_high:23550,basis:'obsolete'}};
  const errors=validate5drResult(bad);
  assert.ok(errors.some(error=>error.includes('D+5')&&error.includes('probabilities')));
});
