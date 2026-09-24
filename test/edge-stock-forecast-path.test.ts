import test from 'node:test';
import assert from 'node:assert/strict';
import { EDGE_STOCK_FORECAST_PATH_VERSION, validateEdgeStockForecastPath } from '../src/edge-stock-forecast-path';

const validPath = {
  version: EDGE_STOCK_FORECAST_PATH_VERSION,
  source_run_id: 'EDGE-LTF-20260924-001',
  generated_at: '2026-09-24T05:30:00Z',
  sessions: ['2026-09-24','2026-09-25','2026-09-28','2026-09-29','2026-09-30'].map((target_session,index)=>({
    label: index === 0 ? 'D' : `D+${index}`,
    target_session,
    probabilities:{bull:25,base:50,bear:25},
    expected_price_zone:{low:250+index,high:270+index},
    lineage_id:`EDGE-LTF-20260924-001:${index}`
  }))
};

test('G5 accepts a complete D through D+4 forecast path',()=>{
  assert.deepEqual(validateEdgeStockForecastPath(validPath),[]);
});

test('G5 requires all five ordered trading-session labels',()=>{
  const bad=structuredClone(validPath);
  bad.sessions.splice(2,1);
  const errors=validateEdgeStockForecastPath(bad);
  assert.ok(errors.some(x=>x.includes('exactly D through D+4')));
  assert.ok(errors.some(x=>x.includes('.label must be D+2')));
});

test('G5 rejects probability vectors that do not sum to 100',()=>{
  const bad=structuredClone(validPath);
  bad.sessions[4].probabilities={bull:40,base:40,bear:40};
  assert.ok(validateEdgeStockForecastPath(bad).some(x=>x.includes('must sum to 100')));
});

test('G5 requires lineage and increasing target sessions',()=>{
  const bad=structuredClone(validPath);
  bad.sessions[1].target_session=bad.sessions[0].target_session;
  bad.sessions[3].lineage_id='';
  const errors=validateEdgeStockForecastPath(bad);
  assert.ok(errors.some(x=>x.includes('strictly increasing trading sessions')));
  assert.ok(errors.some(x=>x.includes('lineage_id is mandatory')));
});

test('G5 forecast path is independent of execution action, including NO TRADE',()=>{
  const noTradeRun={primary_action:'NO TRADE; NO OPTION TRADE.',forecast_path:structuredClone(validPath)};
  assert.equal(noTradeRun.primary_action.startsWith('NO TRADE'),true);
  assert.deepEqual(validateEdgeStockForecastPath(noTradeRun.forecast_path),[]);
});
