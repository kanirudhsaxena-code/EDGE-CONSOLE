import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBuild3Scorecard } from '../src/build-3-scorecard';
import { summarizeBuild3Truth, type Build3TruthMetricRow } from '../src/build-3-truth-metrics';
import {
  scoreBuild3RecommendationEfficacy,
  summarizeBuild3RecommendationEfficacy,
} from '../src/build-3-efficacy-contract';

const truthRow:Build3TruthMetricRow={
  engine:'5DR',instrument:'NIFTY',source_id:'f1',horizon:'D',target_session:'2026-10-07',
  issued_at:'2026-10-06T04:00:00.000Z',direction_result:'HIT',
  outer_touch:true,outer_close_hit:true,core_touch:true,core_close_hit:true,
  outer_efficacy_state:'SCORABLE',core_efficacy_state:'SCORABLE',
  outer_deviation_hit:true,core_deviation_hit:true,
  outer_challenger_3pct_hit:true,core_challenger_3pct_hit:false,
  outer_quality_status:'GREEN',core_quality_status:'GREEN',
  outer_range_deviation_pct:1,core_range_deviation_pct:4,
  normalized_centre_error:0.2,brier_score:0.1,probability_state:'SCORABLE',
  core_width_percent:0.5,outer_width_percent:1.5,scorability_state:'SCORABLE',
};

test('scorecard exposes amended zone contract and dual recommendation rates without changing official efficacy',()=>{
  const truth=summarizeBuild3Truth([truthRow],'2026-10-07T12:00:00.000Z');
  const recommendation=summarizeBuild3RecommendationEfficacy([
    scoreBuild3RecommendationEfficacy({entry_triggered:true,target_hit:true,sl_hit:false,lifecycle_complete:true}),
    scoreBuild3RecommendationEfficacy({entry_triggered:true,target_hit:true,sl_hit:true,lifecycle_complete:true}),
  ]);
  const card=buildBuild3Scorecard({
    truth,recommendation,scope:'5DR',generated_at:'2026-10-07T12:01:00.000Z',
  });
  assert.equal(card.zone_contract.primary_tolerance_pct,5);
  assert.equal(card.zone_contract.challenger_tolerance_pct,3);
  assert.equal(card.forecast.independent_metrics.core_close_hit_rate_pct,100);
  assert.equal(card.forecast.independent_metrics.core_deviation_hit_rate_pct,100);
  assert.equal(card.recommendation.conservative_hit_rate_pct,50);
  assert.equal(card.recommendation.liberal_hit_rate_pct,100);
  assert.equal(card.recommendation.hit_rate_gap_pct,50);
  assert.equal(card.official_efficacy_mutated,false);
  assert.equal(card.production_methodology_changed,false);
});
