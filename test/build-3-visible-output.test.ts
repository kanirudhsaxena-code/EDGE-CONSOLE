import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Build 3.0 output reader returns persisted five-horizon precision only',()=>{
  const source=read('src/build-3-output-read.ts');
  assert.match(source,/from build3_precision_issuance/);
  assert.match(source,/rows\.length!==5/);
  assert.match(source,/BUILD3_OUTPUT_PRECISION_ZONE_INVALID/);
  assert.match(source,/production_methodology_changed:false/);
  assert.match(source,/shadow_only:true/);
});

test('EDGE Stocks report joins Core Zones by exact lifecycle identity and checks outer-zone parity',()=>{
  const router=read('src/router.ts');
  assert.match(router,/from edge_run_lifecycles/);
  assert.match(router,/readBuild3OutputPrecision\(env\.DATABASE_URL,'EDGE_STOCKS',lifecycleId\)/);
  assert.match(router,/BUILD3_OUTPUT_STOCK_OUTER_ZONE_PARITY_MISMATCH/);
  assert.match(router,/readBuild3RunRegistryRecord\(env\.DATABASE_URL,'EDGE_STOCKS',lifecycleId\)/);
  assert.match(router,/core_zone:\{low:precision\.core_low,high:precision\.core_high\}/);
  assert.match(router,/build3_precision: build3Precision/);
});

test('NIFTY current and exact reads attach persisted Build 3.0 Core Zone output',()=>{
  const router=read('src/router.ts');
  const mobile=read('src/mobile-v1-entry.ts');
  assert.match(router,/readBuild3NiftyPrecisionByRunId/);
  assert.match(router,/build3_precision:precision\?build3PrecisionOutput\(precision\.rows\):null/);
  assert.match(mobile,/readBuild3OutputPrecision\(env\.DATABASE_URL,'5DR',requestId\)/);
  assert.match(mobile,/build3_precision:precisionRows\.length\?build3PrecisionOutput\(precisionRows\):null/);
});

test('user-facing NIFTY and stock renderers expose Core Zones without changing production methodology',()=>{
  const app=read('public/app.js');
  const stock=read('public/edge-stocks-five-session.js');
  const helper=read('public/build3-core-zone.js');
  assert.match(app,/renderBuild3CoreZones\(run\.build3_precision/);
  assert.match(stock,/Core Zone /);
  assert.match(stock,/core_zone_calibration/);
  assert.match(helper,/does not alter the production recommendation/);
  assert.match(helper,/no Core Zone is claimed retrospectively/);
});
