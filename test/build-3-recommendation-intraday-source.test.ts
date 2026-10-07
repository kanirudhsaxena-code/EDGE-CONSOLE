import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBuild3RecommendationIntradaySource } from '../src/build-3-recommendation-intraday-source';

const base={
  engine:'5DR' as const,
  source_id:'5drreq_test',
  provider_instrument_key:'NSE_FO|123',
  session_date:'2026-10-07',
  captured_at:'2026-10-07T10:45:00.000Z',
  source_ref:'upstox:v3:historical:1m:NSE_FO|123:2026-10-07',
};

test('prepares deterministic sorted one-minute option truth',async()=>{
  const input={...base,candles:[
    ['2026-10-07T09:16:00+05:30',101,105,100,104,20,1000],
    ['2026-10-07T09:15:00+05:30',100,102,99,101,10,900],
  ]};
  const one=await prepareBuild3RecommendationIntradaySource(input,'NIFTY');
  const two=await prepareBuild3RecommendationIntradaySource(input,'NIFTY');
  assert.equal(one.candle_interval_minutes,1);
  assert.equal(one.candles[0].timestamp,'2026-10-07T03:45:00.000Z');
  assert.equal(one.candles[1].timestamp,'2026-10-07T03:46:00.000Z');
  assert.equal(one.provider_hash,two.provider_hash);
  assert.equal(one.provider_hash.length,64);
});

test('rejects candle timestamps outside the governed target session',async()=>{
  await assert.rejects(
    prepareBuild3RecommendationIntradaySource({...base,candles:[
      ['2026-10-08T09:15:00+05:30',100,102,99,101,10,900],
    ]},'NIFTY'),
    /BUILD3_INTRADAY_CANDLE_SESSION_MISMATCH/
  );
});

test('rejects malformed OHLC and duplicate minute timestamps',async()=>{
  await assert.rejects(
    prepareBuild3RecommendationIntradaySource({...base,candles:[
      ['2026-10-07T09:15:00+05:30',100,99,101,100,10,900],
    ]},'NIFTY'),
    /BUILD3_INTRADAY_CANDLE_OHLC_INVALID/
  );
  await assert.rejects(
    prepareBuild3RecommendationIntradaySource({...base,candles:[
      ['2026-10-07T09:15:00+05:30',100,102,99,101,10,900],
      ['2026-10-07T09:15:00+05:30',101,103,100,102,10,900],
    ]},'NIFTY'),
    /BUILD3_INTRADAY_CANDLE_DUPLICATE_TIMESTAMP/
  );
});
