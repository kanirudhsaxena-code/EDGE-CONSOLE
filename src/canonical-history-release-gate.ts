type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  });
}

/**
 * Transitional P0-12 release firewall.
 *
 * The engine-local readers may expose exact persisted evidence as audit data,
 * but a selected canonical must not be released as a successful canonical read
 * until the persisted P0-11 presentation snapshot is attached and the shared
 * canonical-read contract has validated that exact identity. This deliberately
 * fails closed while the database-backed presentation adapters are unfinished.
 */
export async function gateCanonicalHistoryResponse(response: Response): Promise<Response> {
  if (response.status >= 400) return response;

  let payload: JsonRecord;
  try {
    const parsed = await response.clone().json();
    const record = asRecord(parsed);
    if (!record) return response;
    payload = record;
  } catch {
    return response;
  }

  const retrieval = asRecord(payload.retrieval);
  if (retrieval?.selected_for_headline_efficacy !== true) return response;

  const presentation = asRecord(payload.presentation);
  const snapshot = asRecord(presentation?.snapshot);
  const contractValidation = retrieval?.canonical_contract_validation;

  if (!snapshot || contractValidation !== 'PASSED') {
    return json({
      ...payload,
      contract_version: 'P0_12_CANONICAL_READ_V1',
      canonical_read_status: 'AUDIT_ONLY_BLOCKED',
      error: 'Selected canonical is audit-visible but cannot be released until its persisted P0-11 presentation snapshot and shared P0-12 identity validation are complete.',
      retrieval: {
        ...retrieval,
        contract: 'P0_12_CANONICAL_READ_V1',
        fail_closed: true,
        release_eligible: false,
        block_reason: !snapshot
          ? 'MISSING_P0_11_PRESENTATION_SNAPSHOT'
          : 'P0_12_SHARED_CONTRACT_VALIDATION_NOT_PASSED',
      },
    }, 409);
  }

  return response;
}
