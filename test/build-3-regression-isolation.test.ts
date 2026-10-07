import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD3_FORECAST_VERSION, type Build3Forecast } from '../src/build-3-forecast-contract';
import { buildNiftyPrecisionPlan, buildStockPrecisionPlan } from '../src/build-3-precision';
import type { Build3StockPathRow } from '../src/build-3-stock-forecast';

const labels=['D','D+1','D+2','D+3','D+4'] as const;
const dates=['2026-10-07','2026-10-08','2026-10-09','2026-10-12','2026-10-13'];

function baseForecast(engine:'5DR'|'EDGE_STOCKS'):Build3Forecast{
  return {
    forecast_version:BUILD3_FORECAST_VERSION,
    engine,
    instrument:engine==='5DR'?'NIFTY':'LTF',
    source_id:engine==='5DR'?'reg-nifty':'reg-ltf',
    model_version:engine==='5DR'?'5DR_V2_1':'G5_STOCK_DD4_V1.0',
    issued_at:'2026-10-07T04:00:00.000Z',
    reference_price_p0:engine==='5DR'?25000:270,
    evidence_snapshot_id:'b3es_regression',
    evidence_hash:'f'.repeat(64),
    data_quality_state:'VERIFIED',
    horizons:labels.map((horizon,index)=>({
      horizon,target_session:dates[index],
      direction:index<2?'BULL' as const:'RANGE' as const,
      probabilities:index<2?{BULL:60,RANGE:30,BEAR:10}:{BULL:25,RANGE:50,BEAR:25},
      regime:index<2?'TREND' as const:'RANGE' as const,
      reasoning:'frozen production forecast semantics',
      expected_centre:(engine==='5DR'?25000:270)+index,
      core_zone_kind:'CENTRE_ONLY' as const,
      core_zone:{low:(engine==='5DR'?25000:270)+index,high:(engine==='5DR'?25000:270)+index},
      outer_zone:engine==='5DR'
        ?{low:24500-index*20,high:25500+index*20}
        :{low:264-index,high:276+index},
    })),
  };
}

function immutableSemantics(f:Build3Forecast){
  return f.horizons.map(row=>({
    horizon:row.horizon,target_session:row.target_session,direction:row.direction,
    probabilities:row.probabilities,regime:row.regime,reasoning:row.reasoning,
    expected_centre:row.expected_centre,outer_zone:row.outer_zone
  }));
}

test('NIFTY Core Zone SHADOW cannot mutate frozen forecast direction, probability, regime or outer zone',()=>{
  const before=baseForecast('5DR');
  const frozen=structuredClone(immutableSemantics(before));
  const after=buildNiftyPrecisionPlan(before).forecast;
  assert.deepEqual(immutableSemantics(after),frozen);
  assert.ok(after.horizons.some(row=>row.core_zone_kind==='CALIBRATED'));
});

test('stock Core Zone challenger cannot mutate frozen G5 forecast semantics',()=>{
  const before=baseForecast('EDGE_STOCKS');
  const frozen=structuredClone(immutableSemantics(before));
  const rows:Build3StockPathRow[]=labels.map((horizon,index)=>({
    horizon_label:horizon,target_trading_date:dates[index],
    direction:index<2?'BULL':'BASE',
    bull_probability:index<2?60:25,base_probability:index<2?30:50,bear_probability:index<2?10:25,
    expected_centre:270+index,outer_expected_zone_low:264-index,outer_expected_zone_high:276+index,
    evidence_basis:'G5 verified stock-specific evidence',
    regime_context:'stock=BULLISH;sector=NEUTRAL;liquidity=CAUTION;event=MODERATE',
    verification_state:'VERIFIED',
    lineage:{
      p0:270,atr14:3.2,stock_regime:'BULLISH',sector_regime:'NEUTRAL',
      liquidity_state:'CAUTION',event_gap_risk_state:'MODERATE',
      methodology_version:'G5_STOCK_DD4_V1.0'
    }
  }));
  const after=buildStockPrecisionPlan(before,rows).forecast;
  assert.deepEqual(immutableSemantics(after),frozen);
  assert.ok(after.horizons.some(row=>row.core_zone_kind==='CALIBRATED'));
});
