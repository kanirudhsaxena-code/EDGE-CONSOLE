import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const nifty=fs.readFileSync('.github/workflows/5dr-preopen-canonical.yml','utf8');
const stocks=fs.readFileSync('.github/workflows/edge-stocks-preopen-canonical.yml','utf8');
const entry=fs.readFileSync('src/production-entry.ts','utf8');

function assertProtectedSchedule(workflow:string){
  // Legacy GitHub jobs remain manual-only. Cloudflare Cron is the timing authority;
  // if invoked manually, runtime wall-clock still enforces 09:10:00-09:14:59 IST.
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/\n\s*schedule:/);
  assert.match(workflow,/ZoneInfo\("Asia\/Kolkata"\)/);
  assert.match(workflow,/replace\(hour=8,minute=50,second=0,microsecond=0\)/);
  assert.match(workflow,/replace\(hour=9,minute=10,second=0,microsecond=0\)/);
  assert.match(workflow,/replace\(hour=9,minute=14,second=59,microsecond=999999\)/);
  assert.match(workflow,/PREOPEN_MISSING_OUTSIDE_AUCTION_WINDOW/);
  assert.match(workflow,/canonical_created[^\n]*False/);
  assert.match(workflow,/"canonical_attempt":True/);
  assert.match(workflow,/"canonical_attempt_slot":slot/);
  assert.doesNotMatch(workflow,/replace\(hour=8,minute=40/);
  assert.doesNotMatch(workflow,/PREOPEN_SLOT_SKIPPED_OUTSIDE_WINDOW/);
}

test('protected NIFTY pre-open canonical contract remains fixed',()=>{
  assertProtectedSchedule(nifty);
  assert.match(nifty,/EDGE NIFTY Pre-open Canonical Attempts/);
  assert.match(nifty,/PREP_BUNDLE_WINDOW_OK/);
  assert.match(nifty,/\/api\/5dr\/automated-runs/);
  assert.match(nifty,/force_new":True/);
  assert.match(nifty,/PREOPEN_RUN_COMPLETED/);
  assert.match(nifty,/PREOPEN_RUN_FAILED/);
  assert.match(nifty,/PREOPEN_RUN_TIMEOUT/);
});

test('protected EDGE Stocks/LTF pre-open canonical contract remains fixed',()=>{
  assertProtectedSchedule(stocks);
  assert.match(stocks,/EDGE Stocks Pre-open Canonical Attempts/);
  assert.match(stocks,/PREP_BUNDLE_TARGETS_RESOLVED/);
  assert.match(stocks,/\/api\/edge-stocks\/canonical-targets/);
  assert.match(stocks,/\/api\/edge-stocks\/invoke/);
  assert.match(stocks,/\/api\/edge-stocks\/invoke\/status/);
  assert.match(stocks,/command":f"EDGE \{ticker\}"/);
  assert.match(stocks,/RESEARCH_REFRESH_REQUIRED/);
  assert.match(stocks,/"state":"MISSING"/);
  assert.match(stocks,/EDGE_STOCKS_PREOPEN_ATTEMPT_COMPLETE/);
  assert.match(stocks,/"trading_enabled":False/);
});

test('production wrapper preserves canonical orchestration fallback',()=>{
  assert.match(entry,/return mobile\.fetch\(request, env\)/);
  assert.doesNotMatch(entry,/url\.pathname === '\/api\/5dr\/automated-runs'/);
  assert.doesNotMatch(entry,/url\.pathname === '\/api\/edge-stocks\/invoke'/);
});
