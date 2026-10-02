import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEdgeStockForecastReadModel } from '../src/edge-stock-forecast-read';

const recommendationId='EDGE-LTF-20261002-171436-AUTO';
const header={
  path_version:'EDGE_STOCK_FORECAST_PATH_V1',
  source_run_id:recommendationId,
  issued_at:'2026-10-02T17:14:36.000Z',
  payload_hash:'6dd2b50f4fe6108fa593e409414ed8a6fb8c67c6cfccdac54fe55f3e81e7e59f',
};
const labels=['D','D+1','D+2','D+3','D+4'];
const rows=labels.map((horizon_label,horizon_index)=>({
  horizon_index,
  horizon_label,
  target_trading_date:`2026-10-0${5+horizon_index}`,
  direction:horizon_index<2?'BASE':'BULL',
  bull_probability:30+horizon_index,
  base_probability:50-horizon_index,
  bear_probability:20,
  expected_centre:265+horizon_index,
  outer_expected_zone_low:255+horizon_index,
  outer_expected_zone_high:275+horizon_index,
  evidence_basis:'governed G5 evidence',
  regime_context:'stock=NEUTRAL;sector=NEUTRAL',
  verification_state:'VERIFIED',
  lineage:{methodology_version:'G5_STOCK_DD4_V1.0',producer_version:'G5_STOCK_DD4_V1.0'},
}));

test('builds exact D:D+4 Console read model from immutable persistence rows',()=>{
  const result=buildEdgeStockForecastReadModel(header,[...rows].reverse(),recommendationId);
  assert.ok(result);
  assert.equal(result.forecastPath.version,'EDGE_STOCK_FORECAST_PATH_V1');
  assert.equal(result.forecastPath.source_run_id,recommendationId);
  assert.deepEqual(
    (result.forecastPath.sessions as Array<Record<string,unknown>>).map(x=>x.label),
    labels,
  );
  assert.deepEqual(result.forecastSessions.map(x=>x.session_label),labels);
  assert.equal(result.forecastSessions[4].trading_date,'2026-10-09');
  assert.deepEqual(result.forecastSessions[0].expected_zone,{low:255,high:275});
  assert.match(String(result.forecastSessions[0].lineage_id),/^path:EDGE-LTF-20261002-171436-AUTO:0:/);
});

test('does not synthesize a G5 path for legacy recommendations',()=>{
  assert.equal(buildEdgeStockForecastReadModel(null,[],recommendationId),null);
});

test('fails closed on incomplete immutable G5 persistence',()=>{
  assert.throws(
    ()=>buildEdgeStockForecastReadModel(header,rows.slice(0,4),recommendationId),
    /forecast_path\.sessions must contain exactly D through D\+4/,
  );
});

test('fails closed on mutated probability semantics',()=>{
  const bad=structuredClone(rows);
  bad[2].bull_probability=80;
  assert.throws(
    ()=>buildEdgeStockForecastReadModel(header,bad,recommendationId),
    /probabilities must sum to 100/,
  );
});
