import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBuild3Forecast } from '../src/build-3-forecast-contract';
import { buildNiftyBuild3Forecast, LEGACY_FIVEDR_HORIZON_ORDER } from '../src/build-3-nifty-forecast';

const targetSessions=['2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-12'].map((target_session,index)=>({
  horizon:(['D','D+1','D+2','D+3','D+4'] as const)[index],
  target_session
}));
const legacySlots=Object.fromEntries(LEGACY_FIVEDR_HORIZON_ORDER.map((key,index)=>[key,{
  direction:index<2?'BULLISH':'RANGE',
  probabilities:index<2?{BULL:55,RANGE:30,BEAR:15}:{BULL:25,RANGE:50,BEAR:25},
  zone_low:100+index*2,
  zone_high:110+index*2,
  basis:`legacy basis ${key}`
}]));
const geometry=targetSessions.map((row,index)=>({
  ...row,
  expected_centre:105+index*2,
  core_zone:{low:103+index*2,high:107+index*2},
  outer_zone:{low:100+index*2,high:110+index*2}
}));

test('NIFTY migration maps legacy D+1 position to Build 3.0 D target session',()=>{
  const forecast=buildNiftyBuild3Forecast({
    source_id:'5drreq-1',model_version:'5DR_V2_1',issued_at:'2026-10-06T06:00:00Z',
    result:{regime:'TREND',horizon_slots:legacySlots},
    target_sessions:targetSessions,geometry,reference_price_p0:105,
    evidence_snapshot_id:'b3es_abc',evidence_hash:'a'.repeat(64)
  });
  assert.equal(forecast.horizons[0].horizon,'D');
  assert.equal(forecast.horizons[0].target_session,'2026-10-06');
  assert.equal(forecast.horizons[0].reasoning,'legacy basis D+1');
  assert.equal(forecast.horizons[4].horizon,'D+4');
  assert.equal(forecast.horizons[4].reasoning,'legacy basis D+5');
  assert.deepEqual(validateBuild3Forecast(forecast),[]);
});

test('Build 3.0 forecast rejects oversized Core Zone and session disorder',()=>{
  const forecast=buildNiftyBuild3Forecast({
    source_id:'5drreq-2',model_version:'5DR_V2_1',issued_at:'2026-10-06T06:00:00Z',
    result:{regime:'TREND',horizon_slots:legacySlots},
    target_sessions:targetSessions,geometry,reference_price_p0:105,
    evidence_snapshot_id:'b3es_abc',evidence_hash:'b'.repeat(64)
  });
  forecast.horizons[0].core_zone={low:100,high:110};
  forecast.horizons[1].target_session='2026-10-05';
  const errors=validateBuild3Forecast(forecast);
  assert.ok(errors.some(error=>error.includes('Core Zone must be narrower')));
  assert.ok(errors.some(error=>error.includes('strictly increasing')));
});
