import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('legacy V1 research governance remains compatibility-only and frozen',()=>{
  const g=JSON.parse(fs.readFileSync('contracts/edge-research-governance-v1.json','utf8'));
  assert.equal(g.contract,'EDGE_RESEARCH_GOVERNANCE_V1');
  assert.equal(g.research_authority,'CHATGPT');
  assert.equal(g.fresh_web_research_required_every_run,true);
  assert.equal(g.frozen_methodology_changed,false);
});

test('production V2 locks DATA before autonomous research and exact lifecycle lineage',()=>{
  const g=JSON.parse(fs.readFileSync('contracts/edge-research-governance-v2.json','utf8'));
  assert.equal(g.contract,'EDGE_RESEARCH_GOVERNANCE_V2');
  assert.equal(g.status,'PRODUCTION_AUTHORITY');
  assert.deepEqual(g.lifecycle_order,['DATA','RESEARCH','RECONCILE','COMPUTE','PERSIST','PRESENT']);
  assert.equal(g.production_research_authority,'EDGE_SYSTEM');
  assert.equal(g.legacy_chatgpt_research_is_production_dependency,false);
  assert.equal(g.fresh_data_required_every_run,true);
  assert.equal(g.research_must_reference_current_lifecycle_id,true);
  assert.equal(g.research_must_reference_current_market_snapshot_id,true);
  assert.equal(g.research_must_begin_after_market_snapshot,true);
  assert.equal(g.mandatory_retrieval_provider,'SYSTEM_WEB');
  assert.equal(g.cross_lifecycle_research_reuse_prohibited,true);
  assert.deepEqual(g.mandatory_research_dimensions,[
    'BUSINESS_FUNDAMENTALS','INSTITUTIONAL_BEHAVIOUR','NEWS_EVENTS_CATALYSTS','VALUATION','EVENT_SHOCK'
  ]);
  assert.equal(g.frozen_methodology_changed,false);
});

test('Cloudflare production clock owns all pre-open production phases',()=>{
  const wrangler=fs.readFileSync('wrangler.jsonc','utf8');
  const scheduler=fs.readFileSync('src/preopen-scheduler.ts','utf8');
  assert.ok(wrangler.includes('"20 3 * * 1-5"'));
  assert.ok(wrangler.includes('"35-39 3 * * 1-5"'));
  assert.ok(wrangler.includes('"40-44 3 * * 1-5"'));
  assert.match(scheduler,/dispatchEdgeDataWorkflow/);
  assert.match(scheduler,/produceStockSystemResearch/);
  assert.match(scheduler,/dispatchEdgeAuctionWorkflow/);
  assert.match(scheduler,/lifecycle_id:lifecycleId/);
  assert.doesNotMatch(scheduler,/latest_research_fresh_at/);
  assert.doesNotMatch(scheduler,/research_not_before/);
});

test('router normal and canonical paths fail closed on lifecycle, research, and auction lineage',()=>{
  const source=fs.readFileSync('src/router.ts','utf8');
  assert.match(source,/beginNormalStockLifecycle\(env,ticker\)/);
  assert.match(source,/EDGE_LIFECYCLE_START_FAILED/);
  assert.match(source,/data_first:true/);
  assert.match(source,/EDGE_EXTERNAL_RESEARCH_COMPUTE_PROHIBITED/);
  assert.ok(
    source.indexOf('beginNormalStockLifecycle(env,ticker)') < source.indexOf('const dispatch = await dispatchEdgeWorkflow'),
    'normal run must establish DATA-first lifecycle before any compute dispatch path'
  );
  assert.match(source,/EDGE_CANONICAL_LIFECYCLE_REQUIRED/);
  assert.match(source,/EDGE_CANONICAL_AUCTION_NOT_READY/);
  assert.match(source,/EDGE_CANONICAL_RESEARCH_LINEAGE_MISMATCH/);
  assert.match(source,/contract_version\)!==EDGE_RESEARCH_BUNDLE_VERSION/);
});

test('user-facing top-level stock order remains frozen',()=>{
  const g=JSON.parse(fs.readFileSync('contracts/edge-research-governance-v2.json','utf8'));
  assert.deepEqual(g.user_facing_order,[
    'EDGE_MASTER_ASSESSMENT','ACTIVE_CALLS','CURRENT_STOCK_OUTCOME','DRILLDOWN'
  ]);
});
