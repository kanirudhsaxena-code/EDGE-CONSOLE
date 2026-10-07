import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindBuild3StockCorporateActionTruth,
  type Build3StockCorporateActionEvidence,
} from '../src/build-3-outcome-source';
import type { Build3SessionOhlcSource } from '../src/build-3-outcome-types';

const base:Build3SessionOhlcSource={
  source_version:'BUILD3_SESSION_OHLC_V1',
  engine:'EDGE_STOCKS',
  instrument:'LTF',
  session_date:'2026-10-07',
  captured_at:'2026-10-07T10:15:00.000Z',
  source_ref:'upstox:cache:EDGE_STOCK:PRICE_CANDLES:key:1d#sha256='+'a'.repeat(64),
  provider_hash:'a'.repeat(64),
  actual_open:250,actual_high:260,actual_low:247,actual_close:258,
  corporate_action_state:'UNKNOWN',
  adjustment_basis:'CORPORATE_ACTION_TRUTH_NOT_YET_BOUND',
};

function evidence(data:unknown[]):Build3StockCorporateActionEvidence{
  return {
    snapshot_id:'EDGE-MKT-LTF-20261008',
    captured_at:'2026-10-08T04:00:00.000Z',
    payload_hash:'b'.repeat(64),
    source_ref:'upstox:/v2/fundamentals/INE000000001/corporate-actions#sha256='+'c'.repeat(64),
    payload:{status:'success',data},
  };
}

test('post-session Upstox corporate-action evidence makes a clean stock session scorable',async()=>{
  const source=await bindBuild3StockCorporateActionTruth(base,evidence([
    {name:'Dividend',expiry_date:'14 Aug 2026',amount:5.5,ratio:null,event_details:[]},
  ]));
  assert.equal(source.corporate_action_state,'CLEAR');
  assert.equal(source.adjustment_basis,'UPSTOX_POST_SESSION_CORPORATE_ACTIONS_CLEAR');
  assert.match(source.provider_hash,/^[0-9a-f]{64}$/);
  assert.notEqual(source.provider_hash,base.provider_hash);
});

test('a corporate action on the target session blocks raw-OHLC scoring',async()=>{
  const source=await bindBuild3StockCorporateActionTruth(base,evidence([
    {name:'Split',expiry_date:'7 Oct 2026',amount:null,ratio:'1:2',event_details:[]},
  ]));
  assert.equal(source.corporate_action_state,'CONFLICT');
  assert.match(source.adjustment_basis,/RAW_OHLC_BLOCKED_BY_CORPORATE_ACTION:Split/);
});

test('unparseable corporate-action dates stay fail-closed',async()=>{
  const source=await bindBuild3StockCorporateActionTruth(base,evidence([
    {name:'Bonus',expiry_date:'TBD',ratio:'1:1',event_details:[]},
  ]));
  assert.equal(source.corporate_action_state,'UNKNOWN');
  assert.equal(source.adjustment_basis,'UPSTOX_POST_SESSION_CORPORATE_ACTION_DATES_UNVERIFIED');
});
