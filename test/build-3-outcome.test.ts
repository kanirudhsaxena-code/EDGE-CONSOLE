import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreBuild3HorizonOutcome } from '../src/build-3-outcome-score';
import { validateBuild3SessionOhlc } from '../src/build-3-outcome-types';
import type { Build3ForecastHorizon } from '../src/build-3-forecast-contract';
import type { Build3PrecisionIssuance } from '../src/build-3-precision';

const row:Build3ForecastHorizon={
  horizon:'D+1',target_session:'2026-10-07',direction:'BULL',
  probabilities:{BULL:60,RANGE:30,BEAR:10},regime:'TREND',
  reasoning:'fixture',expected_centre:101,core_zone_kind:'CALIBRATED',
  core_zone:{low:100,high:102},outer_zone:{low:97,high:105},
};
const precision:Build3PrecisionIssuance={
  precision_version:'MDOS_BUILD_3_PRECISION_V1',engine:'5DR',instrument:'NIFTY',
  source_id:'req-1',horizon:'D+1',target_session:'2026-10-07',
  calibration_version:'NIFTY_CORE_ZONE_V0_1_SHADOW',calibration_state:'CALIBRATED_SHADOW',
  normalization_basis:'EXPECTED_CENTRE_PERCENT',expected_centre:101,
  core_low:100,core_high:102,outer_low:97,outer_high:105,
  core_width_points:2,core_width_percent:2,outer_width_points:8,outer_width_percent:8,
  calibration_inputs:{},
};
const source={
  source_version:'BUILD3_SESSION_OHLC_V1',engine:'5DR' as const,instrument:'NIFTY',
  session_date:'2026-10-07',captured_at:'2026-10-07T10:20:00.000Z',
  source_ref:'UPSTOX_AUTHENTICATED:NIFTY_DAILY:2026-10-07:abc',
  provider_hash:'a'.repeat(64),actual_open:100,actual_high:104,actual_low:99,actual_close:103,
  corporate_action_state:'NOT_APPLICABLE' as const,adjustment_basis:'INDEX_RAW',
};

test('Wave 3 requires complete valid OHLC geometry',()=>{
  assert.deepEqual(validateBuild3SessionOhlc(source),[]);
  assert.ok(validateBuild3SessionOhlc({...source,actual_high:98}).includes('ohlc_geometry'));
});

test('direction uses frozen P0 and Core/Outer touch and close stay separate',()=>{
  const o=scoreBuild3HorizonOutcome({
    engine:'5DR',instrument:'NIFTY',source_id:'req-1',reference_price_p0:100,row,precision,source,
    evaluated_at:'2026-10-07T10:21:00.000Z',
  });
  assert.equal(o.direction_result,'HIT');
  assert.equal(o.direction_margin_points,3);
  assert.equal(o.outer_touch,true);
  assert.equal(o.outer_close_hit,true);
  assert.equal(o.core_touch,true);
  assert.equal(o.core_close_hit,false);
  assert.equal(o.centre_error,2);
  assert.equal(o.normalized_centre_error,2);
  assert.equal(o.miss_distance,1);
});

test('probability calibration is three-class Brier from frozen issuance width only',()=>{
  const o=scoreBuild3HorizonOutcome({
    engine:'5DR',instrument:'NIFTY',source_id:'req-1',reference_price_p0:100,row,precision,source,
  });
  assert.equal(o.realized_probability_class,'BULL');
  assert.equal(o.probability_state,'SCORABLE');
  assert.ok(Math.abs((o.brier_score??0)-0.26)<1e-12);
  assert.equal(o.brier_components.rule_version,'FROZEN_CORE_WIDTH_REBASED_TO_P0_V1');
});

test('RANGE preserves frozen engine semantics: close containment in Outer Zone',()=>{
  const range={...row,direction:'RANGE' as const};
  const hit=scoreBuild3HorizonOutcome({
    engine:'5DR',instrument:'NIFTY',source_id:'req-1',reference_price_p0:100,
    row:range,precision,source:{...source,actual_close:101},
  });
  assert.equal(hit.direction_result,'HIT');
  const miss=scoreBuild3HorizonOutcome({
    engine:'5DR',instrument:'NIFTY',source_id:'req-1',reference_price_p0:100,
    row:range,precision,source:{...source,actual_high:108,actual_close:107},
  });
  assert.equal(miss.direction_result,'MISS');
});

test('stock corporate-action uncertainty blocks headline scoring explicitly',()=>{
  const p={...precision,engine:'EDGE_STOCKS' as const,instrument:'LTF',source_id:'edge-1'};
  const o=scoreBuild3HorizonOutcome({
    engine:'EDGE_STOCKS',instrument:'LTF',source_id:'edge-1',reference_price_p0:100,row,precision:p,
    source:{...source,engine:'EDGE_STOCKS',instrument:'LTF',corporate_action_state:'UNKNOWN',adjustment_basis:'UNVERIFIED'},
  });
  assert.equal(o.scorability_state,'NOT_SCORABLE');
  assert.equal(o.direction_result,'NOT_SCORABLE');
  assert.equal(o.probability_state,'NOT_SCORABLE');
});

test('centre-only Core remains direction/zone scorable but Brier fails closed',()=>{
  const p={...precision,core_low:101,core_high:101,core_width_points:0,core_width_percent:0};
  const o=scoreBuild3HorizonOutcome({
    engine:'5DR',instrument:'NIFTY',source_id:'req-1',reference_price_p0:100,row,precision:p,source,
  });
  assert.equal(o.direction_result,'HIT');
  assert.equal(o.probability_state,'NOT_SCORABLE');
  assert.equal(o.brier_score,null);
});
