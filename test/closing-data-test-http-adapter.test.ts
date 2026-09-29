import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.metadata.actor, { id: 'owner' });
    assert.equal(result.metadata.adapter_stage, 'EVIDENCE_READY');
    assert.equal(result.metadata.acceptance_population, 'CLOSING_DATA_TEST');
    assert.equal(result.metadata.session_type, 'CLOSING_DATA_TEST');
    assert.equal(result.metadata.evidence_as_of, governed.evidence_as_of);
    assert.equal(result.metadata.official_efficacy_eligible, false);
    assert.equal(result.metadata.learning_eligible, false);
    assert.equal(result.metadata.canonical_production_eligible, false);
    assert.deepEqual(result.metadata.closing_data_test, {
      population: 'CLOSING_DATA_TEST',
      evidence_as_of: governed.evidence_as_of,
      evidence_provenance: governed.evidence_provenance,
      official_efficacy_eligible: false,
      learning_eligible: false,
      canonical_production_eligible: false,
    });
  });

  it('fails closed when provenance is after the governed as-of time', () => {
    const result = persistClosingDataTestRequestMetadata({
      ...governed,
      evidence_provenance: [
        { source: 'NSE_COMPLETED_SESSION', observed_at: '2026-09-29T15:31:00+05:30' },
      ],
    }, {});
    assert.deepEqual(result, {
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
    assert.equal(result.ok, false);
  });
});
