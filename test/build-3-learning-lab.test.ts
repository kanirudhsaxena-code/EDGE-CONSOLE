import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBuild3Scorecard } from '../src/build-3-scorecard';
import { summarizeBuild3Truth, type Build3TruthMetricRow } from '../src/build-3-truth-metrics';
import { summarizeBuild3Cohorts, type Build3CohortTruthRow } from '../src/build-3-cohort-diagnostics';
import { summarizeBuild3RecommendationEfficacy, scoreBuild3RecommendationEfficacy } from '../src/build-3-efficacy-contract';
import { summarizeBuild3NoTradeOutcomes } from '../src/build-3-no-trade-efficacy';
import { summarizeBuild3Attribution, type Build3AttributionObservation } from '../src/build-3-attribution';
import {
  normalizeBuild3LearningScope,buildBuild3LearningLabOutput,buildBuild3ModelFeedback,
  prepareBuild3LearningSnapshot,prepareBuild3Challenger,
} from '../src/build-3-learning-lab';

function truthRow(overrides:Partial<Build3CohortTruthRow>={}):Build3CohortTruthRow{
  return {
    engine:'5DR',instrument:'NIFTY',source_id:'x',horizon:'D',target_session:'2026-10-07',
    issued_at:'2026-10-06T04:00:00.000Z',run_time_bucket:'PRE_OPEN',regime:'TREND',
    evidence_quality:'VERIFIED',event_state:'NORMAL',direction_result:'HIT',
    outer_touch:true,outer_close_hit:true,core_touch:true,core_close_hit:true,
    outer_efficacy_state:'SCORABLE',core_efficacy_state:'SCORABLE',
    outer_deviation_hit:true,core_deviation_hit:true,
    outer_challenger_3pct_hit:true,core_challenger_3pct_hit:true,
    outer_quality_status:'GREEN',core_quality_status:'GREEN',
    outer_range_deviation_pct:1,core_range_deviation_pct:1,
    normalized_centre_error:0.1,brier_score:0.1,probability_state:'SCORABLE',
    core_width_percent:0.4,outer_width_percent:1.2,scorability_state:'SCORABLE',
    ...overrides,
  };
}

function attributionRow(i:number):Build3AttributionObservation{
  return {
    engine:'5DR',instrument:'NIFTY',source_id:'a'+i,horizon:'D',
    forecast_direction:'BULL',regime:'TREND',direction_result:'HIT',
    outer_close_hit:true,core_close_hit:true,outer_quality_status:'GREEN',core_quality_status:'GREEN',
    outer_high_breach_points:0,outer_low_breach_points:0,core_high_breach_points:0,core_low_breach_points:0,
    component_scores:{PVPO:25},gate_results:[{gate:'MARKET_TRUST',passed:true,observed:75,threshold:'>=50'}],
    verified_inputs:['component_scores'],recommendation_classification:null,no_trade_classification:null,
  };
}

test('Learning Lab scope supports cumulative, engine, ticker and date windows',()=>{
  assert.deepEqual(normalizeBuild3LearningScope({}),{engine:'ALL',instrument:null,from_date:null,to_date:null});
  assert.deepEqual(
    normalizeBuild3LearningScope({engine:'EDGE_STOCKS',instrument:'ltf',from_date:'2026-10-01',to_date:'2026-10-07'}),
    {engine:'EDGE_STOCKS',instrument:'LTF',from_date:'2026-10-01',to_date:'2026-10-07'}
  );
  assert.throws(()=>normalizeBuild3LearningScope({engine:'5DR',instrument:'LTF'}),/5DR_INSTRUMENT_INVALID/);
  assert.throws(()=>normalizeBuild3LearningScope({from_date:'2026-10-08',to_date:'2026-10-01'}),/DATE_ORDER_INVALID/);
});

