import test from 'node:test';
import assert from 'node:assert/strict';
import { gateCanonicalHistoryResponse } from '../src/canonical-history-release-gate.js';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

test('selected canonical without persisted P0-11 presentation is audit-only and blocked', async () => {
  const response = await gateCanonicalHistoryResponse(jsonResponse({
    engine: '5DR',
    canonical: { selection_status: 'SELECTED' },
    presentation: { status: 'NOT_AVAILABLE', snapshot: null },
    retrieval: { selected_for_headline_efficacy: true, fail_closed: true },
  }));
  assert.equal(response.status, 409);
  const body = await response.json() as any;
  assert.equal(body.contract_version, 'P0_12_CANONICAL_READ_V1');
  assert.equal(body.canonical_read_status, 'AUDIT_ONLY_BLOCKED');
  assert.equal(body.retrieval.release_eligible, false);
  assert.equal(body.retrieval.block_reason, 'MISSING_P0_11_PRESENTATION_SNAPSHOT');
});

test('non-selected audit history remains readable and never enters headline efficacy', async () => {
  const original = jsonResponse({
    engine: 'IPO_EDGE',
    status: 'NON_CANONICAL_CHECKPOINT',
    retrieval: { selected_for_headline_efficacy: false, fail_closed: true },
  });
  const response = await gateCanonicalHistoryResponse(original);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.status, 'NON_CANONICAL_CHECKPOINT');
  assert.equal(body.retrieval.selected_for_headline_efficacy, false);
});

test('existing adapter errors are preserved unchanged', async () => {
  const original = jsonResponse({ error: 'store unavailable' }, 503);
  const response = await gateCanonicalHistoryResponse(original);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'store unavailable' });
});

test('snapshot alone cannot bypass shared P0-12 validation', async () => {
  const response = await gateCanonicalHistoryResponse(jsonResponse({
    engine: 'EDGE_STOCKS',
    presentation: { snapshot: { presentation_contract_version: 'P0_11_PRESENTATION_V1' } },
    retrieval: { selected_for_headline_efficacy: true, fail_closed: true },
  }));
  assert.equal(response.status, 409);
  const body = await response.json() as any;
  assert.equal(body.retrieval.block_reason, 'P0_12_SHARED_CONTRACT_VALIDATION_NOT_PASSED');
});
