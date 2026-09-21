import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('5DR assessment separates matured efficacy from pending published forecasts',()=>{
  const source=readFileSync('src/index.ts','utf8');
  assert.ok(source.includes('pending_forecasts'));
  assert.ok(source.includes("not exists (select 1 from outcome_assessments oa where oa.run_id=ar.run_id)"));
  assert.ok(source.includes('matured_runs:forecastTotal'));
  assert.ok(source.includes('assessment_as_of:row.assessed_at'));
});

test('5DR assessment UI exposes day-wise forecast range direction and outcome drill-down',()=>{
  const app=readFileSync('public/app.js','utf8');
  assert.ok(app.includes('Drill down — day-wise forecast, range & outcomes'));
  assert.ok(app.includes('Matured historical performance'));
  assert.ok(app.includes('Current forecasts awaiting assessment'));
  assert.ok(app.includes('Expected range / zone'));
  assert.ok(app.includes('No evidence-supported day-specific direction/range was stored for this slot.'));
  assert.ok(app.includes('Pending runs do not change accuracy or P/L until canonical selection'));
});

test('empty current D+1 to D+5 slots fail closed instead of inventing forecast ranges',()=>{
  const app=readFileSync('public/app.js','utf8');
  assert.ok(app.includes("if(!has)return"));
  assert.ok(app.includes('<b>Not verified</b>'));
  assert.ok(app.includes('Only evidence-supported ranges are shown.'));
});


test('pending historical forecasts and current five-day forecast are collapsed by default',()=>{
  const app=readFileSync('public/app.js','utf8');
  assert.ok(app.includes('<details class="pending-forecast-block pending-forecast-details">'));
  assert.ok(app.includes('function currentForecastDrilldown(result)'));
  assert.ok(app.includes('<details class="current-forecast-details"><summary>5-day forecast — day-wise direction & range</summary>'));
  assert.ok(!app.includes('<details class="pending-forecast-block pending-forecast-details" open>'));
  assert.ok(!app.includes('<details class="current-forecast-details" open>'));
});


test('pending detection does not disappear when assessment timestamp is newer than the live run',()=>{
  const source=readFileSync('src/index.ts','utf8');
  assert.ok(!source.includes('generated_at>${row.assessed_at}'));
  assert.ok(source.includes('outcome_assessments oa'));
});


test('5DR assessment labels official canonical population rather than run count',()=>{
  const app=readFileSync('public/app.js','utf8');
  const source=readFileSync('src/index.ts','utf8');
  assert.ok(app.includes('matured canonical checkpoints'));
  assert.ok(app.includes('resolved canonical recommendations'));
  assert.ok(app.includes('one selected DAILY_CANONICAL forecast per target trading date'));
  assert.ok(app.includes('Canonical actionable calls only'));
  assert.ok(source.includes("population_rule:String(overall.population_rule??rec.population_rule??'SELECTED_DAILY_CANONICAL_ONLY')"));
  assert.ok(source.includes("population:'MATURED_CANONICAL_CHECKPOINTS'"));
  assert.ok(source.includes("population:'RESOLVED_CANONICAL_ACTIONABLE_RECOMMENDATIONS'"));
});


test('NIFTY current 5-day forecast is hidden inside full analysis and uses standard mobile typography',()=>{
  const app=readFileSync('public/app.js','utf8');
  const css=readFileSync('public/styles.css','utf8');
  const toggle=app.indexOf('data-analysis-toggle>View full analysis');
  const analysis=app.indexOf('data-analysis-detail hidden',toggle);
  const forecast=app.indexOf('currentForecastDrilldown(result)',analysis);
  const why=app.indexOf('Why this view?',forecast);
  assert.ok(toggle>=0 && analysis>toggle && forecast>analysis && why>forecast);
  assert.ok(css.includes('.current-forecast-details summary'));
  assert.ok(css.includes('.assessment-drill-section>.step-label'));
  assert.ok(css.includes('font-size:10px!important'));
});
