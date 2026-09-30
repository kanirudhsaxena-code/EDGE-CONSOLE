import { bindClosingDataTestToNiftyRequest, closingDataTestPersistenceMetadata } from './closing-data-test-request';
import { enforceClosingDataTemporalIntegrity } from './closing-data-temporal-integrity';
import { isObject } from './normalization';

export type ClosingDataHttpPersistence = {
  ok: true;
  metadata: Record<string, unknown>;
} | {
  ok: false;
  status: 422;
  error: string;
};

export type PreparedClosingDataNiftyRequest = {
  ok: true;
  status: 200;
  body: Record<string, unknown>;
  metadata: Record<string, unknown>;
} | {
  ok: false;
  status: 422;
  error: string;
};

/**
 * HTTP/persistence boundary for governed NIFTY CLOSING_DATA_TEST requests.
 */
export function persistClosingDataTestRequestMetadata(
  requestBody: unknown,
  existingMetadata: unknown,
): ClosingDataHttpPersistence {
  const governed = closingDataTestPersistenceMetadata(requestBody);
  if (!governed) {
    return { ok: false, status: 422, error: 'Invalid CLOSING_DATA_TEST persistence envelope' };
  }

  const base = isObject(existingMetadata) ? existingMetadata : {};
  return {
    ok: true,
    metadata: {
      ...base,
      ...governed,
      closing_data_test: {
        population: governed.acceptance_population,
        evidence_as_of: governed.evidence_as_of,
        evidence_provenance: governed.evidence_provenance,
        official_efficacy_eligible: false,
        learning_eligible: false,
        canonical_production_eligible: false,
      },
    },
  };
}

/**
 * Atomic NIFTY preparation boundary. For CLOSING_DATA_TEST the evidence itself
 * must pass the as-of firewall before methodology dispatch or persistence.
 */
export function prepareClosingDataTestNiftyRequest(
  requestBody: unknown,
  existingMetadata: unknown,
  evidence?: unknown,
): PreparedClosingDataNiftyRequest {
  const bound = bindClosingDataTestToNiftyRequest(requestBody);
  if (!bound.ok || !bound.body) {
    return { ok: false, status: 422, error: 'Invalid CLOSING_DATA_TEST NIFTY request envelope' };
  }

  if (evidence === undefined) {
    return { ok: false, status: 422, error: 'CLOSING_DATA_TEST_EVIDENCE_REQUIRED' };
  }
  const temporal = enforceClosingDataTemporalIntegrity(requestBody, evidence);
  if (!temporal.ok) {
    return {
      ok: false,
      status: 422,
      error: `${temporal.error}:${temporal.offending_paths.join(',')}`,
    };
  }

  const persisted = persistClosingDataTestRequestMetadata(requestBody, existingMetadata);
  if (!persisted.ok) return persisted;

  return {
    ok: true,
    status: 200,
    body: bound.body,
    metadata: {
      ...persisted.metadata,
      temporal_integrity: {
        status: 'PASSED',
        evidence_as_of: temporal.evidence_as_of,
      },
    },
  };
}
