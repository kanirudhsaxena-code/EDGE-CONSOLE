import { createHash } from 'node:crypto';
import { enforceClosingDataTemporalIntegrity } from './closing-data-temporal-integrity';
import { isObject } from './normalization';

export type ClosingDataEngine = 'EDGE_NIFTY' | 'EDGE_STOCKS';

export type GovernedClosingEvidenceEnvelope = {
  schema_version: 'CLOSING_DATA_EVIDENCE_V1';
  engine: ClosingDataEngine;
  instrument: string;
  acceptance_population: 'CLOSING_DATA_TEST';
  session_type: 'CLOSING_DATA_TEST';
  evidence_as_of: string;
  evidence: unknown;
  evidence_provenance: unknown[];
  quarantine: {
    official_efficacy_eligible: false;
    learning_eligible: false;
    canonical_production_eligible: false;
  };
  evidence_hash: string;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function closingEvidenceHash(value: Omit<GovernedClosingEvidenceEnvelope, 'evidence_hash'>): string {
  return `sha256:${createHash('sha256').update(stable(value)).digest('hex')}`;
}

/**
 * Build the immutable evidence object consumed by a governed closing-data run.
 * Retrieval/audit timestamps may be later than evidence_as_of, but every
 * market/event observation inside evidence must be <= evidence_as_of.
 * Test populations are always quarantined from production efficacy/Learning/
 * canonical selection at this boundary; callers cannot opt out silently.
 */
export function buildGovernedClosingEvidenceEnvelope(input: {
  engine: ClosingDataEngine;
  instrument: string;
  evidence_as_of: string;
  evidence: unknown;
  evidence_provenance: unknown[];
}): GovernedClosingEvidenceEnvelope {
  if (!input.instrument.trim()) throw new Error('CLOSING_DATA_TEST_INSTRUMENT_REQUIRED');
  if (!Array.isArray(input.evidence_provenance) || input.evidence_provenance.length === 0) {
    throw new Error('CLOSING_DATA_TEST_PROVENANCE_REQUIRED');
  }

  const metadata = {
    acceptance_population: 'CLOSING_DATA_TEST',
    session_type: 'CLOSING_DATA_TEST',
    evidence_as_of: input.evidence_as_of,
  } as const;
  const temporal = enforceClosingDataTemporalIntegrity(metadata, input.evidence);
  if (!temporal.ok) {
    throw new Error(`${temporal.error}:${temporal.offending_paths.join(',')}`);
  }

  const unsigned: Omit<GovernedClosingEvidenceEnvelope, 'evidence_hash'> = {
    schema_version: 'CLOSING_DATA_EVIDENCE_V1',
    engine: input.engine,
    instrument: input.instrument.trim().toUpperCase(),
    acceptance_population: 'CLOSING_DATA_TEST',
    session_type: 'CLOSING_DATA_TEST',
    evidence_as_of: temporal.evidence_as_of,
    evidence: input.evidence,
    evidence_provenance: input.evidence_provenance,
    quarantine: {
      official_efficacy_eligible: false,
      learning_eligible: false,
      canonical_production_eligible: false,
    },
  };
  return { ...unsigned, evidence_hash: closingEvidenceHash(unsigned) };
}

export function verifyGovernedClosingEvidenceEnvelope(value: unknown): value is GovernedClosingEvidenceEnvelope {
  if (!isObject(value)) return false;
  if (value.schema_version !== 'CLOSING_DATA_EVIDENCE_V1') return false;
  if (value.engine !== 'EDGE_NIFTY' && value.engine !== 'EDGE_STOCKS') return false;
  if (value.acceptance_population !== 'CLOSING_DATA_TEST' || value.session_type !== 'CLOSING_DATA_TEST') return false;
  if (typeof value.instrument !== 'string' || !value.instrument.trim()) return false;
  if (typeof value.evidence_as_of !== 'string' || !value.evidence_as_of.trim()) return false;
  if (!Array.isArray(value.evidence_provenance) || value.evidence_provenance.length === 0) return false;
  if (!isObject(value.quarantine)) return false;
  if (value.quarantine.official_efficacy_eligible !== false || value.quarantine.learning_eligible !== false || value.quarantine.canonical_production_eligible !== false) return false;
  if (typeof value.evidence_hash !== 'string') return false;

  const temporal = enforceClosingDataTemporalIntegrity(value, value.evidence);
  if (!temporal.ok) return false;
  const { evidence_hash, ...unsigned } = value as GovernedClosingEvidenceEnvelope;
  return evidence_hash === closingEvidenceHash(unsigned);
}
