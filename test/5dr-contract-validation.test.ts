import test from 'node:test';
import assert from 'node:assert/strict';
import { FIVE_DR_DIRECTIONAL_LABELS, validate5drResult } from '../src/index';

const validResult=(directional_label:string)=>({
  model_version:'5DR_V2_1',
  output_contract_version:'5DR_V2_1_2',
  horizon_slots:{
    'D+1':{direction:'RANGE',probabilities:{BULL:25,RANGE:50,BEAR:25},zone_low:23000,zone_high:23300,basis:'test'},
    'D+2':{direction:'RANGE',probabilities:{BULL:25,RANGE:50,BEAR:25},zone_low:23000,zone_high:23400,basis:'test'},
    'D+3':{direction:'RANGE',probabilities:{BULL:25,RANGE:50,BEAR:25},zone_low:22950,zone_high:23450,basis:'test'},
    'D+4':{direction:'RANGE',probabilities:{BULL:25,RANGE:50,BEAR:25},zone_low:22900,zone_high:23500,basis:'test'},
    'D+5':{direction:'RANGE',probabilities:{BULL:25,RANGE:50,BEAR:25},zone_low:22850,zone_high:23550,basis:'test'}
  },
  des5:-20.375,
  directional_label,
  market_trust:45,
  market_trust_band:'LOW',
  probabilities:{BULL:7.873,RANGE:45.498,BEAR:46.629},
  execution_edge:0,
  tradeable:false,
  tradeability_blockers:['MARKET_TRUST_LT_50'],
  recommendation:'NO_TRADE',
  forecast_horizon:'D+5',
  expected_nifty_zone:{low:22850,high:23550},
  event_shock:{level:'LOW',transmission:'TWO_SIDED',convexity_warranted:false,kill_switch:false},
  tradeability_gate:{data_adequate:true,market_trust_pass:false,des5_pass:false,execution_edge_pass:false,event_kill_switch_inactive:true,rr_pass:false,expected_rr:0,event_shock:'LOW'},
  engine_diagnostics:{regime:'RANGE',component_scores:{},market_trust_inputs:{},execution_inputs:{}},
  forecast_assessment:'UNCHANGED — governed test assessment.',
  recommendation_assessment:'REJECTED — governed test recommendation assessment.',
  assessment_snapshot_complete:false,
  recommendation_ledger_complete:false,
  assessment_snapshot:null
});

test('Console accepts every canonical frozen 5DR directional label',()=>{
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


test('Console rejects incomplete day-wise scenario vectors',()=>{
  const bad=validResult('RANGE') as any;
  bad.horizon_slots['D+1'].probabilities={BULL:50,RANGE:40,BEAR:20};
  const errors=validate5drResult(bad);
  assert.ok(errors.some(error=>error.includes('probabilities must sum to 100')));
});

test('Console rejects selected daily direction that is not highest probability',()=>{
  const bad=validResult('RANGE') as any;
  bad.horizon_slots['D+1'].direction='BULLISH';
  const errors=validate5drResult(bad);
  assert.ok(errors.some(error=>error.includes('direction must match highest scenario probability')));
});
