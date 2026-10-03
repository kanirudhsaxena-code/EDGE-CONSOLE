import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mobile=fs.readFileSync('src/mobile-v1-entry.ts','utf8');
const router=fs.readFileSync('src/router.ts','utf8');
const renderer=fs.readFileSync('public/edge-live.js','utf8');

test('5DR Console persists acquisition provenance independently from canonical attempt metadata',()=>{
  assert.match(mobile,/run_provenance:/);
  assert.match(mobile,/trigger_type:canonicalAttempt\?'SCHEDULED':'USER'/);
  assert.match(mobile,/automatedRunProvenance\(body\)/);
  assert.match(router,/run_provenance: isObject\(metadata\.run_provenance\)/);
});

test('EDGE report exposes persisted provenance and separate all-run efficacy',()=>{
  assert.match(router,/edge_recommendation_governance/);
  assert.match(router,/market_session_as_of/);
  assert.match(router,/v_edge_all_run_assessment/);
  assert.match(router,/v_edge_stock_all_run_assessment/);
  assert.match(router,/run_provenance: currentGovernance/);
  assert.match(router,/all_run_efficacy:/);
});

test('presentation keeps benchmark and all-run semantics visibly separate',()=>{
  assert.match(renderer,/Benchmark status/);
  assert.match(renderer,/ALL VALID PRODUCTION RUNS/);
  assert.match(renderer,/Run provenance/);
  assert.match(renderer,/valid user canonical snapshot/);
});
