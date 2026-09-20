import test from 'node:test';
import assert from 'node:assert/strict';
import { FIVE_DR_DIRECTIONAL_LABELS, validate5drResult } from '../src/index';

const validResult=(directional_label:string)=>({
  model_version:'5DR_V2_1',
  output_contract_version:'5DR_V2_1_2',
  horizon_slots:{'D+1':{},'D+2':{},'D+3':{},'D+4':{},'D+5':{}},
  des5:-20.375,
  directional_label,
  market_trust:45,
  market_trust_band:'LOW',
  probabilities:{BULL:7.873,RANGE:45.498,BEAR:46.629},
  execution_edge:0,
  tradeable:false,
  tradeability_blockers:['MARKET_TRUST_LT_50']
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
