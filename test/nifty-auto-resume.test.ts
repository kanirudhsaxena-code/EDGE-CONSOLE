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
  assert.ok(!app.includes("if(active&&latestReq.status==='PROCESSING')"));
});

test('EDGE NIFTY and EDGE Stocks expose run timestamps in the user view',()=>{
  const app=readFileSync('public/app.js','utf8');
  const edge=readFileSync('public/edge-live.js','utf8');
  assert.ok(app.includes('Run started: '));
  assert.ok(app.includes('Run date/time: '));
  assert.ok(edge.includes('Run date/time: '));
  assert.ok(edge.includes('Call date/time:'));
});
