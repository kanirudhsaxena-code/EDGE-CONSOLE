import { describe, expect, it } from 'vitest';
import { persistClosingDataTestRequestMetadata } from '../src/closing-data-test-http-adapter';

const governed = {
  acceptance_population: 'CLOSING_DATA_TEST',
  session_type: 'CLOSING_DATA_TEST',
  evidence_as_of: '2026-09-29T15:30:00+05:30',
  evidence_provenance: [
    { source: 'NSE_COMPLETED_SESSION', observed_at: '2026-09-29T15:30:00+05:30' },
  ],
  official_efficacy_eligible: false,
  learning_eligible: false,
  canonical_production_eligible: false,
};

describe('CLOSING_DATA_TEST HTTP persistence adapter', () => {
  it('copies immutable acceptance identity without replacing existing request metadata', () => {
    const result = persistClosingDataTestRequestMetadata(governed, {
      actor: { id: 'owner' },
      adapter_stage: 'EVIDENCE_READY',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metadata).toMatchObject({
      actor: { id: 'owner' },
      adapter_stage: 'EVIDENCE_READY',
      acceptance_population: 'CLOSING_DATA_TEST',
      session_type: 'CLOSING_DATA_TEST',
      evidence_as_of: governed.evidence_as_of,
      official_efficacy_eligible: false,
      learning_eligible: false,
      canonical_production_eligible: false,
      closing_data_test: {
        population: 'CLOSING_DATA_TEST',
        evidence_as_of: governed.evidence_as_of,
        official_efficacy_eligible: false,
        learning_eligible: false,
        canonical_production_eligible: false,
      },
    });
  });

  it('fails closed when provenance is after the governed as-of time', () => {
    const result = persistClosingDataTestRequestMetadata({
      ...governed,
      evidence_provenance: [
        { source: 'NSE_COMPLETED_SESSION', observed_at: '2026-09-29T15:31:00+05:30' },
      ],
    }, {});
    expect(result).toEqual({
      ok: false,
      status: 422,
      error: 'Invalid CLOSING_DATA_TEST persistence envelope',
    });
  });

  it('fails closed on any attempt to make the test population efficacy eligible', () => {
    const result = persistClosingDataTestRequestMetadata({
      ...governed,
      official_efficacy_eligible: true,
    }, {});
    expect(result.ok).toBe(false);
  });
});
