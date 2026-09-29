import { assessClosingDataTestEnvelope } from './closing-data-test';
import { isObject } from './normalization';

export type ClosingDataTestRequestBinding = {
  ok: boolean;
  status: number;
  body?: Record<string, unknown>;
  errors?: string[];
};

/**
 * Bind the governed CLOSING_DATA_TEST envelope to the existing NIFTY automated-run
 * request without changing methodology inputs. This is deliberately fail-closed:
 * the caller must persist these fields with the request/result and must not promote
 * this population into canonical production efficacy or Learning.
 */
export function bindClosingDataTestToNiftyRequest(input: unknown): ClosingDataTestRequestBinding {
  const assessment = assessClosingDataTestEnvelope(input);
  if (!assessment.valid || !isObject(input)) {
    return { ok: false, status: 422, errors: assessment.errors };
  }

  return {
    ok: true,
    status: 200,
    body: {
      sandbox: false,
      acceptance_population: 'CLOSING_DATA_TEST',
      session_type: 'CLOSING_DATA_TEST',
      evidence_as_of: input.evidence_as_of,
      evidence_provenance: input.evidence_provenance,
      official_efficacy_eligible: false,
      learning_eligible: false,
      canonical_production_eligible: false,
      assessment: isObject(input.assessment) ? input.assessment : {
        objective: 'BOTH',
        risk_posture: 'CONSERVATIVE',
        capital_priority: 'CAPITAL_PROTECTION',
      },
    },
  };
}
