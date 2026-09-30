import { describe,it,expect } from 'vitest';
import { EXPECTED,validateSessions,renderRows } from '../public/edge-stocks-five-session.js';

const sessions=EXPECTED.map((session_label,i)=>({session_label,trading_date:`2026-10-0${i+1}`,direction:i%2?'BASE_RANGE':'MILD_BULL',expected_zone:{low:270+i,high:275+i},confidence:0.6+i/20}));
const report={run_id:'EDGE-LTF-G5',current_stock_outcome:{forecast_horizon:'D:D+4',forecast_sessions:sessions}};

describe('G5 EDGE Stocks canonical five-session renderer',()=>{
  it('accepts only exact ordered D:D+4 read-model sessions',()=>{expect(validateSessions(report)).toEqual(sessions)});
  it('rejects D+5 structurally',()=>{const bad=structuredClone(report);bad.current_stock_outcome.forecast_sessions[4].session_label='D+5';expect(()=>validateSessions(bad)).toThrow(/order mismatch/)});
  it('renders all five canonical rows from the supplied read model without reconstruction',()=>{const html=renderRows(validateSessions(report));expect((html.match(/data-edge-forecast-row=/g)||[]).length).toBe(5);let cursor=-1;for(const label of EXPECTED){const next=html.indexOf(`data-edge-forecast-row="${label}"`);expect(next).toBeGreaterThan(cursor);cursor=next}for(const row of sessions){expect(html).toContain(row.trading_date.slice(8,10));expect(html).toContain(String(row.expected_zone.low));expect(html).toContain(String(row.expected_zone.high))}});
});
