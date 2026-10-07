import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD3_ISOLATION_CONTRACT, isBuild3RuntimeEnabled } from '../src/build-3-isolation';

test('Build 3 runtime is disabled by default so Build 2.0 never depends on it',()=>{
  assert.equal(isBuild3RuntimeEnabled({}),false);
  assert.equal(isBuild3RuntimeEnabled(undefined),false);
  assert.equal(BUILD3_ISOLATION_CONTRACT.build2_dependency_allowed,false);
  assert.equal(BUILD3_ISOLATION_CONTRACT.build25_dependency_allowed,false);
  assert.equal(BUILD3_ISOLATION_CONTRACT.production_merge_allowed,false);
});

test('Build 3 runtime requires an explicit affirmative flag',()=>{
  for(const value of ['1','true','TRUE','yes','on','enabled']){
    assert.equal(isBuild3RuntimeEnabled({MDOS_BUILD3_ENABLED:value}),true);
  }
  for(const value of ['0','false','off','','preview']){
    assert.equal(isBuild3RuntimeEnabled({MDOS_BUILD3_ENABLED:value}),false);
  }
});
