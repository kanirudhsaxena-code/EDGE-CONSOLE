import { readFileSync } from 'node:fs';
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


const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('normal runtime surfaces are explicitly guarded by the default-off Build 3 flag',()=>{
  const mobile=read('src/mobile-v1-entry.ts');
  const router=read('src/router.ts');
  const preopen=read('src/preopen-scheduler.ts');
  const production=read('src/production-entry.ts');

  assert.match(mobile,/isBuild3RuntimeEnabled\(env\)/);
  assert.match(mobile,/if\(!isBuild3RuntimeEnabled\(env\)\)\{\s*const dispatch=await dispatch5drEngine/s);
  assert.match(router,/if\(isBuild3RuntimeEnabled\(env\)\)\{\s*const build3RunTimestamp/s);
  assert.match(router,/if\(!isBuild3RuntimeEnabled\(env\)\)\{\s*return \{\s*status:'COMPLETE'/s);
  assert.match(preopen,/if\(isBuild3RuntimeEnabled\(env\)\)\{\s*const build3Run=/s);
  assert.match(production,/if\(cron===BUILD3_TRUTH_CRON\)\{\s*if\(!isBuild3RuntimeEnabled\(env\)\)/s);
});

test('Build 3 isolation flag is opt-in and is not configured as a repository runtime default',()=>{
  const wrangler=read('wrangler.jsonc');
  assert.doesNotMatch(wrangler,/MDOS_BUILD3_ENABLED\s*[:=]\s*["']?(1|true|yes|on|enabled)/i);
});
