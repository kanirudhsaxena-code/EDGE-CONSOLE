import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(name:string)=>readFileSync(new URL('../test/'+name,import.meta.url),'utf8');

test('Build 3 regression suite retains the efficacy boundary matrix',()=>{
  const zone=read('build-3-efficacy-contract.test.ts');
  assert.match(zone,/5%|5\.00|5pct|5PCT/i);
  assert.match(zone,/3%|3pct|3PCT/i);
  assert.match(zone,/GREEN/);
  assert.match(zone,/AMBER/);
  assert.match(zone,/RED/);
  assert.match(zone,/zero|width|NOT_SCORABLE/i);
});

test('Build 3 regression suite retains recommendation dual-hit semantics',()=>{
  const rec=read('build-3-recommendation-efficacy.test.ts')+read('build-3-recommendation-observation.test.ts');
  for(const label of ['TARGET_ONLY','SL_ONLY','DUAL_TOUCH','TIMEOUT_NO_TARGET','UNTRIGGERED']){
    assert.match(rec,new RegExp(label));
  }
  assert.match(rec,/ONE_MINUTE/);
  assert.match(rec,/ENTRY_MINUTE_TARGET_SL_SEQUENCE_AMBIGUOUS/);
});

test('Build 3 regression suite retains NO TRADE and learning-governance coverage',()=>{
  const noTrade=read('build-3-no-trade-efficacy.test.ts');
  for(const label of ['GOOD_AVOID','MISSED_OPPORTUNITY','AMBIGUOUS','DATA_FAILURE','EVIDENCE_CONFLICT','EXECUTION_REJECTION','NOT_SCORABLE']){
    assert.match(noTrade,new RegExp(label));
  }
  const attribution=read('build-3-attribution.test.ts');
  assert.match(attribution,/UNKNOWN_DIRECTION_CAUSE/);
  assert.match(attribution,/Wilson|wilson/i);
  const learning=read('build-3-learning-lab.test.ts');
  assert.match(learning,/CHALLENGER/);
  assert.match(learning,/DEFER/);
  const governance=read('build-3-challenger-governance.test.ts');
  assert.match(governance,/EXPLICIT_USER_APPROVAL_REQUIRED/);
});

test('Build 3 regression suite retains population and retry controls',()=>{
  const truth=read('build-3-truth-metrics.test.ts');
  assert.match(truth,/independent|same.*day|repeated/i);
  const retry=read('build-3-retry-integrity.test.ts');
  assert.match(retry,/RETRYABLE_ERROR/);
  assert.match(retry,/immutable/i);
});
