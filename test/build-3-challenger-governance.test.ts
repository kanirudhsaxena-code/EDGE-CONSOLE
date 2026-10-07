import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBuild3ChallengerEvent,compareBuild3Challenger } from '../src/build-3-challenger-governance';
import type { Build3ChallengerProposal } from '../src/build-3-learning-lab';
import { buildBuild3Scorecard } from '../src/build-3-scorecard';
import { summarizeBuild3Truth, type Build3TruthMetricRow } from '../src/build-3-truth-metrics';
import { summarizeBuild3RecommendationEfficacy } from '../src/build-3-efficacy-contract';
import { summarizeBuild3NoTradeOutcomes } from '../src/build-3-no-trade-efficacy';

const proposal:Build3ChallengerProposal={
  challenger_id:'b3ch_test',challenger_version:'MDOS_BUILD_3_CHALLENGER_V1',
  created_at:'2026-10-07T12:00:00.000Z',source_learning_snapshot_id:'b3ll_test',
  challenger_type:'ZONE_DEVIATION_TOLERANCE',target_cohort:{scope:'CORE_ZONE_ALL'},
  hypothesis:{proposed_change:{primary_deviation_tolerance_pct:3}},
  expected_benefit:'tighten precision',risks:['false negatives'],
  evidence:{},status:'PROPOSED',production_mutation_allowed:false,
};

test('approval and promotion are impossible without explicit user approval',()=>{
  assert.throws(
    ()=>prepareBuild3ChallengerEvent({challenger_id:'b3ch_test',event_type:'APPROVED'}),
    /EXPLICIT_USER_APPROVAL_REQUIRED/
  );
  assert.throws(
    ()=>prepareBuild3ChallengerEvent({challenger_id:'b3ch_test',event_type:'PROMOTED',explicit_user_approval:false}),
    /EXPLICIT_USER_APPROVAL_REQUIRED/
  );
  const approved=prepareBuild3ChallengerEvent({
    challenger_id:'b3ch_test',event_type:'APPROVED',explicit_user_approval:true,
    actor:'USER',event_at:'2026-10-07T13:00:00.000Z'
  });
  assert.equal(approved.explicit_user_approval,true);
});

test('same-population zone challenger compares 5% and 3% without becoming promotion-eligible',()=>{
  const truthRow:Build3TruthMetricRow={
    engine:'5DR',instrument:'NIFTY',source_id:'x',horizon:'D',target_session:'2026-10-07',
    issued_at:'2026-10-06T04:00:00.000Z',run_time_bucket:'PRE_OPEN',direction_result:'HIT',
    outer_touch:true,outer_close_hit:true,core_touch:true,core_close_hit:true,
    outer_efficacy_state:'SCORABLE',core_efficacy_state:'SCORABLE',
    outer_deviation_hit:true,core_deviation_hit:true,
    outer_challenger_3pct_hit:true,core_challenger_3pct_hit:false,
    outer_quality_status:'GREEN',core_quality_status:'GREEN',
    outer_range_deviation_pct:1,core_range_deviation_pct:4,
    normalized_centre_error:0.2,brier_score:0.1,probability_state:'SCORABLE',
    core_width_percent:0.5,outer_width_percent:1.5,scorability_state:'SCORABLE',
  };
  const card=buildBuild3Scorecard({
    truth:summarizeBuild3Truth([truthRow]),
    recommendation:summarizeBuild3RecommendationEfficacy([]),
    no_trade:summarizeBuild3NoTradeOutcomes([]),
  });
  const comparison=compareBuild3Challenger(proposal,card);
  assert.equal(comparison.comparison_state,'SAME_POPULATION_COMPLETE');
  assert.equal(comparison.baseline_value,100);
  assert.equal(comparison.challenger_value,0);
  assert.equal(comparison.delta,-100);
  assert.equal(comparison.denominator,1);
  assert.equal(comparison.promotion_eligible,false);
});

test('entry/SL challenger is forced to forward shadow',()=>{
  const p:Build3ChallengerProposal={...proposal,challenger_id:'b3ch_entry',challenger_type:'ENTRY_SL_GEOMETRY'};
  const card=buildBuild3Scorecard({
    truth:summarizeBuild3Truth([]),
    recommendation:summarizeBuild3RecommendationEfficacy([]),
    no_trade:summarizeBuild3NoTradeOutcomes([]),
  });
  const comparison=compareBuild3Challenger(p,card);
  assert.equal(comparison.comparison_state,'NEEDS_FORWARD_SHADOW');
  assert.equal(comparison.promotion_eligible,false);
});
