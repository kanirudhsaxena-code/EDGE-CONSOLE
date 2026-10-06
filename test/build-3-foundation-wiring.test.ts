import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Build 3.0 Foundation migrations define immutable registry, evidence, DQ and D:D+4 forecast storage',()=>{
  const registry=read('database/0005_build3_run_registry.sql');
  const evidence=read('database/0006_build3_evidence_snapshots.sql');
  const quality=read('database/0007_build3_data_quality.sql');
  const forecast=read('database/0008_build3_forecast_horizons.sql');
  assert.match(registry,/create table if not exists build3_run_registry/i);
  assert.match(registry,/unique\s*\(engine,source_id\)/i);
  assert.match(evidence,/create table if not exists build3_evidence_snapshots/i);
  assert.match(evidence,/prevent_build3_evidence_mutation/i);
  assert.match(quality,/create table if not exists build3_data_quality_assessments/i);
  assert.match(quality,/valid_for_forecast boolean not null/i);
  assert.match(forecast,/create table if not exists build3_forecast_horizons/i);
  assert.match(forecast,/horizon in \('D','D\+1','D\+2','D\+3','D\+4'\)/i);
  assert.match(forecast,/prevent_build3_forecast_mutation/i);
});

test('all four production trigger paths bind to the central Build 3.0 registry',()=>{
  const mobile=read('src/mobile-v1-entry.ts');
  const router=read('src/router.ts');
  const preopen=read('src/preopen-scheduler.ts');
  assert.match(mobile,/engine:'5DR'.*source_id:requestId/s);
  assert.match(mobile,/persistBuild3RunRegistryRecord\(env\.DATABASE_URL,build3Run\)/);
  assert.match(router,/engine:'EDGE_STOCKS'.*source_id:lifecycleId.*trigger_type:'MANUAL'/s);
  assert.match(router,/persistBuild3RunRegistryRecord\(env\.DATABASE_URL,build3Run\)/);
  assert.match(preopen,/engine:'EDGE_STOCKS'.*source_id:lifecycleId.*trigger_type:'AUTOMATIC'/s);
  assert.match(preopen,/persistBuild3RunRegistryRecord\(env\.DATABASE_URL,build3Run\)/);
});

test('NIFTY completion is fail-closed through persisted Build 3.0 materialization and recovery',()=>{
  const mobile=read('src/mobile-v1-entry.ts');
  const materializer=read('src/build-3-nifty-materializer.ts');
  assert.match(mobile,/materializePersistedNiftyBuild3Forecast\(env\.DATABASE_URL,requestId\)/);
  assert.match(mobile,/RETRY_BUILD3_FORECAST_MATERIALIZATION/);
  assert.match(materializer,/readBuild3RunRegistryRecord\(databaseUrl,'5DR',requestId\)/);
  assert.match(materializer,/readBuild3EvidenceSnapshot\(databaseUrl,'5DR',requestId\)/);
  assert.match(materializer,/readBuild3DataQuality\(databaseUrl,'5DR',requestId\)/);
  assert.match(materializer,/quality\.overall_state!=='VERIFIED'/);
  assert.match(materializer,/persistBuild3Forecast\(databaseUrl,forecast\)/);
  assert.match(mobile,/progressPendingBuild3NiftyRuns/);
});

test('Stocks completion preserves lifecycle registry identity and exact governed G5 producer lineage',()=>{
  const router=read('src/router.ts');
  const preopen=read('src/preopen-scheduler.ts');
  const materializer=read('src/build-3-stock-materializer.ts');
  const adapter=read('src/build-3-stock-forecast.ts');
  assert.match(router,/materializePersistedStockBuild3Forecast\(env,lifecycleId\)/);
  assert.match(preopen,/materializePersistedStockBuild3Forecast\(env,lifecycleId\)/);
  assert.match(materializer,/readBuild3RunRegistryRecord\(env\.DATABASE_URL,'EDGE_STOCKS',lifecycleId\)/);
  assert.match(materializer,/String\(header\.source_run_id\)!==lifecycle\.recommendation_id/);
  assert.match(materializer,/source_id:lifecycleId/);
  assert.match(materializer,/persistBuild3Forecast\(env\.DATABASE_URL,forecast\)/);
  assert.match(adapter,/source_id:input\.source_id\.trim\(\)/);
});

test('weekday completion guard recovers late NIFTY and stock persistence without enabling trading',()=>{
  const entry=read('src/production-entry.ts');
  assert.match(entry,/materializePendingBuild3StockForecasts\(env,12\)/);
  assert.match(entry,/progressPendingBuild3NiftyRuns\(env,12\)/);
  assert.match(entry,/status:'BUILD3_COMPLETION_GUARD'/);
  assert.match(entry,/trading_enabled:false/);
});
