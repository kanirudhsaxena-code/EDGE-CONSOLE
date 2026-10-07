import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../src/mobile-v1-entry.ts',import.meta.url),'utf8');

test('Build 3 scorecard API is explicit, opt-in and owner-gated',()=>{
  assert.match(source,/\/api\/build3\/scorecard/);
  assert.match(source,/if\(!isBuild3RuntimeEnabled\(env\)\)return json\(\{error:'Not found'\},404\)/);
  assert.match(source,/actor\.role!=='OWNER'/);
  assert.match(source,/readBuild3Scorecard/);
  assert.match(source,/engine must be ALL, 5DR or EDGE_STOCKS/);
  assert.match(source,/trading_enabled:false,build3_runtime:true/);
});
