import { isObject } from './normalization';

export const CLOSING_DATA_TEST = 'CLOSING_DATA_TEST' as const;

export type ClosingDataTestAssessment = {
  valid: boolean;
  errors: string[];
  evidenceAsOf: string | null;
};

const validIso = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Date.parse(value));

/**
 * Fail-closed guard for the governed non-live acceptance population.
 * This validates identity/time/provenance only; it never changes methodology,
 * scoring, recommendation, canonical selection or efficacy rules.
 */
export function assessClosingDataTestEnvelope(body: unknown): ClosingDataTestAssessment {
  const errors: string[] = [];
  if (!isObject(body)) return { valid: false, errors: ['envelope must be an object'], evidenceAsOf: null };

  if (body.acceptance_population !== CLOSING_DATA_TEST) {
    errors.push('acceptance_population must be CLOSING_DATA_TEST');
  }
  if (!validIso(body.evidence_as_of)) errors.push('evidence_as_of must be a valid immutable timestamp');

  const provenance = body.evidence_provenance;
  if (!Array.isArray(provenance) || provenance.length === 0) {
    errors.push('evidence_provenance must contain at least one attributable completed-session source');
  } else {
    for (const [index, item] of provenance.entries()) {
      if (!isObject(item)) { errors.push(`evidence_provenance[${index}] must be an object`); continue; }
      if (typeof item.source !== 'string' || !item.source.trim()) errors.push(`evidence_provenance[${index}].source is mandatory`);
      if (!validIso(item.observed_at)) errors.push(`evidence_provenance[${index}].observed_at must be a valid timestamp`);
      if (validIso(body.evidence_as_of) && validIso(item.observed_at) && Date.parse(item.observed_at) > Date.parse(body.evidence_as_of)) {
        errors.push(`evidence_provenance[${index}] is after evidence_as_of`);
      }
    }
  }

  if (body.live === true || body.session_type === 'LIVE' || body.session_type === 'ORDINARY_PREOPEN') {
    errors.push('CLOSING_DATA_TEST must not be labelled LIVE or ORDINARY_PREOPEN');
  }
  if (body.official_efficacy_eligible !== false) errors.push('official_efficacy_eligible must be false');
  if (body.learning_eligible !== false) errors.push('learning_eligible must be false');
  if (body.canonical_production_eligible !== false) errors.push('canonical_production_eligible must be false');

  return {
    valid: errors.length === 0,
    errors,
    evidenceAsOf: validIso(body.evidence_as_of) ? body.evidence_as_of : null,
  };
}
