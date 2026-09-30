import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const schema=JSON.parse(fs.readFileSync('contracts/edge-stocks-output-v1.3.schema.json','utf8'));
const renderer=fs.readFileSync('public/edge-live.js','utf8');
const chatWorkflow=fs.readFileSync('.github/workflows/edge-chat-console-run.yml','utf8');

const outcome=schema.properties.current_stock_outcome;

test('G5 machine contract requires an exact five-row D through D+4 forecast path',()=>{
  assert.ok(outcome.required.includes('forecast_path'));
  const path=outcome.properties.forecast_path;
  assert.equal(path.minItems,5);
  assert.equal(path.maxItems,5);
  assert.equal(path.prefixItems.length,5);
  const refs=path.prefixItems.map((x:any)=>x.$ref);
  assert.deepEqual(refs,[
    '#/$defs/forecastRowD',
    '#/$defs/forecastRowD1',
    '#/$defs/forecastRowD2',
    '#/$defs/forecastRowD3',
    '#/$defs/forecastRowD4',
  ]);
  assert.equal(path.items,false);
});

test('G5 current forecast horizon cannot validate legacy D+5 wording',()=>{
  const pattern=new RegExp(outcome.properties.forecast_horizon.pattern);
  assert.equal(pattern.test('D through D+4'),true);
  assert.equal(pattern.test('D:D+4'),true);
  assert.equal(pattern.test('D+5'),false);
  assert.equal(pattern.test('5 trading days ending D+5'),false);
});

test('Console renderer must expose a governed day-wise forecast path before G5 acceptance',()=>{
  assert.match(renderer,/forecast_path/);
  assert.match(renderer,/D\+4/);
  assert.doesNotMatch(renderer,/Expected trading area over D\+5/);
});

test('governed Chat workflow must validate the day-wise forecast surface',()=>{
  assert.match(chatWorkflow,/D\+4/);
  assert.match(chatWorkflow,/forecast/i);
});
