import { describe, expect, it } from 'vitest';
import { assessClosingDataTestEnvelope } from '../src/closing-data-test';

const base = {
  acceptance_population: 'CLOSING_DATA_TEST',
  evidence_as_of: '2026-09-29T15:30:00+05:30',
  evidence_provenance: [{ source: 'NSE_COMPLETED_SESSION', observed_at: '2026-09-29T15:30:00+05:30' }],
  session_type: 'CLOSING_DATA_TEST',
  official_efficacy_eligible: false,
  learning_eligible: false,
  canonical_production_eligible: false,
};

describe('CLOSING_DATA_TEST governance boundary', () => {
  it('accepts a quarantined completed-session envelope', () => {
    expect(assessClosingDataTestEnvelope(base)).toMatchObject({ valid: true, errors: [] });
  });

  it('fails closed on future evidence', () => {
    const result = assessClosingDataTestEnvelope({
      ...base,
      evidence_provenance: [{ source: 'NSE_COMPLETED_SESSION', observed_at: '2026-09-29T15:31:00+05:30' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('evidence_provenance[0] is after evidence_as_of');
  });

  it('rejects live/preopen relabelling and efficacy/Learning contamination', () => {
    const result = assessClosingDataTestEnvelope({
      ...base,
      session_type: 'LIVE',
      official_efficacy_eligible: true,
      learning_eligible: true,
      canonical_production_eligible: true,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('CLOSING_DATA_TEST must not be labelled LIVE or ORDINARY_PREOPEN');
    expect(result.errors).toContain('official_efficacy_eligible must be false');
    expect(result.errors).toContain('learning_eligible must be false');
    expect(result.errors).toContain('canonical_production_eligible must be false');
  });
});
