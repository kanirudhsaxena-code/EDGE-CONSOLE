import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectIndependentBuild3TruthRows,
  summarizeBuild3Truth,
  type Build3TruthMetricRow,
} from '../src/build-3-truth-metrics';

function row(overrides:Partial<Build3TruthMetricRow>={}):Build3TruthMetricRow{
  return {
    engine:'5DR',instrument:'NIFTY',source_id:'a',horizon:'D',
    target_session:'2026-10-07',issued_at:'2026-10-06T04:00:00.000Z',run_time_bucket:'PRE_OPEN',
    direction_result:'HIT',
    outer_touch:true,outer_close_hit:true,core_touch:true,core_close_hit:true,
    outer_efficacy_state:'SCORABLE',core_efficacy_state:'SCORABLE',
    outer_deviation_hit:true,core_deviation_hit:true,
    outer_challenger_3pct_hit:true,core_challenger_3pct_hit:true,
    outer_quality_status:'GREEN',core_quality_status:'GREEN',
    outer_range_deviation_pct:0,core_range_deviation_pct:0,
    normalized_centre_error:0.2,brier_score:0.1,probability_state:'SCORABLE',
    core_width_percent:0.5,outer_width_percent:1.5,scorability_state:'SCORABLE',
    ...overrides,
  };
}

test('Truth metrics select the first valid issuance for repeated same-cell runs',()=>{
  const rows=[
    row({source_id:'early',issued_at:'2026-10-06T04:00:00.000Z',direction_result:'MISS'}),
    row({source_id:'late',issued_at:'2026-10-06T08:00:00.000Z',direction_result:'HIT'}),
    row({source_id:'next',target_session:'2026-10-08',issued_at:'2026-10-07T04:00:00.000Z',direction_result:'HIT'}),
  ];
  const selected=selectIndependentBuild3TruthRows(rows);
  assert.deepEqual(selected.map(x=>x.source_id),['early','next']);
  const summary=summarizeBuild3Truth(rows,'2026-10-09T00:00:00.000Z');
  assert.equal(summary.population.raw_outcomes,3);
  assert.equal(summary.population.independent_cells,2);
  assert.equal(summary.population.repeated_same_cell_outcomes,1);
  assert.equal(summary.independent_metrics.direction_accuracy_pct,50);
  assert.equal(summary.all_observation_metrics.direction_accuracy_pct,66.6667);
  assert.equal(summary.official_efficacy_mutated,false);
  assert.equal(summary.production_change_allowed,false);
});

test('Truth metrics expose close, deviation and traffic-light rates separately for Outer and Core',()=>{
  const rows=[
    row(),
    row({
      source_id:'amber',target_session:'2026-10-08',
      outer_close_hit:true,outer_deviation_hit:false,outer_quality_status:'AMBER',
      outer_challenger_3pct_hit:false,outer_range_deviation_pct:7,
      core_close_hit:false,core_deviation_hit:true,core_quality_status:'AMBER',
      core_challenger_3pct_hit:false,core_range_deviation_pct:4,
    }),
    row({
      source_id:'red',target_session:'2026-10-09',
      outer_close_hit:false,outer_deviation_hit:false,outer_quality_status:'RED',
      outer_challenger_3pct_hit:false,outer_range_deviation_pct:12,
      core_close_hit:false,core_deviation_hit:false,core_quality_status:'RED',
      core_challenger_3pct_hit:false,core_range_deviation_pct:15,
    }),
  ];
  const s=summarizeBuild3Truth(rows,'2026-10-10T00:00:00.000Z').independent_metrics;
  assert.equal(s.outer_close_hit_rate_pct,66.6667);
  assert.equal(s.outer_deviation_hit_rate_pct,33.3333);
  assert.equal(s.outer_green_pct,33.3333);
  assert.equal(s.outer_amber_pct,33.3333);
  assert.equal(s.outer_red_pct,33.3333);
  assert.equal(s.core_close_hit_rate_pct,33.3333);
  assert.equal(s.core_deviation_hit_rate_pct,66.6667);
  assert.equal(s.core_green_pct,33.3333);
  assert.equal(s.core_amber_pct,33.3333);
  assert.equal(s.core_red_pct,33.3333);
});

test('zero-width/unscorable Core remains visible but does not enter Core zone efficacy denominator',()=>{
  const rows=[
    row(),
    row({
      source_id:'core-blocked',target_session:'2026-10-08',
      core_efficacy_state:'NOT_SCORABLE',
      core_deviation_hit:null,core_challenger_3pct_hit:null,
      core_quality_status:'NOT_SCORABLE',core_range_deviation_pct:null,
      core_width_percent:0,
    }),
  ];
  const s=summarizeBuild3Truth(rows,'2026-10-09T00:00:00.000Z').independent_metrics;
  assert.equal(s.samples,2);
  assert.equal(s.outer_zone_samples,2);
  assert.equal(s.core_zone_samples,1);
  assert.equal(s.core_close_hit_rate_pct,100);
});

test('Truth metrics keep different stocks independent on the same target session',()=>{
  const rows=[
    row({engine:'EDGE_STOCKS',instrument:'LTF',source_id:'ltf',direction_result:'HIT'}),
    row({engine:'EDGE_STOCKS',instrument:'RELIANCE',source_id:'ril',direction_result:'MISS'}),
  ];
  const summary=summarizeBuild3Truth(rows,'2026-10-09T00:00:00.000Z');
  assert.equal(summary.population.independent_cells,2);
  assert.equal(summary.independent_metrics.direction_accuracy_pct,50);
});

test('unscorable rows stay visible in population but never enter efficacy rates',()=>{
  const rows=[
    row(),
    row({
      source_id:'blocked',target_session:'2026-10-08',direction_result:'NOT_SCORABLE',
      scorability_state:'NOT_SCORABLE',probability_state:'NOT_SCORABLE',brier_score:null,
    }),
  ];
  const summary=summarizeBuild3Truth(rows,'2026-10-09T00:00:00.000Z');
  assert.equal(summary.population.raw_outcomes,2);
  assert.equal(summary.population.scorable_outcomes,1);
  assert.equal(summary.independent_metrics.samples,1);
  assert.equal(summary.independent_metrics.direction_accuracy_pct,100);
});


test('Truth metrics publish governed run-time buckets on the day-normalized population',()=>{
  const rows=[
    row({source_id:'pre',target_session:'2026-10-07',issued_at:'2026-10-06T03:30:00.000Z',run_time_bucket:'PRE_OPEN',direction_result:'HIT'}),
    row({source_id:'intra',target_session:'2026-10-08',issued_at:'2026-10-07T06:00:00.000Z',run_time_bucket:'INTRADAY',direction_result:'MISS'}),
    row({source_id:'post',target_session:'2026-10-09',issued_at:'2026-10-08T11:00:00.000Z',run_time_bucket:'POST_CLOSE',direction_result:'HIT'}),
  ];
  const summary=summarizeBuild3Truth(rows,'2026-10-10T00:00:00.000Z');
  assert.equal(summary.time_bucket_breakdown.PRE_OPEN.samples,1);
  assert.equal(summary.time_bucket_breakdown.PRE_OPEN.direction_accuracy_pct,100);
  assert.equal(summary.time_bucket_breakdown.INTRADAY.samples,1);
  assert.equal(summary.time_bucket_breakdown.INTRADAY.direction_accuracy_pct,0);
  assert.equal(summary.time_bucket_breakdown.POST_CLOSE.samples,1);
  assert.equal(summary.time_bucket_breakdown.OPEN.samples,0);
  assert.equal(summary.time_bucket_breakdown.CLOSED_SESSION.samples,0);
});
