import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const nifty=fs.readFileSync('.github/workflows/5dr-preopen-canonical.yml','utf8');
const stocks=fs.readFileSync('.github/workflows/edge-stocks-preopen-canonical.yml','utf8');
const entry=fs.readFileSync('src/production-entry.ts','utf8');

function assertProtectedSchedule(workflow:string){
  // 08:25 IST pre-warm plus 08:50/08:55 backup starts. Each job waits until
  // the protected 08:40 IST canonical window and fails closed after 08:55:59.
  assert.match(workflow,/cron:\s*'55 2 \* \* 1-5'/);
  assert.match(workflow,/cron:\s*'20,25 3 \* \* 1-5'/);
  assert.match(workflow,/ZoneInfo\("Asia\/Kolkata"\)/);
  assert.match(workflow,/replace\(hour=8,minute=40,second=0,microsecond=0\)/);
  assert.match(workflow,/replace\(hour=8,minute=55,second=59,microsecond=999999\)/);
  assert.match(workflow,/PREOPEN_SLOT_SKIPPED_OUTSIDE_WINDOW/);
  assert.match(workflow,/"canonical_attempt":True/);
  assert.match(workflow,/"canonical_attempt_slot":slot/);
}

test('protected NIFTY pre-open canonical contract remains fixed',()=>{
  assertProtectedSchedule(nifty);
  assert.match(nifty,/EDGE NIFTY Pre-open Canonical Attempts/);
  assert.match(nifty,/\/api\/5dr\/automated-runs/);
  assert.match(nifty,/force_new":True/);
  assert.match(nifty,/PREOPEN_RUN_COMPLETED/);
  assert.match(nifty,/PREOPEN_RUN_FAILED/);
  assert.match(nifty,/PREOPEN_RUN_TIMEOUT/);
});

test('protected EDGE Stocks/LTF pre-open canonical contract remains fixed',()=>{
  assertProtectedSchedule(stocks);
  assert.match(stocks,/EDGE Stocks Pre-open Canonical Attempts/);
  assert.match(stocks,/\/api\/edge-stocks\/canonical-targets/);
  assert.match(stocks,/\/api\/edge-stocks\/invoke/);
  assert.match(stocks,/\/api\/edge-stocks\/invoke\/status/);
  assert.match(stocks,/command":f"EDGE \{ticker\}"/);
  assert.match(stocks,/EDGE_STOCKS_PREOPEN_ATTEMPT_COMPLETE/);
  assert.match(stocks,/"trading_enabled":False/);
});

test('production wrapper preserves canonical orchestration fallback',()=>{
  // G4 Learning Lab routing must stay additive. Canonical orchestration routes
  // continue through the established mobile entrypoint and must not be captured
  // by the Learning Lab governance handler.
  assert.match(entry,/return mobile\.fetch\(request, env\)/);
  assert.doesNotMatch(entry,/url\.pathname === '\/api\/5dr\/automated-runs'/);
  assert.doesNotMatch(entry,/url\.pathname === '\/api\/edge-stocks\/invoke'/);
});
