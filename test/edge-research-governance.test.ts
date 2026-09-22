import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('EDGE research governance contract preserves frozen master-spec invariants',()=>{
  const g=JSON.parse(fs.readFileSync('contracts/edge-research-governance-v1.json','utf8'));
  assert.equal(g.contract,'EDGE_RESEARCH_GOVERNANCE_V1');
  assert.equal(g.research_authority,'CHATGPT');
  assert.equal(g.fresh_web_research_required_every_run,true);
  assert.equal(g.mandatory_retrieval_provider,'CHATGPT_WEB');
  assert.deepEqual(g.optional_retrieval_providers,['EXA']);
  assert.deepEqual(g.supporting_structured_providers,['UPSTOX']);
  assert.equal(g.material_provider_claim_requires_independent_web_validation,true);
  assert.equal(g.provider_self_validation_prohibited,true);
  assert.equal(g.scheduled_provider_only_publish_prohibited,true);
  assert.equal(g.frozen_methodology_changed,false);
  assert.deepEqual(g.user_facing_order,[
    'EDGE_MASTER_ASSESSMENT','ACTIVE_CALLS','CURRENT_STOCK_OUTCOME','DRILLDOWN'
  ]);
});

test('ChatGPT dispatch workflow transports a governed research bundle, not a ticker-only request',()=>{
  const y=fs.readFileSync('.github/workflows/edge-chat-research-dispatch.yml','utf8');
  assert.match(y,/edge-chat-requests/);
  assert.match(y,/EDGE_RESEARCH_BUNDLE_V1/);
  assert.match(y,/CHATGPT_WEB/);
  assert.match(y,/research_bundle/);
  assert.match(y,/api\/edge-stocks\/invoke/);
});


test('EDGE Stocks pre-open canonical workflow is redundant and research-fail-closed',()=>{
  const y=fs.readFileSync('.github/workflows/edge-stocks-preopen-canonical.yml','utf8');
  assert.match(y,/cron: '55 2 \\* \\* 1-5'/);
  assert.match(y,/cron: '20,25 3 \\* \\* 1-5'/);
  assert.match(y,/warmup=now\.replace\(hour=8,minute=40/);
  assert.match(y,/cutoff=now\.replace\(hour=8,minute=55/);
  assert.match(y,/api\/edge-stocks\/canonical-targets/);
  assert.match(y,/canonical_attempt/);
  assert.match(y,/EDGE_CANONICAL_RESEARCH_REFRESH_REQUIRED/);
  assert.match(y,/canonical_requested_at/);
});

test('EDGE router enforces 90-minute research freshness for canonical attempts',()=>{
  const source=fs.readFileSync('src/router.ts','utf8');
  assert.match(source,/canonicalAttempt \? 90 : 24 \* 60/);
  assert.match(source,/EDGE_CANONICAL_RESEARCH_REFRESH_REQUIRED/);
  assert.match(source,/\/api\/edge-stocks\/canonical-targets/);
});
