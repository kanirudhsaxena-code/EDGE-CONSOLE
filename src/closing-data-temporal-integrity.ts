import { isObject } from './normalization';

export type ClosingDataTemporalCheck =
  | { ok: true; evidence_as_of: string }
  | { ok: false; error: string; offending_paths: string[] };

/**
 * P0 temporal-integrity gate for CLOSING_DATA_TEST.
 *
 * A closing-data acceptance forecast may be calculated only from facts whose
 * market/event observation time is <= the immutable evidence_as_of. Retrieval
 * may occur later, but a source carrying a later market/event timestamp is
 * rejected. This prevents overnight/GIFT/global or later research state from
 * leaking into a completed-session forecast.
 */
export function enforceClosingDataTemporalIntegrity(
  acceptanceMetadata: unknown,
  evidence: unknown,
): ClosingDataTemporalCheck {
  if (!isObject(acceptanceMetadata) || acceptanceMetadata.acceptance_population !== 'CLOSING_DATA_TEST') {
    return { ok: true, evidence_as_of: '' };
  }
  const rawAsOf = acceptanceMetadata.evidence_as_of;
  if (typeof rawAsOf !== 'string' || !rawAsOf.trim() || Number.isNaN(Date.parse(rawAsOf))) {
    return { ok: false, error: 'CLOSING_DATA_TEST_EVIDENCE_AS_OF_MISSING_OR_INVALID', offending_paths: ['evidence_as_of'] };
  }
  const asOf = Date.parse(rawAsOf);
  const offending: string[] = [];
  const visit = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (!isObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      // retrieved_at/captured_at are provenance/audit times and may legitimately
      // be later than as-of. Only timestamps representing the underlying fact
      // are forecast-time inputs.
      if (['observed_at', 'timestamp', 'trade_date', 'dateTime', 'updated_time'].includes(key) && typeof child === 'string') {
        const parsed = Date.parse(child);
        if (!Number.isNaN(parsed) && parsed > asOf) offending.push(childPath);
      }
      visit(child, childPath);
    }
  };
  visit(evidence, 'evidence');
  if (offending.length) {
    return { ok: false, error: 'CLOSING_DATA_TEST_POST_AS_OF_EVIDENCE', offending_paths: offending };
  }
  return { ok: true, evidence_as_of: new Date(asOf).toISOString() };
}
