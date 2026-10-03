import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const router=readFileSync('src/router.ts','utf8');
const mobile=readFileSync('src/mobile-v1-entry.ts','utf8');

test('5DR execution refreshes the governed assessment handoff before release gating',()=>{
  assert.match(router,/FIVE_DR_ASSESSMENT_HANDOFF_URL/);
  assert.match(router,/5DR_ASSESSMENT_HANDOFF_V1/);
  assert.match(router,/refreshFiveDrAssessmentState\(sql\)/);
  assert.match(router,/assessment_refresh:assessmentRefresh/);
});

test('assessment freshness is based on snapshot creation time, not unchanged outcome assessed_at',()=>{
  assert.match(router,/select source_id,assessed_at,headline,metrics,created_at from assessment_rollups/);
  assert.match(router,/Date\.parse\(snapshotCreatedAt\)/);
  assert.match(router,/FIVE_DR_ASSESSMENT_SNAPSHOT_MAX_AGE_MS/);
  assert.doesNotMatch(router,/ageMs > 24\*60\*60_000/);
});

test('same forecast and assessed_at may be upgraded when prior imported metrics are incomplete',()=>{
  const importStart=router.indexOf('async function fiveDrAssessmentImport');
  const importEnd=router.indexOf('async function edgeStocksDispatchHealth',importStart);
  const block=router.slice(importStart,importEnd);
  assert.match(block,/select id,metrics/);
  assert.match(block,/fiveDrAssessmentMetricsComplete\(existing\[0\]\.metrics\)/);
  assert.match(block,/insert into assessment_rollups/);
  assert.match(block,/on conflict \(engine,source_id,assessed_at\) do update/);
  assert.match(block,/metrics=excluded\.metrics/);
});

test('assessment completeness requires D through D+4 and exact recommendation ledger count',()=>{
  assert.match(router,/\['D','D\+1','D\+2','D\+3','D\+4'\]/);
  assert.match(router,/recommendation_ledger_complete===true/);
  assert.match(router,/ledger\.length===expectedCount/);
});


test('stale handoff dispatches lightweight refresh and waits without weakening the gate',()=>{
  assert.match(mobile,/dispatch5drAssessmentRefresh\(env,requestId,request\.url,fetch\)/);
  assert.match(mobile,/STALE_ASSESSMENT_HANDOFF/);
  assert.match(mobile,/WAIT_FOR_ASSESSMENT_REFRESH/);
  assert.match(mobile,/assessment_refresh_dispatch/);
  assert.match(mobile,/status:'READY_FOR_ENGINE'/);
  assert.match(router,/const FIVE_DR_ASSESSMENT_SNAPSHOT_MAX_AGE_MS=2\*60\*60_000/);
});

test('non-stale assessment errors still fail closed at the original execution packet boundary',()=>{
  const start=mobile.indexOf('const packetResponse=await router.fetch');
  const end=mobile.indexOf('if(!Array.isArray(executionPacket.evidence)',start);
  const block=mobile.slice(start,end);
  assert.match(block,/staleAssessment=packetResponse\.status===409/);
  assert.match(block,/return json\(\{\.\.\.normalizedBody,\.\.\.executionPacket\},packetResponse\.status\)/);
});

test('assessment refresh production binding uses EDGE proxy transport while preserving 5DR implementation authority',()=>{
  const wrangler=readFileSync('wrangler.jsonc','utf8');
  assert.match(wrangler,/"FIVEDR_ASSESSMENT_REPOSITORY": "kanirudhsaxena-code\/EDGE---V1"/);
  assert.match(wrangler,/"FIVEDR_ASSESSMENT_WORKFLOW": "5dr-assessment-refresh-proxy\.yml"/);
});
