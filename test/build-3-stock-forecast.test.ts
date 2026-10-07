import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStockBuild3Forecast, build3StockRegimeFromContext } from '../src/build-3-stock-forecast';
import { validateBuild3Forecast } from '../src/build-3-forecast-contract';

const labels=['D','D+1','D+2','D+3','D+4'] as const;
const dates=['2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-12'];
const targetSessions=labels.map((horizon,index)=>({horizon,target_session:dates[index]}));
const rows=labels.map((horizon,index)=>({
  horizon_label:horizon,
  target_trading_date:dates[index],
  direction:index<2?'BULL':'BASE',
  bull_probability:index<2?60:25,
  base_probability:index<2?30:50,
  bear_probability:index<2?10:25,
  expected_centre:270+index,
  outer_expected_zone_low:264-index,
  outer_expected_zone_high:276+index,
  evidence_basis:'G5_STOCK_DD4_V1.0 verified stock-specific P0/ATR/regime/liquidity/event evidence',
  regime_context:'stock=BULLISH;sector=NEUTRAL;liquidity=NORMAL;event=NO_MATERIAL_RISK',
  verification_state:'VERIFIED',
  lineage:{p0:268,methodology_version:'G5_STOCK_DD4_V1.0'}
}));

test('EDGE Stocks governed G5 path maps exactly into Build 3.0 D through D+4 contract',()=>{
  const forecast=buildStockBuild3Forecast({
    ticker:'LTF',source_id:'EDGE-LTF-20261006-AUTO',
    path_version:'EDGE_STOCK_FORECAST_PATH_V1',issued_at:'2026-10-06T04:00:00Z',
    target_sessions:targetSessions,rows,
    evidence_snapshot_id:'b3es_stock',evidence_hash:'c'.repeat(64)
  });
  assert.equal(forecast.engine,'EDGE_STOCKS');
  assert.equal(forecast.source_id,'EDGE-LTF-20261006-AUTO');
  assert.equal(forecast.reference_price_p0,268);
  assert.equal(forecast.model_version,'G5_STOCK_DD4_V1.0');
  assert.equal(forecast.horizons[0].direction,'BULL');
  assert.equal(forecast.horizons[2].direction,'RANGE');
  assert.equal(forecast.horizons[2].probabilities.RANGE,50);
  assert.equal(forecast.horizons[0].regime,'TREND');
  assert.equal(forecast.horizons[0].core_zone_kind,'CENTRE_ONLY');
  assert.deepEqual(forecast.horizons[0].core_zone,{low:270,high:270});
  assert.deepEqual(validateBuild3Forecast(forecast),[]);
});

test('stock regime mapping is deterministic and fail-closed',()=>{
  assert.equal(build3StockRegimeFromContext('stock=NEUTRAL;sector=NEUTRAL;liquidity=NORMAL;event=NO_MATERIAL_RISK'),'RANGE');
  assert.equal(build3StockRegimeFromContext('stock=TRANSITION;sector=BULLISH;liquidity=NORMAL;event=NO_MATERIAL_RISK'),'TRANSITION');
  assert.equal(build3StockRegimeFromContext('stock=BULLISH;sector=NEUTRAL;liquidity=WEAK;event=HIGH_RISK'),'EVENT_SHOCK');
  assert.throws(()=>build3StockRegimeFromContext('stock=UNKNOWN;sector=UNKNOWN'),/BUILD3_STOCK_REGIME_INVALID/);
});

test('stock adapter rejects unverified rows and inconsistent frozen P0 lineage',()=>{
  const unverified=rows.map(row=>({...row,lineage:{...row.lineage}}));
  unverified[1].verification_state='UNVERIFIED';
  assert.throws(()=>buildStockBuild3Forecast({
    ticker:'LTF',source_id:'EDGE-LTF-1',path_version:'EDGE_STOCK_FORECAST_PATH_V1',
    issued_at:'2026-10-06T04:00:00Z',target_sessions:targetSessions,rows:unverified,
    evidence_snapshot_id:'b3es_stock',evidence_hash:'d'.repeat(64)
  }),/BUILD3_STOCK_ROW_NOT_VERIFIED/);

  const p0Mismatch=rows.map(row=>({...row,lineage:{...row.lineage}}));
  p0Mismatch[4].lineage.p0=269;
  assert.throws(()=>buildStockBuild3Forecast({
    ticker:'LTF',source_id:'EDGE-LTF-2',path_version:'EDGE_STOCK_FORECAST_PATH_V1',
    issued_at:'2026-10-06T04:00:00Z',target_sessions:targetSessions,rows:p0Mismatch,
    evidence_snapshot_id:'b3es_stock',evidence_hash:'e'.repeat(64)
  }),/BUILD3_STOCK_P0_LINEAGE_MISMATCH/);
});
