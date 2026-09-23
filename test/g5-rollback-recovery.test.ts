import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const deploy=fs.readFileSync('.github/workflows/deploy.yml','utf8');
const recovery=fs.readFileSync('.github/workflows/g5-rollback-recovery.yml','utf8');
const canonicalNifty=fs.readFileSync('.github/workflows/5dr-preopen-canonical.yml','utf8');
const canonicalStocks=fs.readFileSync('.github/workflows/edge-stocks-preopen-canonical.yml','utf8');

test('G5 deploys are tagged to immutable git provenance and health-checked',()=>{
  assert.match(deploy,/TAG="git-\$\{GITHUB_SHA:0:12\}"/);
  assert.match(deploy,/wrangler deploy/);
  assert.match(deploy,/--tag "\$TAG"/);
  assert.match(deploy,/--message "EDGE-CONSOLE git=\$GITHUB_SHA workflow=\$GITHUB_RUN_ID"/);
  assert.match(deploy,/wrangler versions list --json/);
  assert.match(deploy,/wrangler deployments list --json/);
  assert.match(deploy,/Verify tagged version is the active deployment/);
  assert.match(deploy,/Verify production health after tagged deploy/);
  assert.match(deploy,/EDGE_RESEARCH_BUNDLE_V1/);
});

test('G5 rollback is owner-only, explicit, exact-target and dry-run by default',()=>{
  assert.match(recovery,/name: G5 Production Rollback Recovery/);
  assert.match(recovery,/dry_run:[\s\S]*default: true/);
  assert.match(recovery,/test "\$GITHUB_ACTOR" = "\$GITHUB_REPOSITORY_OWNER"/);
  assert.match(recovery,/test "\$RECOVERY_CONFIRMATION" = 'ROLLBACK EDGE-CONSOLE'/);
  assert.match(recovery,/target_version_id must be an exact Cloudflare Worker UUID/);
  assert.match(recovery,/group: g5-production-recovery/);
  assert.match(recovery,/cancel-in-progress: false/);
});

test('G5 live rollback accepts only governed versions with prior green evidence',()=>{
  assert.match(recovery,/wrangler versions list --json/);
  assert.match(recovery,/git-\[0-9a-f\]\{12\}/i);
  assert.match(recovery,/successful EDGE Console Deploy run/);
  assert.match(recovery,/successful EDGE Production Smoke run/);
  assert.match(recovery,/wrangler rollback "\$TARGET_VERSION_ID"/);
  assert.match(recovery,/Prove requested version is active after rollback/);
  assert.match(recovery,/Validate production health after rollback/);
  assert.match(recovery,/G5_ROLLBACK_HEALTHY/);
  assert.match(recovery,/actions\/upload-artifact@v4/);
});

test('G5 does not weaken the protected 08:40 NIFTY/LTF canonical contract',()=>{
  for(const workflow of [canonicalNifty,canonicalStocks]){
    assert.match(workflow,/replace\(hour=8,minute=40,second=0,microsecond=0\)/);
    assert.match(workflow,/replace\(hour=8,minute=55,second=59,microsecond=999999\)/);
    assert.match(workflow,/"canonical_attempt":True/);
    assert.match(workflow,/"canonical_attempt_slot":slot/);
    assert.match(workflow,/PREOPEN_SLOT_SKIPPED_OUTSIDE_WINDOW/);
  }
  assert.match(canonicalNifty,/\/api\/5dr\/automated-runs/);
  assert.match(canonicalStocks,/\/api\/edge-stocks\/canonical-targets/);
  assert.match(canonicalStocks,/"trading_enabled":False/);
});
