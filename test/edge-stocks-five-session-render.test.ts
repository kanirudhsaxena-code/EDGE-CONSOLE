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
