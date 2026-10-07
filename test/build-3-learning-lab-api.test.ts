import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../src/mobile-v1-entry.ts',import.meta.url),'utf8');

test('Build 3 Learning Lab API is owner-only, opt-in, scoped and persistent',()=>{
  assert.match(source,/\/api\/build3\/learning-lab/);
  assert.match(source,/request\.method==='POST'/);
  assert.match(source,/if\(!isBuild3RuntimeEnabled\(env\)\)return json\(\{error:'Not found'\},404\)/);
  assert.match(source,/actor\.role!=='OWNER'/);
  assert.match(source,/readBuild3LearningLab\(env\.DATABASE_URL/);
  assert.match(source,/from_date/);
  assert.match(source,/to_date/);
  assert.match(source,/production_mutation_allowed:false/);
});

test('challenger event API records explicit approval but never applies production mutation',()=>{
  assert.match(source,/\/api\/build3\/challengers\/\(\[\^\/\]\+\)\\\/events/);
  assert.match(source,/prepareBuild3ChallengerEvent/);
  assert.match(source,/persistBuild3ChallengerEvent/);
  assert.match(source,/explicit_user_approval:body\.explicit_user_approval===true/);
  assert.match(source,/production_mutation_applied:false/);
});
