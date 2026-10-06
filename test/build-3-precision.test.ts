import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD3_FORECAST_VERSION, type Build3Forecast } from '../src/build-3-forecast-contract';
import {
  NIFTY_CORE_CALIBRATION_VERSION,
  STOCK_CORE_CALIBRATION_VERSION,
  buildNiftyPrecisionPlan,
  buildStockPrecisionPlan,
  stockCoreCalibrationFactors,
} from '../src/build-3-precision';
import type { Build3StockPathRow } from '../src/build-3-stock-forecast';

const labels=['D','D+1','D+2','D+3','D+4'] as const;
const dates=['2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-12'];

function forecast(engine:'5DR'|'EDGE_STOCKS'):Build3Forecast{
  return {
    forecast_version:BUILD3_FORECAST_VERSION,
    engine,
    instrument:engine==='5DR'?'NIFTY':'LTF',
    source_id:engine==='5DR'?'nifty-1':'ltf-1',
    model_version:engine==='5DR'?'5DR_V2_1':'G5_STOCK_DD4_V1.0',
    issued_at:'2026-10-06T06:00:00.000Z',
    reference_price_p0:100,
    evidence_snapshot_id:'b3es_precision',
    evidence_hash:'a'.repeat(64),
    data_quality_state:'VERIFIED',
    horizons:labels.map((horizon,index)=>({
      horizon,target_session:dates[index],direction:'BULL' as const,
      probabilities:{BULL:60,RANGE:30,BEAR:10},regime:'TREND' as const,
      reasoning:'governed precision fixture',
      expected_centre:100+index,
      core_zone_kind:'CENTRE_ONLY' as const,
      core_zone:{low:100+index,high:100+index},
      outer_zone:{low:95+index,high:105+index},
    })),
  };
}

function stockRows(withAtr=true):Build3StockPathRow[]{
  return labels.map((horizon,index)=>({
    horizon_label:horizon,target_trading_date:dates[index],direction:'BULL',
    bull_probability:60,base_probability:30,bear_probability:10,
    expected_centre:100+index,outer_expected_zone_low:95+index,outer_expected_zone_high:105+index,
    evidence_basis:'verified stock evidence',
    regime_context:'stock=BULLISH;sector=NEUTRAL;liquidity=NORMAL;event=NO_MATERIAL_RISK',
    verification_state:'VERIFIED',
    lineage:{
      p0:100,methodology_version:'G5_STOCK_DD4_V1.0',
      ...(withAtr?{atr_points:2}:{})
    },
  }));
}

test('NIFTY uses its governed independent V0.1 D through D+4 half-width schedule',()=>{
  const plan=buildNiftyPrecisionPlan(forecast('5DR'));
  assert.equal(plan.issuance.every(row=>row.calibration_version===NIFTY_CORE_CALIBRATION_VERSION),true);
  assert.deepEqual(
    plan.issuance.map(row=>Number((row.core_width_percent/2).toFixed(2))),
    [0.50,0.55,0.60,0.65,0.75],
  );
  assert.equal(plan.forecast.horizons.every(row=>row.core_zone_kind==='CALIBRATED'),true);
});

test('stock Core calibration is ATR/factor-driven and never reuses NIFTY width version',()=>{
  const rows=stockRows(true);
  const plan=buildStockPrecisionPlan(forecast('EDGE_STOCKS'),rows);
  assert.equal(plan.issuance.every(row=>row.calibration_version===STOCK_CORE_CALIBRATION_VERSION),true);
  assert.equal(plan.issuance.every(row=>row.calibration_version!==NIFTY_CORE_CALIBRATION_VERSION),true);
  assert.equal(plan.issuance.every(row=>row.calibration_state==='UNVALIDATED_SHADOW'),true);
  assert.equal(plan.forecast.horizons.every(row=>row.core_zone_kind==='CALIBRATED'),true);
  assert.ok(plan.issuance[0].core_width_points>0);
  assert.equal(plan.issuance[0].calibration_inputs.empirical_validation_state,'2C-02_OPEN');
});

test('stock calibration fails closed to centre-only when attributable ATR/volatility is missing',()=>{
  const rows=stockRows(false);
  const plan=buildStockPrecisionPlan(forecast('EDGE_STOCKS'),rows);
  assert.equal(plan.issuance.every(row=>row.calibration_state==='CALIBRATION_PENDING'),true);
  assert.equal(plan.forecast.horizons.every(row=>row.core_zone_kind==='CENTRE_ONLY'),true);
  assert.deepEqual(stockCoreCalibrationFactors(rows[0]).missing,['ATR_OR_STOCK_VOLATILITY']);
});

test('precision issuance stores width and anti-width-gaming geometry explicitly',()=>{
  const plan=buildNiftyPrecisionPlan(forecast('5DR'));
  for(const row of plan.issuance){
    assert.equal(row.core_width_points,row.core_high-row.core_low);
    assert.equal(row.outer_width_points,row.outer_high-row.outer_low);
    assert.ok(row.core_width_points<row.outer_width_points);
    assert.ok(row.core_width_percent<row.outer_width_percent);
  }
});

test('calibration blocks rather than silently widening beyond the frozen Outer Zone',()=>{
  const base=forecast('5DR');
  base.horizons[0].outer_zone={low:99.9,high:100.1};
  const plan=buildNiftyPrecisionPlan(base);
  assert.equal(plan.issuance[0].calibration_state,'CALIBRATION_BLOCKED');
  assert.equal(plan.forecast.horizons[0].core_zone_kind,'CENTRE_ONLY');
  assert.deepEqual(plan.forecast.horizons[0].core_zone,{low:100,high:100});
});
