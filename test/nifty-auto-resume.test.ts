import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('EDGE NIFTY automatically resumes every governed active stage',()=>{
  const app=readFileSync('public/app.js','utf8');
  assert.ok(app.includes("AUTOMATED_MARKET_DATA_PENDING"));
  assert.ok(app.includes("AUTOMATED_MARKET_DATA_READY"));
  assert.ok(app.includes("autoResumableStages"));
  assert.ok(app.includes("if(shouldAutoResume)"));
  assert.ok(app.includes("if(active)setTimeout(()=>loadDashboard(),5000)"));
  assert.ok(app.includes("ACTIVE_NIFTY_REQUEST_KEY"));
  assert.ok(app.includes("fetchExactNiftyRequest"));
  assert.ok(app.includes("rememberActiveNiftyRequest"));
  assert.ok(app.includes("if(active)setTimeout(()=>loadDashboard(),5000)"));
  assert.ok(!app.includes("Continue EDGE NIFTY"));
  assert.ok(!app.includes("resume5drRequest"));
});

test('EDGE NIFTY tracks the exact request launched by this browser, not the global newest request',()=>{
  const app=readFileSync('public/app.js','utf8');
  const mobile=readFileSync('src/mobile-v1-entry.ts','utf8');
  assert.ok(app.includes("edge-console-active-nifty-request-v1"));
  assert.ok(app.includes("/api/5dr/run-requests/'+encodeURIComponent(requestId)"));
  assert.ok(mobile.includes("async function exact5drRequest"));
  assert.ok(mobile.includes("request_id=${requestId}"));
});

test('EDGE NIFTY fresh invocation is explicit and never aliases a prior request',()=>{
  const app=readFileSync('public/app.js','utf8');
  const mobile=readFileSync('src/mobile-v1-entry.ts','utf8');
  assert.ok(app.includes("force_new:true,client_invocation_id:crypto.randomUUID()"));
  assert.ok(mobile.includes("const requestId=`5drreq_${crypto.randomUUID()}`"));
  assert.ok(mobile.includes("const batchId=`auto_${crypto.randomUUID()}`"));
  assert.ok(mobile.includes("invocation:{force_new:forceNew"));
});

test('EDGE NIFTY and EDGE Stocks expose run timestamps in the user view',()=>{
  const app=readFileSync('public/app.js','utf8');
  const edge=readFileSync('public/edge-live.js','utf8');
  assert.ok(app.includes('Run started: '));
  assert.ok(app.includes('Run date/time: '));
  assert.ok(edge.includes('Run date/time: '));
  assert.ok(edge.includes('Call date/time:'));
});
