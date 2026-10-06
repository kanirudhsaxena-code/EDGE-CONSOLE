import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILD3_RUN_CONTRACT_VERSION,
  validateBuild3RunContract
} from '../src/build-3-run-contract';

const sessions=['2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-12'].map((target_session,index)=>({
  horizon:index===0?'D':`D+${index}`,
  target_session
}));

const base={
  contract_version:BUILD3_RUN_CONTRACT_VERSION,
  engine:'EDGE_STOCKS',
  instrument:'LTF',
  run_id:'EDGE-LTF-20261006-100000',
  model_version:'EDGE_V1',
  run_timestamp:'2026-10-06T04:30:00Z',
  trigger_type:'MANUAL',
  market_phase:'INTRADAY',
  reference_price_p0:263.35,
  evidence_snapshot_id:'snapshot-1',
  evidence_hash:'abc123',
  data_quality:'VERIFIED',
  target_sessions:sessions
};

test('Build 3.0 accepts the same mandatory run shape for manual and automatic triggers',()=>{
  assert.deepEqual(validateBuild3RunContract(base),[]);
  const automatic={...base,run_id:'EDGE-LTF-20261006-100001',trigger_type:'AUTOMATIC'};
  assert.deepEqual(validateBuild3RunContract(automatic),[]);
});

test('Build 3.0 treats market phase as lineage, not as a different contract',()=>{
  for(const market_phase of ['PRE_OPEN','OPEN','INTRADAY','POST_CLOSE','CLOSED_SESSION']){
    const candidate={...base,run_id:`run-${market_phase}`,market_phase};
    assert.deepEqual(validateBuild3RunContract(candidate),[]);
  }
});

test('Build 3.0 requires exactly D through D+4 in increasing trading-session order',()=>{
  const missing=structuredClone(base);
  missing.target_sessions.splice(2,1);
  assert.ok(validateBuild3RunContract(missing).some(x=>x.includes('exactly D through D+4')));

  const repeated=structuredClone(base);
  repeated.target_sessions[3].target_session=repeated.target_sessions[2].target_session;
  assert.ok(validateBuild3RunContract(repeated).some(x=>x.includes('strictly increasing')));
});

test('Build 3.0 requires immutable identity, P0 and evidence lineage fields',()=>{
  const bad={...base,reference_price_p0:0,evidence_hash:'',run_timestamp:'not-a-time'};
  const errors=validateBuild3RunContract(bad);
  assert.ok(errors.some(x=>x.includes('reference_price_p0')));
  assert.ok(errors.some(x=>x.includes('evidence_hash')));
  assert.ok(errors.some(x=>x.includes('run_timestamp')));
});
