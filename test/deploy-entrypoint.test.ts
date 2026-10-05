import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('wrangler deploys the production wrapper while preserving mobile research governance, 5DR persistence and G4 Learning Lab governance',()=>{
  const wrangler=fs.readFileSync('wrangler.jsonc','utf8');
  assert.match(wrangler,/"main"\s*:\s*"src\/production-entry\.ts"/);

  const productionEntry=fs.readFileSync('src/production-entry.ts','utf8');
  assert.match(productionEntry,/from '\.\/mobile-v1-entry'/);
  assert.match(productionEntry,/from '\.\/index'/);
  assert.match(productionEntry,/from '\.\/learning-governance'/);
  assert.match(productionEntry,/url\.pathname === '\/api\/5dr\/runs'/);
  assert.match(productionEntry,/url\.pathname === '\/api\/learning-lab\/governance-view'/);
  assert.match(productionEntry,/url\.pathname === '\/api\/learning-lab\/candidate-decision'/);
  assert.match(productionEntry,/url\.pathname\.startsWith\('\/api\/learning-lab\/'\)/);
  assert.match(productionEntry,/return handleLearningGovernanceRequest\(request, env\)/);
  assert.match(productionEntry,/return app\.fetch\(request, env\)/);
  assert.match(productionEntry,/return mobile\.fetch\(request, env\)/);

  const entry=fs.readFileSync('src/mobile-v1-entry.ts','utf8');
  assert.match(entry,/research_contract_version:'EDGE_RESEARCH_BUNDLE_V2'/);
  assert.match(entry,/research_authority:'EDGE_SYSTEM'/);
  assert.match(entry,/fresh_data_required:true/);
  assert.match(entry,/fresh_web_research_required:true/);
  assert.match(entry,/data_first_lifecycle:true/);
  assert.match(entry,/chat_scheduled_task_dependency:false/);

  const legacyApp=fs.readFileSync('src/index.ts','utf8');
  assert.match(legacyApp,/url\.pathname==='\/api\/5dr\/runs'&&request\.method==='POST'/);
  assert.match(legacyApp,/url\.pathname==='\/api\/learning-lab\/snapshot-import'/);
  assert.match(legacyApp,/url\.pathname==='\/api\/learning-lab\/candidate-import'/);
});


test('deployment and smoke validators are locked to V2 and run smoke after deployment',()=>{
  const deploy=fs.readFileSync('.github/workflows/deploy.yml','utf8');
  const smoke=fs.readFileSync('.github/workflows/edge-production-smoke.yml','utf8');
  const worker=fs.readFileSync('src/worker.ts','utf8');

  for(const source of [deploy,smoke,worker]){
    assert.match(source,/EDGE_RESEARCH_BUNDLE_V2/);
    assert.match(source,/EDGE_SYSTEM/);
    assert.doesNotMatch(source,/EDGE_RESEARCH_BUNDLE_V1/);
    assert.doesNotMatch(source,/research_authority[^\n]*CHATGPT/);
  }
  assert.match(deploy,/fresh_data_required/);
  assert.match(deploy,/data_first_lifecycle/);
  assert.match(deploy,/chat_scheduled_task_dependency/);
  assert.match(smoke,/workflow_run:/);
  assert.match(smoke,/EDGE Console Deploy/);
  assert.doesNotMatch(smoke,/\n\s*push:\n/);
  assert.doesNotMatch(smoke,/EDGE_NEW_RUN_RESEARCH_REQUIRED/);
  assert.doesNotMatch(smoke,/EDGE NOFRESH123/);
  assert.match(smoke,/stock-data-snapshot\.yml/);
  assert.match(smoke,/stock-auction-snapshot\.yml/);
});
