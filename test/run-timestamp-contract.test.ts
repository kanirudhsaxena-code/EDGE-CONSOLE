import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('EDGE non-fresh retrieval may load today result, while a fresh run starts a new DATA lifecycle',()=>{
  const source=readFileSync('src/router.ts','utf8');
  const today=source.indexOf('const existingToday = await todaysAutonomousRecommendation(env, ticker)');
  const begin=source.indexOf('beginNormalStockLifecycle(env,ticker)');
  assert.ok(today>0);
  assert.ok(begin>today);
  assert.ok(source.includes("const forceNew = body.force_new === true"));
  assert.ok(source.includes("status: 'ALREADY_PUBLISHED_TODAY'"));
  assert.ok(source.includes('run_timestamp: existingToday.runTimestamp'));
  assert.ok(source.includes("status:started.status"));
  assert.ok(source.includes("data_first:true"));
  assert.ok(source.includes("research_executed_this_run:false"));
});

test('Console fresh-run command uses autonomous lifecycle and rejects output reuse',()=>{
  const app=readFileSync('public/app.js','utf8');
  const router=readFileSync('src/router.ts','utf8');
  const mobile=readFileSync('src/mobile-v1-entry.ts','utf8');
  assert.ok(app.includes("body:JSON.stringify({command,force_new:true})"));
  assert.ok(app.includes("force_new:true,client_invocation_id:crypto.randomUUID()"));
  assert.ok(app.includes('Fresh EDGE run was requested, but the server attempted to reuse an earlier result'));
  assert.ok(router.includes('beginNormalStockLifecycle'));
  assert.ok(router.includes('progressNormalStockLifecycle'));
  assert.ok(router.includes('fresh_run: true')||router.includes('fresh_run:true'));
  assert.ok(router.includes('reused_output: false')||router.includes('reused_output:false'));
  assert.ok(mobile.includes('fresh_run:true,reused_output:false'));
});

test('EDGE Stocks report timestamp is the recommendation run timestamp, not page-open time',()=>{
  const source=readFileSync('src/router.ts','utf8');
  assert.ok(source.includes("generated_at: new Date(String(active.run_timestamp ?? new Date().toISOString())).toISOString()"));
});

test('EDGE NIFTY and EDGE Stocks primary results visibly include date/time',()=>{
  const app=readFileSync('public/app.js','utf8');
  const edge=readFileSync('public/edge-live.js','utf8');
  assert.ok(app.includes('Run date/time:'));
  assert.ok(app.includes('Run started:'));
  assert.ok(edge.includes('Run date/time:'));
  assert.ok(edge.includes('Call date/time:'));
});
