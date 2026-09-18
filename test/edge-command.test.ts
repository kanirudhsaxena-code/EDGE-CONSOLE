import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchEdgeWorkflow, normalizeTickerCandidate, parseEdgeCommand } from '../src/edge-command';

test('parses canonical EDGE command case-insensitively', () => {
  assert.deepEqual(parseEdgeCommand('  edge LTF  '), { raw: 'edge LTF', target: 'LTF' });
  assert.deepEqual(parseEdgeCommand('EDGE Jio Financial Services'), { raw: 'EDGE Jio Financial Services', target: 'Jio Financial Services' });
});

test('rejects non-EDGE or empty commands', () => {
  assert.equal(parseEdgeCommand('LTF'), null);
  assert.equal(parseEdgeCommand('EDGE   '), null);
  assert.equal(parseEdgeCommand(null), null);
});

test('normalizes ticker candidates without guessing company names', () => {
  assert.equal(normalizeTickerCandidate('ltf'), 'LTF');
  assert.equal(normalizeTickerCandidate('M&MFIN'), 'M&MFIN');
  assert.equal(normalizeTickerCandidate('Jio Financial Services'), null);
});

test('dispatch fails closed without runtime credential', async () => {
  const result = await dispatchEdgeWorkflow('', 'LTF');
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test('dispatch uses existing governed autonomous workflow and no trading endpoint', async () => {
  const original = globalThis.fetch;
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(null, { status: 204 });
  };
  try {
    const result = await dispatchEdgeWorkflow('secret-token', 'LTF');
    assert.equal(result.ok, true);
    assert.match(capturedUrl, /EDGE---V1\/actions\/workflows\/autonomous-publish\.yml\/dispatches$/);
    const body = JSON.parse(String(capturedInit?.body));
    assert.equal(body.ref, 'main');
    assert.equal(body.inputs.ticker, 'LTF');
    assert.equal(body.inputs.holding_state, 'UNKNOWN');
    assert.equal(capturedInit?.method, 'POST');
  } finally {
    globalThis.fetch = original;
  }
});
