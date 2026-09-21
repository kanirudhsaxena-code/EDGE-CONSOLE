import test from 'node:test';
import assert from 'node:assert/strict';
import {actorIdFromEvidenceRows,effectiveRunReleasePolicy,storedActorFromMetadata} from '../src/run-isolation';

test('tester run is sandboxed only when identity enforcement is active',()=>{
  const enforced=effectiveRunReleasePolicy({actor:{id:'usr_a',role:'TESTER'},identity_enforced:true},true,true);
  assert.deepEqual(enforced,{sandbox:true,published:false,learning_eligible:false,completion_status:'SANDBOX'});
  const audit=effectiveRunReleasePolicy({actor:{id:'usr_a',role:'TESTER'},identity_enforced:false},true,true);
  assert.deepEqual(audit,{sandbox:false,published:true,learning_eligible:true,completion_status:'PUBLISHED'});
});

test('explicit sandbox request remains sandboxed even in audit mode',()=>{
  const policy=effectiveRunReleasePolicy({actor:{id:'sandbox_acceptance',role:'TESTER'},identity_enforced:false,sandbox_requested:true},true,true);
  assert.deepEqual(policy,{sandbox:true,published:false,learning_eligible:false,completion_status:'SANDBOX'});
});

test('owner run preserves requested publish and learning flags',()=>{
  const policy=effectiveRunReleasePolicy({actor:{id:'usr_owner',role:'OWNER'}},true,true);
  assert.equal(policy.sandbox,false);
  assert.equal(policy.published,true);
  assert.equal(policy.learning_eligible,true);
});

test('legacy unaffiliated run preserves canonical behavior',()=>{
  const policy=effectiveRunReleasePolicy({},true,true);
  assert.equal(policy.sandbox,false);
  assert.equal(policy.published,true);
  assert.equal(policy.learning_eligible,true);
});

test('evidence batch ownership requires one stable actor id',()=>{
  assert.equal(actorIdFromEvidenceRows([{metadata:{actor:{id:'usr_a'}}},{metadata:{actor:{id:'usr_a'}}}]),'usr_a');
  assert.equal(actorIdFromEvidenceRows([{metadata:{actor:{id:'usr_a'}}},{metadata:{actor:{id:'usr_b'}}}]),null);
  assert.equal(storedActorFromMetadata({actor:{id:'usr_a',role:'TESTER'}})?.id,'usr_a');
});