test('small samples generate DEFER rather than model changes',()=>{
  const cohort=[truthRow()];
  const truth=cohort.map(({regime:_r,evidence_quality:_e,event_state:_s,...row})=>row as Build3TruthMetricRow);
  const cohorts=summarizeBuild3Cohorts(cohort);
  const recommendation=summarizeBuild3RecommendationEfficacy([]);
  const noTrade=summarizeBuild3NoTradeOutcomes([]);
  const scorecard=buildBuild3Scorecard({truth:summarizeBuild3Truth(truth),recommendation,no_trade:noTrade,cohorts});
  const attribution=summarizeBuild3Attribution([attributionRow(1)]);
  const feedback=buildBuild3ModelFeedback({scorecard,attribution,no_trade:noTrade});
  assert.equal(feedback[0].action,'DEFER');
  assert.equal(feedback[0].next_observations_needed,9);
});

test('Learning Lab output keeps production mutation disabled and states next evidence',()=>{
  const cohort=[truthRow()];
  const truth=cohort.map(({regime:_r,evidence_quality:_e,event_state:_s,...row})=>row as Build3TruthMetricRow);
  const cohorts=summarizeBuild3Cohorts(cohort);
  const noTrade=summarizeBuild3NoTradeOutcomes([]);
  const scorecard=buildBuild3Scorecard({
    truth:summarizeBuild3Truth(truth),
    recommendation:summarizeBuild3RecommendationEfficacy([]),
    no_trade:noTrade,cohorts,
  });
  const attribution=summarizeBuild3Attribution([attributionRow(1)]);
  const output=buildBuild3LearningLabOutput({
    scope:normalizeBuild3LearningScope({engine:'5DR',instrument:'NIFTY'}),
    scorecard,cohorts,attribution,no_trade:noTrade,
    data_quality:{total_assessments:1,verified:1,partial:0,missing:0,stale:0,valid_for_forecast:1,coverage_pct:100},
    generated_at:'2026-10-07T12:00:00.000Z',
  });
  assert.equal(output.governance.production_mutation_allowed,false);
  assert.equal(output.governance.explicit_user_approval_required_for_promotion,true);
  assert.ok(output.next_observations_needed.some(x=>x.includes('ATTRIBUTION_SAMPLE')));
});

test('same-population 3% zone comparison can create a challenger only with sufficient sample',async()=>{
  const cohort=Array.from({length:30},(_,i)=>{
    const date=new Date(Date.UTC(2026,9,1+i));
    return truthRow({
      source_id:'t'+i,target_session:date.toISOString().slice(0,10),
      issued_at:new Date(date.getTime()-24*60*60*1000+3*60*60*1000).toISOString(),
    });
  });
  const truth=cohort.map(({regime:_r,evidence_quality:_e,event_state:_s,...row})=>row as Build3TruthMetricRow);
  const cohorts=summarizeBuild3Cohorts(cohort);
  const noTrade=summarizeBuild3NoTradeOutcomes([]);
  const scorecard=buildBuild3Scorecard({
    truth:summarizeBuild3Truth(truth),
    recommendation:summarizeBuild3RecommendationEfficacy([]),no_trade:noTrade,cohorts,
  });
  const attribution=summarizeBuild3Attribution(Array.from({length:30},(_,i)=>attributionRow(i)));
  const feedback=buildBuild3ModelFeedback({scorecard,attribution,no_trade:noTrade});
  const challenger=feedback.find(x=>x.topic==='CORE_ZONE_3PCT_DEVIATION_TOLERANCE');
  assert.equal(challenger?.action,'CHALLENGER');
  assert.equal(challenger?.comparison_state,'SAME_POPULATION_SHADOW');

  const output=buildBuild3LearningLabOutput({
    scope:normalizeBuild3LearningScope({engine:'5DR',instrument:'NIFTY'}),
    scorecard,cohorts,attribution,no_trade:noTrade,
    data_quality:{total_assessments:30,verified:30,partial:0,missing:0,stale:0,valid_for_forecast:30,coverage_pct:100},
    generated_at:'2026-10-07T12:00:00.000Z',
  });
  const snapshot=await prepareBuild3LearningSnapshot(output);
  const proposal=await prepareBuild3Challenger(snapshot,challenger!);
  assert.equal(proposal.challenger_type,'ZONE_DEVIATION_TOLERANCE');
  assert.equal(proposal.production_mutation_allowed,false);
  assert.equal(proposal.status,'PROPOSED');
});
