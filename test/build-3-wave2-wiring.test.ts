import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Wave 2 schema freezes precision issuance/outcomes and decisions independently',()=>{
  const migration=read('database/0009_build3_precision_decisions.sql');
  assert.match(migration,/create table if not exists build3_precision_issuance/i);
  assert.match(migration,/core_width_points double precision not null/i);
  assert.match(migration,/core_width_percent double precision not null/i);
  assert.match(migration,/create table if not exists build3_precision_outcomes/i);
  assert.match(migration,/centre_error double precision not null/i);
  assert.match(migration,/miss_distance double precision not null/i);
  assert.match(migration,/core_hit boolean not null/i);
  assert.match(migration,/create table if not exists build3_decisions/i);
  assert.match(migration,/counterfactual jsonb not null/i);
  assert.match(migration,/prevent_build3_decision_mutation/i);
});

test('NIFTY completion materializes independent Core calibration and decision after forecast persistence',()=>{
  const materializer=read('src/build-3-nifty-materializer.ts');
  assert.match(materializer,/buildNiftyPrecisionPlan\(forecast\)/);
  assert.match(materializer,/persistBuild3Forecast\(databaseUrl,forecast\)/);
  assert.match(materializer,/persistBuild3PrecisionIssuance\(databaseUrl,precision\.issuance\)/);
  assert.match(materializer,/buildNiftyBuild3Decision\(forecast,row\.result/);
  assert.match(materializer,/persistBuild3Decision\(databaseUrl,decision\)/);
});

test('Stocks completion uses factor-driven SHADOW precision and exact persisted EDGE decision source',()=>{
  const materializer=read('src/build-3-stock-materializer.ts');
  const precision=read('src/build-3-precision.ts');
  assert.match(materializer,/from recommendations r/);
  assert.match(materializer,/left join execution_plans ep/);
  assert.match(materializer,/buildStockPrecisionPlan\(forecast,rows\)/);
  assert.match(materializer,/persistBuild3PrecisionIssuance\(env\.DATABASE_URL,precision\.issuance\)/);
  assert.match(materializer,/buildStockBuild3Decision\(forecast/);
  assert.match(materializer,/persistBuild3Decision\(env\.DATABASE_URL,decision\)/);
  assert.match(precision,/empirical_validation_state:'2C-02_OPEN'/);
  assert.match(precision,/CALIBRATION_PENDING/);
  assert.match(precision,/STOCK_CORE_ZONE_CHALLENGER_V0_1/);
});

test('Wave 2 stock calibration never imports NIFTY numerical calibration constants',()=>{
  const precision=read('src/build-3-precision.ts');
  const stockSection=precision.slice(precision.indexOf('export function buildStockPrecisionPlan'));
  assert.doesNotMatch(stockSection,/NIFTY_HALF_WIDTH_PERCENT\[/);
});
