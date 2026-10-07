import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPECTED,validateSessions,renderRows } from '../public/edge-stocks-five-session.js';

const sessions=EXPECTED.map((session_label,i)=>({session_label,trading_date:`2026-10-0${i+1}`,direction:i%2?'BASE':'BULL',probabilities:i%2?{bull:20,base:60,bear:20}:{bull:60,base:30,bear:10},expected_zone:{low:270+i,high:275+i},regime_context:i<2?'TRANSITION':'TREND',evidence_basis:`Governed evidence basis ${i}`,verification_state:'VERIFIED'}));
const report={run_id:'EDGE-LTF-G5',current_stock_outcome:{forecast_horizon:'D:D+4',forecast_sessions:sessions}};

test('G5 accepts only exact ordered D:D+4 read-model sessions',()=>{assert.deepEqual(validateSessions(report),sessions)});
test('G5 rejects D+5 structurally',()=>{const bad=structuredClone(report);bad.current_stock_outcome.forecast_sessions[4].session_label='D+5';assert.throws(()=>validateSessions(bad),/order mismatch/)});
test('G5 renders all five canonical rows from the supplied read model without reconstruction',()=>{const html=renderRows(validateSessions(report));assert.equal((html.match(/data-edge-forecast-row=/g)||[]).length,5);let cursor=-1;for(const label of EXPECTED){const next=html.indexOf(`data-edge-forecast-row="${label}"`);assert.ok(next>cursor);cursor=next}for(const row of sessions){assert.ok(html.includes(row.trading_date.slice(8,10)));assert.ok(html.includes(String(row.expected_zone.low)));assert.ok(html.includes(String(row.expected_zone.high)));assert.ok(html.includes('data-edge-bull="'+row.probabilities.bull+'"'));assert.ok(html.includes('data-edge-base="'+row.probabilities.base+'"'));assert.ok(html.includes('data-edge-bear="'+row.probabilities.bear+'"'))}});
test('G5 rejects direction that disagrees with persisted probabilities',()=>{const bad=structuredClone(report);bad.current_stock_outcome.forecast_sessions[0].direction='BEAR';assert.throws(()=>validateSessions(bad),/direction\/probability mismatch/)})

test('G5 display rounds floating point artifacts while preserving raw parity attributes',()=>{const rows=structuredClone(sessions);rows[0].probabilities={bull:7.999999999999999,base:20,bear:72.00000000000001};const html=renderRows(rows);assert.ok(html.includes('data-edge-bull="7.999999999999999"'));assert.ok(html.includes('data-edge-bear="72.00000000000001"'));assert.ok(html.includes('Bull 8.0%'));assert.ok(html.includes('Bear 72.0%'));assert.ok(!html.includes('Bull 7.999999999999999%'));});


test('G5 visible path includes regime, evidence basis and verification state',()=>{
  const html=renderRows(validateSessions(report));
  for(const row of sessions){
    assert.ok(html.includes('data-edge-regime-context="'+row.regime_context+'"'));
    assert.ok(html.includes('data-edge-evidence-basis="'+row.evidence_basis+'"'));
    assert.ok(html.includes('data-edge-verification-state="'+row.verification_state+'"'));
    assert.ok(html.includes('Regime: '+row.regime_context));
    assert.ok(html.includes('Evidence: '+row.evidence_basis));
  }
});
test('G5 rejects missing regime/evidence semantics',()=>{
  const bad=structuredClone(report);
  delete bad.current_stock_outcome.forecast_sessions[0].regime_context;
  assert.throws(()=>validateSessions(bad),/regime context missing/);
});


test('Build 3.0 stock path renders persisted Core Zone and calibration state on every horizon',()=>{
  const current=structuredClone(report);
  current.build3_precision={
    version:'MDOS_BUILD_3_CORE_ZONE_OUTPUT_V1',
    engine:'EDGE_STOCKS',
    instrument:'LTF',
    source_id:'life-1',
    horizon_count:5,
    shadow_only:true,
    production_methodology_changed:false,
    rows:EXPECTED.map((horizon,i)=>({
      horizon,target_session:sessions[i].trading_date,expected_centre:272+i,
      core_zone:{low:271+i,high:273+i},outer_zone:{...sessions[i].expected_zone},
      core_width_points:2,core_width_percent:0.7,outer_width_points:5,outer_width_percent:1.8,
      calibration_version:'STOCK_CORE_ZONE_CHALLENGER_V0_1',
      calibration_state:'UNVALIDATED_SHADOW',normalization_basis:'STOCK_ATR_POINTS'
    }))
  };
  current.current_stock_outcome.forecast_sessions=current.current_stock_outcome.forecast_sessions.map((row,i)=>({
    ...row,
    core_zone:{low:271+i,high:273+i},
    core_zone_width_points:2,
    core_zone_width_percent:0.7,
    core_zone_calibration:{
      version:'STOCK_CORE_ZONE_CHALLENGER_V0_1',
      state:'UNVALIDATED_SHADOW',
      normalization_basis:'STOCK_ATR_POINTS',
      shadow_only:true,
      production_methodology_changed:false
    }
  }));
  const rows=validateSessions(current);
  const html=renderRows(rows);
  assert.equal((html.match(/Core Zone ₹/g)||[]).length,5);
  assert.ok(html.includes('UNVALIDATED SHADOW'));
  assert.ok(html.includes('STOCK_CORE_ZONE_CHALLENGER_V0_1'));
});

test('Build 3.0 stock path fails closed when a visible Core Zone escapes the outer zone',()=>{
  const current=structuredClone(report);
  current.build3_precision={
    version:'MDOS_BUILD_3_CORE_ZONE_OUTPUT_V1',engine:'EDGE_STOCKS',instrument:'LTF',source_id:'life-1',
    horizon_count:5,shadow_only:true,production_methodology_changed:false,
    rows:EXPECTED.map((horizon,i)=>({horizon,target_session:sessions[i].trading_date}))
  };
  current.current_stock_outcome.forecast_sessions=current.current_stock_outcome.forecast_sessions.map((row,i)=>({
    ...row,
    core_zone:{low:i===0?250:271+i,high:273+i},
    core_zone_calibration:{version:'STOCK_CORE_ZONE_CHALLENGER_V0_1',state:'UNVALIDATED_SHADOW'}
  }));
  assert.throws(()=>validateSessions(current),/Core Zone must remain inside outer zone/);
});
