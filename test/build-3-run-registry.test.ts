import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILD3_RUN_REGISTRY_SCHEMA_VERSION,
  buildBuild3RunRegistryRecord,
  classifyBuild3MarketPhase,
  validateBuild3RunRegistryRecord,
} from '../src/build-3-run-registry';

test('Build 3.0 registry uses one schema for manual and automatic run identity',()=>{
  const manual=buildBuild3RunRegistryRecord({
    engine:'5DR',
    instrument:'NIFTY',
    source_id:'5drreq_manual',
    model_version:'5DR_V2_1',
    run_timestamp:'2026-10-06T04:00:00.000Z',
    trigger_type:'MANUAL',
  });
  const automatic=buildBuild3RunRegistryRecord({
    engine:'5DR',
    instrument:'NIFTY',
    source_id:'5drreq_auto',
    model_version:'5DR_V2_1',
    run_timestamp:'2026-10-06T04:00:00.000Z',
    trigger_type:'AUTOMATIC',
  });
  assert.equal(manual.registry_schema_version,BUILD3_RUN_REGISTRY_SCHEMA_VERSION);
  assert.deepEqual(Object.keys(manual).sort(),Object.keys(automatic).sort());
  assert.deepEqual(validateBuild3RunRegistryRecord(manual),[]);
  assert.deepEqual(validateBuild3RunRegistryRecord(automatic),[]);
});

test('Build 3.0 market phase is deterministic in IST and closes non-trading sessions',()=>{
  assert.equal(classifyBuild3MarketPhase(new Date('2026-10-06T03:20:00.000Z')),'PRE_OPEN'); // 08:50 IST
  assert.equal(classifyBuild3MarketPhase(new Date('2026-10-06T03:47:00.000Z')),'OPEN'); // 09:17 IST
  assert.equal(classifyBuild3MarketPhase(new Date('2026-10-06T06:30:00.000Z')),'INTRADAY'); // 12:00 IST
  assert.equal(classifyBuild3MarketPhase(new Date('2026-10-06T10:30:00.000Z')),'POST_CLOSE'); // 16:00 IST
  assert.equal(classifyBuild3MarketPhase(new Date('2026-10-04T06:30:00.000Z')),'CLOSED_SESSION'); // Sunday
  assert.equal(classifyBuild3MarketPhase(new Date('2026-10-02T06:30:00.000Z')),'CLOSED_SESSION'); // governed holiday
});

test('Build 3.0 registry rejects incomplete identity',()=>{
  assert.throws(()=>buildBuild3RunRegistryRecord({
    engine:'EDGE_STOCKS',
    instrument:'LTF',
    source_id:'',
    model_version:'EDGE_V1',
    run_timestamp:'2026-10-06T04:00:00.000Z',
    trigger_type:'MANUAL',
  }),/source_id is mandatory/);
});
