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
  assert.match(entry,/research_contract_version:'EDGE_RESEARCH_BUNDLE_V1'/);
  assert.match(entry,/research_authority:'CHATGPT'/);
  assert.match(entry,/fresh_web_research_required:true/);

  const legacyApp=fs.readFileSync('src/index.ts','utf8');
  assert.match(legacyApp,/url\.pathname==='\/api\/5dr\/runs'&&request\.method==='POST'/);
  assert.match(legacyApp,/url\.pathname==='\/api\/learning-lab\/snapshot-import'/);
  assert.match(legacyApp,/url\.pathname==='\/api\/learning-lab\/candidate-import'/);
});
