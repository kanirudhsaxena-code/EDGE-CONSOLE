import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('5DR assessment separates matured efficacy from pending published forecasts',()=>{
  const source=readFileSync('src/index.ts','utf8');
  assert.ok(source.includes('pending_forecasts'));
  assert.ok(source.includes('outcome_assessments oa'));
  assert.ok(source.includes('matured_runs:forecastEligible'));
  assert.ok(source.includes('assessment_as_of:row.assessed_at'));
});

test('5DR assessment UI exposes day-wise forecast range direction and outcome drill-down',()=>{
  const app=readFileSync('public/app.js','utf8');
  assert.ok(app.includes('Drill down — day-wise forecast, range & outcomes'));
  assert.ok(app.includes('Matured historical performance'));
  assert.ok(app.includes('Legacy canonical forecasts awaiting assessment'));
  assert.ok(app.includes('Expected range / zone'));
  assert.ok(app.includes('No evidence-supported day-specific direction/range was stored for this slot.'));
  assert.ok(app.includes('Matured eligible'));
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
  assert.ok(app.includes('matured eligible'));
  assert.ok(app.includes('resolved canonical recommendations'));
  assert.ok(app.includes('one selected DAILY_CANONICAL forecast per target trading date'));
  assert.ok(app.includes('Canonical actionable calls only'));
  assert.ok(source.includes("population_rule:String(overall.population_rule??rec.population_rule??'SELECTED_DAILY_CANONICAL_ONLY')"));
  assert.ok(source.includes("population:'SCORABLE_MATURED_CANONICAL_CHECKPOINTS'"));
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


test('5DR assessment exposes matured eligible versus scorable coverage',()=>{
  const app=readFileSync('public/app.js','utf8');
  const source=readFileSync('src/index.ts','utf8');
  assert.ok(app.includes('matured eligible'));
  assert.ok(app.includes('Matured · not scorable'));
  assert.ok(app.includes('matured unscorable'));
  assert.ok(source.includes('matured_eligible_checkpoints:forecastEligible'));
  assert.ok(source.includes('missing_unscorable_checkpoints:forecastMissing'));
  assert.ok(source.includes('scorable_coverage_pct:forecastCoverage'));
});


test('5DR canonical handoff is a dedicated sanitized governed endpoint',()=>{
  const router=readFileSync('src/router.ts','utf8');
  const workflow=readFileSync('.github/workflows/5dr-canonical-handoff-state.yml','utf8');
  assert.ok(router.includes("'/api/5dr/canonical-handoff'"));
  assert.ok(router.includes("schema_version: '5DR_CONSOLE_HANDOFF_V1'"));
  assert.ok(router.includes('intelligence_handoff: normalized ? { normalized } : {}'));
  assert.ok(workflow.includes('/api/5dr/canonical-handoff'));
  assert.ok(!workflow.includes('/api/runs/latest?engine=5DR'));
});


test('5DR assessment exposes latest canonical regime and does not promise rerun scoring',()=>{
  const app=readFileSync('public/app.js','utf8');
  const source=readFileSync('src/index.ts','utf8');
  assert.ok(app.includes('Official canonical · latest governed target'));
  assert.ok(app.includes('Legacy migration population'));
  assert.ok(app.includes('Post-governance timing regime'));
  assert.ok(app.includes('This operational run affects official accuracy only if it becomes the selected canonical'));
  assert.ok(source.includes('canonical=isObject(m.canonical_selection)?m.canonical_selection:null'));
  assert.ok(source.includes('canonical_selection:canonical'));
});


test('5DR assessment import uses governed 5DR route family',()=>{
  const router=readFileSync('src/router.ts','utf8');
  const workflow=readFileSync('.github/workflows/5dr-assessment-state-import.yml','utf8');
  assert.ok(router.includes("'/api/5dr/assessment-import'"));
  assert.ok(router.includes('fiveDrAssessmentImport(request, env)'));
  assert.ok(workflow.includes('/api/5dr/assessment-import'));
  assert.ok(!workflow.includes('/api/assessment-import'));
});

test('production smoke waits for v18 legacy-canonical UI before validation',()=>{
  const workflow=readFileSync('.github/workflows/edge-production-smoke.yml','utf8');
  assert.ok(workflow.includes('Official canonical status'));
  assert.ok(workflow.includes('edge-ui-v18-20260922'));
  assert.ok(workflow.includes('/tmp/deployed-index.html'));
});


test('5DR assessment import tolerates same-push Worker deployment race but fails closed',()=>{
  const workflow=readFileSync('.github/workflows/5dr-assessment-state-import.yml','utf8');
  assert.ok(workflow.includes('for attempt in $(seq 1 12)'));
  assert.ok(workflow.includes('if [ "$attempt" -lt 12 ]; then sleep 10; fi'));
  assert.ok(workflow.includes('ASSESSMENT_IMPORT_FAILED_AFTER_RETRIES'));
  assert.ok(workflow.includes('--data-binary @/tmp/5dr-assessment-import.json'));
});


test('5DR assessment summary selects latest imported rollup rather than highest semantic assessed_at',()=>{
  const source=readFileSync('src/index.ts','utf8');
  assert.ok(source.includes("assessment_rollups where engine='5DR' order by created_at desc,id desc limit 1"));
  assert.ok(!source.includes("assessment_rollups where engine='5DR' order by assessed_at desc,id desc limit 1"));
});


test('legacy pending assessment population keeps only last valid run per IST run-date',()=>{
  const source=readFileSync('src/index.ts','utf8');
  const app=readFileSync('public/app.js','utf8');
  assert.ok(source.includes("partition by (ar.generated_at at time zone 'Asia/Kolkata')::date"));
  assert.ok(source.includes("where legacy_rank=1"));
  assert.ok(source.includes("ar.generated_at < timestamptz '2026-09-21 18:30:00+00'"));
  assert.ok(app.includes('Legacy canonical forecasts awaiting assessment'));
  assert.ok(app.includes('pending legacy canonical'));
});


test('pre-open NIFTY and Stocks automation use curl service-token transport, not urllib',()=>{
  const nifty=readFileSync('.github/workflows/5dr-preopen-canonical.yml','utf8');
  const stocks=readFileSync('.github/workflows/edge-stocks-preopen-canonical.yml','utf8');
  for(const workflow of [nifty,stocks]){
    assert.ok(workflow.includes('"curl"'));
    assert.ok(workflow.includes('CF-Access-Client-Id'));
    assert.ok(workflow.includes('CF-Access-Client-Secret'));
    assert.ok(!workflow.includes('urllib.request'));
    assert.ok(!workflow.includes('urllib.error'));
  }
});
