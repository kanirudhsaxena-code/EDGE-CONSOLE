import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILD3_NIFTY_DAILY_SERIES,
  buildBuild3SessionOhlcFromCache,
} from '../src/build-3-outcome-source';

const stamp='2026-10-07T03:45:00.000Z';

function fiveDrRow(){
  const documentHash='a'.repeat(64),datasetHash='b'.repeat(64);
  return {
    provider_id:'UPSTOX',source_semantic:'UPSTOX_AUTHENTICATED',
    document_sha256:documentHash,dataset_sha256:datasetHash,
    latest_timestamp:stamp,record_count:1,updated_at:'2026-10-07T10:00:00.000Z',
    document:{
      schema:'market-cache-document-v1',series_id:BUILD3_NIFTY_DAILY_SERIES,
      provider_id:'UPSTOX',source_semantic:'UPSTOX_AUTHENTICATED',
      record_count:1,latest_timestamp:stamp,dataset_sha256:datasetHash,
      records:[{
        timestamp:stamp,candle:[stamp,100,104,99,103,1000,0],
        market_sha256:'c'.repeat(64),
        provenance:{source_path:'/v3/historical-candle/NIFTY/days/1',sha256:'d'.repeat(64),received_at:'2026-10-07T10:00:00.000Z'},
        supersedes_market_sha256:null,
      }],
      audit_events:[],document_sha256:documentHash,
    },
  };
}

test('Wave 3 reader converts immutable 5DR daily cache to attributable NIFTY Truth OHLC',()=>{
  const source=buildBuild3SessionOhlcFromCache(fiveDrRow(),{
    engine:'5DR',instrument:'NIFTY',source_id:'req-1',target_session:'2026-10-07',
  },BUILD3_NIFTY_DAILY_SERIES);
  assert.ok(source);
  assert.deepEqual(
    [source.actual_open,source.actual_high,source.actual_low,source.actual_close],
    [100,104,99,103],
  );
  assert.equal(source.provider_hash,'d'.repeat(64));
  assert.equal(source.corporate_action_state,'NOT_APPLICABLE');
  assert.match(source.source_ref,/UPSTOX|upstox/i);
});

test('Wave 3 reader returns no source rather than fabricating a missing session',()=>{
  const source=buildBuild3SessionOhlcFromCache(fiveDrRow(),{
    engine:'5DR',instrument:'NIFTY',source_id:'req-1',target_session:'2026-10-08',
  },BUILD3_NIFTY_DAILY_SERIES);
  assert.equal(source,null);
});

test('stock cache Truth is price-attributable but corporate-action scoring fails closed',()=>{
  const series='EDGE_STOCK:PRICE_CANDLES:NSE_EQ|INE000000001:1d';
  const documentHash='e'.repeat(64),datasetHash='f'.repeat(64);
  const row={
    provider_id:'UPSTOX',source_semantic:'UPSTOX_AUTHENTICATED',
    document_sha256:documentHash,dataset_sha256:datasetHash,
    latest_timestamp:stamp,record_count:1,updated_at:'2026-10-07T10:30:00.000Z',
    document:{
      schema:'market-cache-document-v1',series_id:series,
      provider_id:'UPSTOX',source_semantic:'UPSTOX_AUTHENTICATED',
      record_count:1,latest_timestamp:stamp,dataset_sha256:datasetHash,
      records:[{timestamp:stamp,candle:[stamp,250,260,247,258,500000,0]}],
      audit_events:[],document_sha256:documentHash,
    },
  };
  const source=buildBuild3SessionOhlcFromCache(row,{
    engine:'EDGE_STOCKS',instrument:'LTF',source_id:'life-1',target_session:'2026-10-07',
  },series);
  assert.ok(source);
  assert.equal(source.provider_hash,documentHash);
  assert.equal(source.corporate_action_state,'UNKNOWN');
  assert.equal(source.adjustment_basis,'CORPORATE_ACTION_TRUTH_NOT_YET_BOUND');
});

test('cache identity/hash mismatch is rejected instead of weakening provenance',()=>{
  const row=fiveDrRow();
  row.document.document_sha256='0'.repeat(64);
  assert.throws(()=>buildBuild3SessionOhlcFromCache(row,{
    engine:'5DR',instrument:'NIFTY',source_id:'req-1',target_session:'2026-10-07',
  },BUILD3_NIFTY_DAILY_SERIES),/CACHE_HASH_INVALID/);
});
