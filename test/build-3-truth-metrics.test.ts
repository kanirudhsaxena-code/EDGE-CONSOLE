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
    target_session:'2026-10-07',issued_at:'2026-10-06T04:00:00.000Z',
    direction_result:'HIT',outer_touch:true,outer_close_hit:true,
    core_touch:true,core_close_hit:true,normalized_centre_error:0.2,
    brier_score:0.1,probability_state:'SCORABLE',
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
    row({source_id:'blocked',target_session:'2026-10-08',direction_result:'NOT_SCORABLE',scorability_state:'NOT_SCORABLE',probability_state:'NOT_SCORABLE',brier_score:null}),
  ];
  const summary=summarizeBuild3Truth(rows,'2026-10-09T00:00:00.000Z');
  assert.equal(summary.population.raw_outcomes,2);
  assert.equal(summary.population.scorable_outcomes,1);
  assert.equal(summary.independent_metrics.samples,1);
  assert.equal(summary.independent_metrics.direction_accuracy_pct,100);
});
