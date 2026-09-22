import test from 'node:test';
import assert from 'node:assert/strict';
import {learningSnapshotOverview,sha256Hex,stableJson,validateLearningObservation,validateLearningSnapshot} from '../src/learning-lab';

test('stable JSON is deterministic across object key order',()=>{
  assert.equal(stableJson({b:2,a:{z:1,y:2}}),stableJson({a:{y:2,z:1},b:2}));
});

test('hash is deterministic for semantically identical key order',async()=>{
  assert.equal(await sha256Hex({b:2,a:1}),await sha256Hex({a:1,b:2}));
});

test('observation requires explicit exclusion reason when non-official',()=>{
  const base={
    observation_id:'obs-1',engine:'5DR',source_run_id:'run-1',run_role:'DIAGNOSTIC',
    official_efficacy_eligible:false,target_trading_date:'2026-09-22',horizon:'D',
    dimension:'PROBABILITY_CALIBRATION',observation_type:'ERROR',metrics:{},evidence:{},
    observed_at:'2026-09-22T10:00:00+05:30',source_ref:'assessment:1'
  };
  assert.ok(validateLearningObservation(base).includes('exclusion_reason is mandatory when official_efficacy_eligible=false'));
  assert.deepEqual(validateLearningObservation({...base,exclusion_reason:'NON_CANONICAL'}),[]);
});

test('snapshot rejects population arithmetic that could inflate evidence',()=>{
  const snapshot={
    snapshot_id:'snap-1',engine:'EDGE_STOCKS',cycle_id:'cycle-1',as_of:'2026-09-22T17:30:00+05:30',
    snapshot_status:'COMPLETE',data_quality_state:'PASS',methodology_versions:{EDGE:'EDGE_V1'},
    source_lineage:{},snapshot:{},counts:{
      runs_analyzed:2,canonical_runs:1,diagnostic_runs:2,manual_runs:0,shadow_runs:0,
      matured_outcomes:1,scorable_outcomes:1,data_gap_outcomes:1,new_observations:1,
      active_hypotheses:0,active_challengers:0,approval_required:0
    }
  };
  const errors=validateLearningSnapshot(snapshot);
  assert.ok(errors.includes('run-role counts cannot exceed runs_analyzed'));
  assert.ok(errors.includes('scorable + data-gap outcomes cannot exceed matured_outcomes'));
});

test('overview never authorizes production change',()=>{
  const view=learningSnapshotOverview({snapshot_id:'s',engine:'5DR',approval_required:2,runs_analyzed:3});
  assert.equal(view?.action_state,'APPROVAL_REQUIRED');
  assert.equal(view?.production_change_allowed,false);
});
