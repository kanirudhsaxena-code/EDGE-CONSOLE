import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
    const result = assessClosingDataTestEnvelope(base);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('fails closed on future evidence', () => {
    const result = assessClosingDataTestEnvelope({
      ...base,
      evidence_provenance: [{ source: 'NSE_COMPLETED_SESSION', observed_at: '2026-09-29T15:31:00+05:30' }],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('evidence_provenance[0] is after evidence_as_of'));
  });

  it('rejects live/preopen relabelling and efficacy/Learning contamination', () => {
    const result = assessClosingDataTestEnvelope({
      ...base,
      session_type: 'LIVE',
      official_efficacy_eligible: true,
      learning_eligible: true,
      canonical_production_eligible: true,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('CLOSING_DATA_TEST must not be labelled LIVE or ORDINARY_PREOPEN'));
    assert.ok(result.errors.includes('official_efficacy_eligible must be false'));
    assert.ok(result.errors.includes('learning_eligible must be false'));
    assert.ok(result.errors.includes('canonical_production_eligible must be false'));
  });
});
