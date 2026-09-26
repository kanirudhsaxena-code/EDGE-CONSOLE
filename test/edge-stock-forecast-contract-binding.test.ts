import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEdgeStocksResult } from '../src/edge-stocks';
import { EDGE_STOCK_FORECAST_PATH_VERSION } from '../src/edge-stock-forecast-path';

const path = {
  version: EDGE_STOCK_FORECAST_PATH_VERSION,
  source_run_id: 'EDGE-LTF-G5-001',
  generated_at: '2026-09-24T06:40:00Z',
  sessions: ['2026-09-24','2026-09-25','2026-09-28','2026-09-29','2026-09-30'].map((target_session,index)=>({
    label:index===0?'D':`D+${index}`,
    target_session,
    probabilities:{bull:25,base:50,bear:25},
    expected_price_zone:{low:250+index,high:270+index},
    lineage_id:`EDGE-LTF-G5-001:${index}`
  }))
};

test('G5 EDGE Stocks contract rejects a publishable result without forecast_path',()=>{
  const errors=validateEdgeStocksResult({});
  assert.ok(errors.includes('forecast_path must be an object'));
});

test('G5 EDGE Stocks contract accepts the forecast_path invariant independently of other contract fields',()=>{
  const errors=validateEdgeStocksResult({forecast_path:path});
  assert.equal(errors.some(error=>error.startsWith('forecast_path')),false);
});

test('G5 EDGE Stocks contract rejects an incomplete D through D+4 path',()=>{
  const incomplete=structuredClone(path);
  incomplete.sessions.pop();
  const errors=validateEdgeStocksResult({forecast_path:incomplete});
  assert.ok(errors.some(error=>error.includes('exactly D through D+4')));
});
