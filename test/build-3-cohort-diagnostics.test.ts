import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeBuild3Cohorts, type Build3CohortTruthRow } from '../src/build-3-cohort-diagnostics';

function row(overrides:Partial<Build3CohortTruthRow>={}):Build3CohortTruthRow{
  const base:Build3CohortTruthRow={
    engine:'EDGE_STOCKS',instrument:'LTF',source_id:'r1',horizon:'D',target_session:'2026-10-07',
    issued_at:'2026-10-06T04:00:00.000Z',run_time_bucket:'PRE_OPEN',
    regime:'TREND',evidence_quality:'VERIFIED',event_state:'NORMAL',
    direction_result:'HIT',outer_touch:true,outer_close_hit:true,core_touch:true,core_close_hit:true,
    outer_efficacy_state:'SCORABLE',core_efficacy_state:'SCORABLE',
    outer_deviation_hit:true,core_deviation_hit:true,
    outer_challenger_3pct_hit:true,core_challenger_3pct_hit:true,
    outer_quality_status:'GREEN',core_quality_status:'GREEN',
    outer_range_deviation_pct:1,core_range_deviation_pct:2,
    normalized_centre_error:0.2,brier_score:0.1,probability_state:'SCORABLE',
    core_width_percent:0.5,outer_width_percent:1.5,scorability_state:'SCORABLE',
  };
  return {...base,...overrides};
}

test('cohorts split horizon, regime, ticker, time bucket, evidence and event state',()=>{
  const rows=[
    row(),
    row({source_id:'r2',instrument:'RELIANCE',horizon:'D+1',target_session:'2026-10-08',
      regime:'EVENT_SHOCK',event_state:'EVENT_SHOCK',run_time_bucket:'INTRADAY',direction_result:'MISS',
      core_close_hit:false,outer_close_hit:false,core_quality_status:'RED',outer_quality_status:'RED',
      core_deviation_hit:false,outer_deviation_hit:false}),
  ];
  const out=summarizeBuild3Cohorts(rows,'2026-10-09T12:00:00.000Z');
  assert.equal(out.by_horizon.D.samples,1);
  assert.equal(out.by_horizon['D+1'].samples,1);
  assert.equal(out.by_regime.TREND.direction_accuracy_pct,100);
  assert.equal(out.by_regime.EVENT_SHOCK.direction_accuracy_pct,0);
  assert.equal(out.by_instrument.LTF.samples,1);
  assert.equal(out.by_instrument.RELIANCE.samples,1);
  assert.equal(out.by_run_time_bucket.PRE_OPEN.samples,1);
  assert.equal(out.by_run_time_bucket.INTRADAY.samples,1);
  assert.equal(out.by_evidence_quality.VERIFIED.samples,2);
  assert.equal(out.by_event_state.NORMAL.samples,1);
  assert.equal(out.by_event_state.EVENT_SHOCK.samples,1);
});

test('cohort metrics preserve independent-cell anti-gaming rule',()=>{
  const rows=[
    row({source_id:'early',issued_at:'2026-10-06T03:00:00.000Z',direction_result:'HIT'}),
    row({source_id:'late',issued_at:'2026-10-06T05:00:00.000Z',direction_result:'MISS'}),
  ];
  const out=summarizeBuild3Cohorts(rows);
  assert.equal(out.by_instrument.LTF.raw_rows,2);
  assert.equal(out.by_instrument.LTF.independent_cells,1);
  assert.equal(out.by_instrument.LTF.direction_accuracy_pct,100);
});

test('event state cannot disagree with the frozen regime',()=>{
  assert.throws(
    ()=>summarizeBuild3Cohorts([row({regime:'EVENT_SHOCK',event_state:'NORMAL'})]),
    /BUILD3_COHORT_EVENT_STATE_MISMATCH/
  );
});
