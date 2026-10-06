import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILD3_EVIDENCE_SNAPSHOT_VERSION,
  buildBuild3EvidenceSnapshot,
  canonicalBuild3EvidenceJson,
} from '../src/build-3-evidence-snapshot';

test('Build 3.0 evidence hash is canonical across object key order',async()=>{
  const a={market:{price:100,source:'UPSTOX'},research:{event:'NONE',fresh:true}};
  const b={research:{fresh:true,event:'NONE'},market:{source:'UPSTOX',price:100}};
  assert.equal(canonicalBuild3EvidenceJson(a),canonicalBuild3EvidenceJson(b));
  const left=await buildBuild3EvidenceSnapshot({
    engine:'5DR',instrument:'NIFTY',source_id:'run-1',evidence:a,frozen_at:'2026-10-06T06:00:00Z'
  });
  const right=await buildBuild3EvidenceSnapshot({
    engine:'5DR',instrument:'NIFTY',source_id:'run-1',evidence:b,frozen_at:'2026-10-06T06:00:00Z'
  });
  assert.equal(left.snapshot_version,BUILD3_EVIDENCE_SNAPSHOT_VERSION);
  assert.equal(left.evidence_hash,right.evidence_hash);
  assert.equal(left.snapshot_id,right.snapshot_id);
});

test('Build 3.0 evidence identity changes when evidence changes',async()=>{
  const base=await buildBuild3EvidenceSnapshot({
    engine:'EDGE_STOCKS',instrument:'LTF',source_id:'lc-1',evidence:{price:100},
    frozen_at:'2026-10-06T06:00:00Z'
  });
  const changed=await buildBuild3EvidenceSnapshot({
    engine:'EDGE_STOCKS',instrument:'LTF',source_id:'lc-1',evidence:{price:101},
    frozen_at:'2026-10-06T06:00:00Z'
  });
  assert.notEqual(base.evidence_hash,changed.evidence_hash);
  assert.notEqual(base.snapshot_id,changed.snapshot_id);
});

test('Build 3.0 evidence snapshot preserves arrays and null values exactly',async()=>{
  const evidence={sources:['UPSTOX','NSE'],optional:null,levels:[1,2,3]};
  const snapshot=await buildBuild3EvidenceSnapshot({
    engine:'5DR',instrument:'NIFTY',source_id:'run-2',evidence,
    frozen_at:'2026-10-06T06:00:00Z'
  });
  assert.deepEqual(snapshot.evidence,evidence);
});
