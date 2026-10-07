import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const outcome=readFileSync(new URL('../src/build-3-outcome-evaluator.ts',import.meta.url),'utf8');
const recommendation=readFileSync(new URL('../src/build-3-recommendation-efficacy.ts',import.meta.url),'utf8');
const noTrade=readFileSync(new URL('../src/build-3-no-trade-efficacy.ts',import.meta.url),'utf8');
const store=readFileSync(new URL('../src/build-3-outcome-store.ts',import.meta.url),'utf8');
const retryMigration=readFileSync(new URL('../database/0016_build3_retry_integrity.sql',import.meta.url),'utf8');

test('all Build 3 scoring lanes isolate retryable record failures',()=>{
  assert.match(outcome,/status:'RETRYABLE_ERROR'/);
  assert.match(outcome,/recordAttempt\(databaseUrl,identity,'RETRYABLE_ERROR'/);
  assert.match(recommendation,/status:'RETRYABLE_ERROR'/);
  assert.match(recommendation,/recordBuild3RecommendationObservationAttempt\(databaseUrl,result,\{error:detail\}\)/);
  assert.match(noTrade,/status:'RETRYABLE_ERROR'/);
  assert.match(noTrade,/recordBuild3NoTradeObservationAttempt\(databaseUrl,result,\{error:detail\}\)/);
});

test('retry attempt schema is append-only and accepts RETRYABLE_ERROR',()=>{
  assert.match(retryMigration,/RETRYABLE_ERROR/);
  assert.match(retryMigration,/build3_no_trade_observation_attempts/);
  assert.match(retryMigration,/are append-only/);
  assert.match(retryMigration,/before update or delete/);
});

test('final forecast outcomes remain idempotent and immutable on retry',()=>{
  assert.match(store,/on conflict \(engine,source_id,horizon\) do nothing/);
  assert.match(store,/BUILD3_OUTCOME_IMMUTABLE_CONFLICT/);
  assert.match(recommendation,/on conflict \(engine,source_id\) do nothing/);
  assert.match(recommendation,/BUILD3_RECOMMENDATION_EFFICACY_IMMUTABLE_CONFLICT/);
  assert.match(noTrade,/on conflict \(engine,source_id\) do nothing/);
  assert.match(noTrade,/BUILD3_NO_TRADE_IMMUTABLE_CONFLICT/);
});
