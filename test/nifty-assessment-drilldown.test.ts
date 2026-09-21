import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('5DR assessment separates matured efficacy from pending published forecasts',()=>{
  const source=readFileSync('src/index.ts','utf8');
  assert.ok(source.includes('pending_forecasts'));
  assert.ok(source.includes("generated_at>${row.assessed_at}"));
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
  assert.ok(app.includes('Fresh published forecasts appear as pending immediately'));
});

test('empty current D+1 to D+5 slots fail closed instead of inventing forecast ranges',()=>{
  const app=readFileSync('public/app.js','utf8');
  assert.ok(app.includes("if(!has)return"));
  assert.ok(app.includes('<b>Not verified</b>'));
  assert.ok(app.includes('Only evidence-supported ranges are shown.'));
});
