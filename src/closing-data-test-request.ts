import { assessClosingDataTestEnvelope } from './closing-data-test';
import { isObject } from './normalization';

export type ClosingDataTestRequestBinding = {
  ok: boolean;
  status: number;
  body?: Record<string, unknown>;
  errors?: string[];
};

export type ClosingDataTestPersistenceMetadata = {
  acceptance_population: 'CLOSING_DATA_TEST';
  session_type: 'CLOSING_DATA_TEST';
  evidence_as_of: string;
  evidence_provenance: unknown[];
  official_efficacy_eligible: false;
  learning_eligible: false;
  canonical_production_eligible: false;
};

/** Bind the governed non-live envelope to the existing NIFTY request without
 * changing methodology inputs. The returned quarantine fields are mandatory
 * persistence metadata and therefore survive request -> run/read-model handoff.
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

/** Extract the exact immutable fields that the HTTP/persistence adapter must copy
 * into analysis_requests.metadata and later analysis_runs/result read models.
 * Re-validating here prevents a caller from constructing persistence metadata
 * from a partial/latest/raw object and fails closed on any relabelling attempt.
 */
export function closingDataTestPersistenceMetadata(input: unknown): ClosingDataTestPersistenceMetadata | null {
  const bound = bindClosingDataTestToNiftyRequest(input);
  if (!bound.ok || !bound.body) return null;
  const body = bound.body;
  if (typeof body.evidence_as_of !== 'string' || !Array.isArray(body.evidence_provenance)) return null;
  return {
    acceptance_population: 'CLOSING_DATA_TEST',
    session_type: 'CLOSING_DATA_TEST',
    evidence_as_of: body.evidence_as_of,
    evidence_provenance: body.evidence_provenance,
    official_efficacy_eligible: false,
    learning_eligible: false,
    canonical_production_eligible: false,
  };
}
