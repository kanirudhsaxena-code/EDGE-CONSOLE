import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BUILD3_SCHEMA_MIGRATIONS,
  BUILD3_SCHEMA_REQUIRED_COLUMNS,
  BUILD3_SCHEMA_TABLES,
  splitBuild3MigrationStatements,
} from '../src/build-3-schema-migration';

test('preview schema bundle is byte-identical to checked-in Build 3.0 migrations',()=>{
  for(const migration of BUILD3_SCHEMA_MIGRATIONS){
    const source=readFileSync(new URL('../'+migration.path,import.meta.url),'utf8');
    assert.equal(migration.sql,source,migration.path);
  }
});

test('Build 3.0 schema status covers every Wave 1 through Wave 3 persistence surface',()=>{
  assert.deepEqual(BUILD3_SCHEMA_TABLES,[
    'build3_run_registry','build3_evidence_snapshots','build3_data_quality_assessments',
    'build3_forecast_horizons','build3_precision_issuance','build3_precision_outcomes',
    'build3_decisions','build3_session_ohlc_sources','build3_outcome_attempts','build3_decision_outcomes',
    'build3_recommendation_efficacy','build3_recommendation_observation_attempts','build3_recommendation_intraday_sources','build3_recommendation_intraday_dispatch_attempts'
  ]);
  assert.ok(BUILD3_SCHEMA_REQUIRED_COLUMNS.some(([table,column])=>table==='build3_decisions'&&column==='execution_snapshot'));
  assert.ok(BUILD3_SCHEMA_REQUIRED_COLUMNS.some(([table,column])=>table==='build3_precision_outcomes'&&column==='brier_score'));
  assert.ok(BUILD3_SCHEMA_REQUIRED_COLUMNS.some(([table,column])=>table==='build3_precision_outcomes'&&column==='zone_efficacy_version'));
  assert.ok(BUILD3_SCHEMA_REQUIRED_COLUMNS.some(([table,column])=>table==='build3_recommendation_efficacy'&&column==='classification'));
});

test('migration splitter preserves PL/pgSQL dollar-quoted function bodies',()=>{
  const sample=`create table if not exists x(id int);
create or replace function f() returns trigger language plpgsql as $$ begin
  perform 1;
  return new;
end $$;
create trigger t before update on x for each row execute function f();`;
  const statements=splitBuild3MigrationStatements(sample);
  assert.equal(statements.length,3);
  assert.match(statements[1],/perform 1;/);
  assert.match(statements[1],/end \$\$/);
});

test('preview schema admin is branch-host and Access-proof gated',()=>{
  const source=readFileSync(new URL('../src/mobile-v1-entry.ts',import.meta.url),'utf8');
  assert.match(source,/build-3-0-accuracy-loop-20261006-edge-console\.k-anirudhsaxena\.workers\.dev/);
  assert.match(source,/Cf-Access-Jwt-Assertion/);
  assert.match(source,/X-Build3-Schema-Action/);
  assert.match(source,/APPLY_ADDITIVE_BUILD3_V1/);
});
