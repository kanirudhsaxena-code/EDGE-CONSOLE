import { describe, expect, it } from 'vitest';
import { canAdvanceIntelligenceHandoff, validateIntelligenceHandoff } from '../src/intelligence-contract';

const normalized = {
  regime: 'TREND', component_scores: {}, market_trust_inputs: {}, event_shock: 0,
  execution_inputs: {}, data_adequate: true, event_kill_switch: false,
  expected_rr: 2, horizon_slots: { 'D+1': {}, 'D+2': {}, 'D+3': {}, 'D+4': {}, 'D+5': {} },
};

const observations = [
  ['PRICE_TECHNICALS', 'SCREENSHOT'], ['DERIVATIVES_OI', 'SCREENSHOT'],
  ['MARKET_TRUST', 'WEB_RESEARCH'], ['EVENT_SHOCK', 'WEB_RESEARCH'], ['EXECUTION_RISK', 'WEB_RESEARCH'],
].map(([category, source_kind]) => ({
  category, source_kind, source_ref: `test://${category}`, observed_at: '2026-09-15T10:00:00Z',
  retrieved_at: '2026-09-15T10:01:00Z', verification: 'VERIFIED',
}));

const packet = () => ({ producer: 'test-intelligence', producer_version: '1', request_id: '5drreq_test', observations, normalized });

describe('Mobile V1 intelligence handoff', () => {
  it('accepts a complete provenance-bearing nine-input packet', () => {
    expect(validateIntelligenceHandoff(packet())).toEqual([]);
    expect(canAdvanceIntelligenceHandoff(packet()).ready).toBe(true);
  });

  it('blocks if a screenshot family is missing', () => {
    const body = packet();
    body.observations = body.observations.filter(item => item.category !== 'DERIVATIVES_OI');
    expect(validateIntelligenceHandoff(body)).toContain('missing intelligence observation category DERIVATIVES_OI');
  });

  it('blocks if any of the nine normalized inputs is absent', () => {
    const body: any = packet();
    delete body.normalized.expected_rr;
    expect(validateIntelligenceHandoff(body)).toContain('missing normalized input expected_rr');
  });

  it('blocks unavailable required intelligence', () => {
    const body = packet();
    body.observations[2] = { ...body.observations[2], verification: 'UNAVAILABLE' };
    expect(canAdvanceIntelligenceHandoff(body).ready).toBe(false);
  });

  it('allows degraded state to be explicitly surfaced rather than fabricated as verified', () => {
    const body = packet();
    body.observations[2] = { ...body.observations[2], verification: 'DEGRADED' };
    expect(canAdvanceIntelligenceHandoff(body)).toMatchObject({ ready: true, degraded: true });
  });
});
