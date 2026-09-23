import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LEARNING_STALE_AFTER_MS,
  decisionTargetStatus,
  learningPresentationState,
  validateLearningDecision,
} from '../src/learning-governance';

test('G4 decisions authorize build state only',()=>{
  assert.equal(decisionTargetStatus('APPROVE'),'APPROVED_FOR_BUILD');
  assert.equal(decisionTargetStatus('REJECT'),'REJECTED');
  assert.equal(decisionTargetStatus('DEFER'),'DEFERRED');
  assert.deepEqual(validateLearningDecision({candidate_id:'cand-1',action:'APPROVE',decision_context:{surface:'test'}}),[]);
  assert.ok(validateLearningDecision({candidate_id:'',action:'PROMOTE'}).length>=2);
});

test('G4 presentation state distinguishes live, partial, stale and failure',()=>{
  const now=Date.parse('2026-09-23T09:00:00Z');
  const live=learningPresentationState({as_of:'2026-09-23T08:00:00Z',snapshot_status:'COMPLETE',data_quality_state:'HEALTHY'},now);
  assert.equal(live.state,'LIVE');

  const partial=learningPresentationState({as_of:'2026-09-23T08:00:00Z',snapshot_status:'PARTIAL',data_quality_state:'HEALTHY'},now);
  assert.equal(partial.state,'PARTIAL');

  const stale=learningPresentationState({as_of:new Date(now-LEARNING_STALE_AFTER_MS-1).toISOString(),snapshot_status:'COMPLETE',data_quality_state:'HEALTHY'},now);
  assert.equal(stale.state,'STALE');

  const failed=learningPresentationState(null,now);
  assert.equal(failed.state,'FAILED');
});

test('G4 Console UI makes the production firewall explicit',()=>{
  const ui=fs.readFileSync('public/learning-lab.html','utf8');
  assert.match(ui,/Learning Lab Governance/);
  assert.match(ui,/Approve for build/);
  assert.match(ui,/APPROVED_FOR_BUILD/);
  assert.match(ui,/does not promote it to production/i);
  assert.match(ui,/Production remains unchanged/i);
  assert.match(ui,/cannot alter production logic/i);
  assert.match(ui,/\/api\/learning-lab\/governance-view/);
  assert.match(ui,/\/api\/learning-lab\/candidate-decision/);
});

test('G4 server contract hard-blocks automatic production promotion',()=>{
  const governance=fs.readFileSync('src/learning-governance.ts','utf8');
  assert.match(governance,/production_change_allowed:\s*false/);
  assert.match(governance,/production_promotion_authorized:\s*false/);
  assert.match(governance,/approval_scope:\s*'BUILD_VALIDATION_ONLY'/);
});
