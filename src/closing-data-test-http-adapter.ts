import { closingDataTestPersistenceMetadata } from './closing-data-test-request';
import { isObject } from './normalization';

export type ClosingDataHttpPersistence = {
  ok: true;
  metadata: Record<string, unknown>;
} | {
  ok: false;
  status: 422;
  error: string;
};

/**
 * HTTP/persistence boundary for governed NIFTY CLOSING_DATA_TEST requests.
 *
 * The adapter deliberately does not alter methodology/scoring inputs. It only
 * copies the already-validated immutable acceptance identity into persisted
 * request metadata. A malformed/partial envelope fails closed rather than
 * silently degrading to LIVE, PREOPEN or ordinary production population.
 */
export function persistClosingDataTestRequestMetadata(
  requestBody: unknown,
  existingMetadata: unknown,
): ClosingDataHttpPersistence {
  const governed = closingDataTestPersistenceMetadata(requestBody);
  if (!governed) {
    return {
      ok: false,
      status: 422,
      error: 'Invalid CLOSING_DATA_TEST persistence envelope',
    };
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
