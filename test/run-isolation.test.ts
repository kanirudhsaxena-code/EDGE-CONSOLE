import test from 'node:test';
import assert from 'node:assert/strict';
import {actorIdFromEvidenceRows,effectiveRunReleasePolicy,storedActorFromMetadata} from '../src/run-isolation';

test('tester run is always sandboxed and excluded from learning',()=>{
  const policy=effectiveRunReleasePolicy({actor:{id:'usr_a',role:'TESTER'}},true,true);
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
