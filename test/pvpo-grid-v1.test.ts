import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPvpoGridV1 } from '../src/pvpo-grid-v1.js';

const leg={side:'CE' as const,expiry:'2026-10-29',strike:25000,underlying_price:24950,underlying_change_pct:0.5,volume:12000,premium:210,premium_change_pct:8,open_interest:45000,oi_change:3000,verification_state:'VERIFIED' as const,source_ref:'provider:snapshot:1',observed_at:'2026-09-28T08:45:00+05:30'};

test('G7 renders exact verified Price Volume Premium OI evidence deterministically',()=>{
  const a=buildPvpoGridV1({run_id:'r1',engine:'5DR',contract_version:'v1',legs:[leg,{...leg,side:'PE',strike:24900,premium_change_pct:-4,oi_change:2000}]});
  const b=buildPvpoGridV1({run_id:'r1',engine:'5DR',contract_version:'v1',legs:[leg,{...leg,side:'PE',strike:24900,premium_change_pct:-4,oi_change:2000}]});
  assert.equal(a.payload_hash,b.payload_hash);
  assert.deepEqual(a.rows.map(x=>x.side),['CE','PE']);
  assert.equal(a.rows[0].interpretation,'PRICE_PREMIUM_OI_EXPANSION');
  assert.equal(a.production_scoring_changed,false);
  assert.equal(a.trading_changed,false);
});

test('G7 refuses missing lineage and invalid numeric evidence',()=>{
  assert.throws(()=>buildPvpoGridV1({run_id:'',engine:'5DR',contract_version:'v1',legs:[leg]}),/LINEAGE/);
  assert.throws(()=>buildPvpoGridV1({run_id:'r1',engine:'5DR',contract_version:'v1',legs:[{...leg,premium:Number.NaN}]}),/NUMERIC/);
});

test('G7 never interprets unverified evidence as verified signal',()=>{
  const x=buildPvpoGridV1({run_id:'r2',engine:'EDGE_STOCKS',contract_version:'v1',legs:[{...leg,verification_state:'NOT_VERIFIED'}]});
  assert.equal(x.rows[0].interpretation,'UNVERIFIED_NO_INTERPRETATION');
});
