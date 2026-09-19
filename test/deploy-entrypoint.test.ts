import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('wrangler deploys the entrypoint covered by research-governance health assertions',()=>{
  const wrangler=fs.readFileSync('wrangler.jsonc','utf8');
  assert.match(wrangler,/"main"\s*:\s*"src\/mobile-v1-entry\.ts"/);
  const entry=fs.readFileSync('src/mobile-v1-entry.ts','utf8');
  assert.match(entry,/research_contract_version:'EDGE_RESEARCH_BUNDLE_V1'/);
  assert.match(entry,/research_authority:'CHATGPT'/);
  assert.match(entry,/fresh_web_research_required:true/);
});
