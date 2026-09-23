import test from 'node:test';
import assert from 'node:assert/strict';
import {learningSnapshotOverview,sha256Hex,stableJson,validateLearningCandidate,validateLearningObservation,validateLearningSnapshot} from '../src/learning-lab';

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

test('5DR engine handoff payload satisfies Console G3 contract',()=>{
  const observation={
    observation_id:'llobs-5dr-contract',engine:'5DR',source_run_id:'forecast-123',run_role:'CANONICAL',
    official_efficacy_eligible:true,target_trading_date:'2026-09-23',horizon:'D',
    dimension:'CHECKPOINT_EFFICACY',observation_type:'SUCCESS',outcome_classification:'HIT',
    metrics:{directional_hit:true},evidence:{checkpoint_evaluation_id:456},
    exclusion_reason:null,observed_at:'2026-09-23T10:30:00+05:30',
    source_ref:'forecast:123:evaluation:456',production_change_allowed:false
  };
  const snapshot={
    snapshot_id:'llsnap-5dr-contract',engine:'5DR',cycle_id:'5DR-LL-2026-09-23',
    as_of:'2026-09-23T17:30:00+05:30',snapshot_status:'COMPLETE',data_quality_state:'PASS',
    methodology_versions:{forecast:'5DR_V2_1',recommendation_lifecycle:'5DR_V2_2_2'},
    source_lineage:{checkpoint_efficacy:'v_latest_forecast_checkpoint_evaluation'},
    snapshot:{official_efficacy_population:'SELECTED_CANONICAL_ONLY',production_change_allowed:false},
    counts:{runs_analyzed:1,canonical_runs:1,diagnostic_runs:0,manual_runs:0,shadow_runs:0,
      matured_outcomes:1,scorable_outcomes:1,data_gap_outcomes:0,new_observations:1,
      active_hypotheses:0,active_challengers:1,approval_required:1}
  };
  const candidate={
    candidate_id:'5dr-promotion-1',engine:'5DR',status:'PENDING_USER_APPROVAL',
    proposal:{promotion_proposal_id:1,challenger_id:'challenger-1'},baseline_metrics:{comparison:{}},
    challenger_metrics:{},validation_state:{eligibility_checks:{}},production_change_allowed:false
  };
  assert.deepEqual(validateLearningObservation(observation),[]);
  assert.deepEqual(validateLearningSnapshot(snapshot),[]);
  assert.deepEqual(validateLearningCandidate(candidate),[]);
});

test('EDGE Stocks engine handoff payload satisfies Console G3 contract',()=>{
  const observation={
    observation_id:'llobs-edge-contract',engine:'EDGE_STOCKS',source_run_id:'EDGE-LTF-1',run_role:'DIAGNOSTIC',
    official_efficacy_eligible:false,target_trading_date:'2026-09-23',horizon:'TRADE',
    dimension:'RECOMMENDATION_OUTCOME',observation_type:'ERROR',outcome_classification:'LOSS',
    metrics:{model_return_pct:-1.2,direction_hit:false,zone_result:'MISS',mfe_pct:0.3,mae_pct:-1.6},
    evidence:{source_ref:'checkpoint:77'},exclusion_reason:'NON_CANONICAL',
    observed_at:'2026-09-23T16:30:00+05:30',source_ref:'checkpoint:77',production_change_allowed:false
  };
  const snapshot={
    snapshot_id:'llsnap-edge-contract',engine:'EDGE_STOCKS',cycle_id:'EDGE-LL-20260923',
    as_of:'2026-09-23T16:45:00+05:30',snapshot_status:'COMPLETE',data_quality_state:'PASS',
    methodology_versions:{EDGE:'EDGE_V1'},source_lineage:{engine_database:'EDGE'},
    snapshot:{official_efficacy_population:'SELECTED_CANONICAL_ONLY',learning_population:'ALL_ELIGIBLE_RUN_ROLES_DAY_NORMALIZED',production_change_allowed:false},
    counts:{runs_analyzed:2,canonical_runs:1,diagnostic_runs:1,manual_runs:0,shadow_runs:0,
      matured_outcomes:1,scorable_outcomes:0,data_gap_outcomes:0,new_observations:1,
      active_hypotheses:0,active_challengers:0,approval_required:0}
  };
  assert.deepEqual(validateLearningObservation(observation),[]);
  assert.deepEqual(validateLearningSnapshot(snapshot),[]);
});
