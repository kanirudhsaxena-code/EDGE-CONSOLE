import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const proof=fs.readFileSync('scripts/g5-1-closure-proof.py','utf8');
const router=fs.readFileSync('src/router.ts','utf8');

test('live G5.1 closure proof is valid Python and exercises autonomous V2 rather than injected legacy research',()=>{
  const compile=spawnSync('python3',['-m','py_compile','scripts/g5-1-closure-proof.py'],{encoding:'utf8'});
  assert.equal(compile.status,0,compile.stderr || compile.stdout);
  assert.match(proof,/MDOS_G5_1_V2_LIVE_CLOSURE_PROOF/);
  assert.match(proof,/EDGE_RESEARCH_BUNDLE_V2/);
  assert.match(proof,/EDGE_SYSTEM/);
  assert.match(proof,/DATA-first lifecycle/);
  assert.match(proof,/research_bundle_id/);
  assert.match(proof,/market_snapshot_id/);
  assert.match(proof,/research_coverage/);
  assert.match(proof,/standard_table_count/);
  assert.match(proof,/ACTIVE_CALLS/);
  assert.match(proof,/CURRENT_STOCK_OUTCOME/);
  assert.match(proof,/DRILLDOWN/);
  assert.doesNotMatch(proof,/2026-10-04/);
  assert.doesNotMatch(proof,/load_stock_request/);
  assert.doesNotMatch(proof,/"research_bundle"\s*:/);
  assert.doesNotMatch(proof,/EDGE_RESEARCH_BUNDLE_V1/);
});

test('normal lifecycle status provides the bounded identities required for exact closure lineage',()=>{
  assert.match(router,/market_snapshot_id:progressed\.market_snapshot_id\?\?null/);
  assert.match(router,/research_bundle_id:progressed\.research_bundle_id\?\?null/);
  assert.match(router,/auction_snapshot_id:progressed\.auction_snapshot_id\?\?null/);
  assert.match(router,/report_url:/);
});
