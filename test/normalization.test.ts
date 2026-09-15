import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCompleteness, REQUIRED_5DR_INPUTS, validateNormalizedEvidence } from '../src/normalization';

const fullNormalized = Object.fromEntries(REQUIRED_5DR_INPUTS.map((key) => [key, `${key}-value`]));
const item = (normalized: Record<string, unknown>, source_ref = 'evidence://one') => ({ evidence_type: 'STRUCTURED', source_ref, captured_at: '2026-09-15T07:00:00.000Z', normalized });

test('complete evidence is executable', () => {
  const evidence = [item(fullNormalized)];
  assert.deepEqual(validateNormalizedEvidence({ evidence }), []);
  assert.deepEqual(assessCompleteness(evidence), { missing: [], conflicts: [] });
});

test('incomplete evidence reports missing required inputs', () => {
  const evidence = [item({ regime: 'TREND' })];
  const result = assessCompleteness(evidence);
  assert.ok(result.missing.includes('component_scores'));
  assert.equal(result.conflicts.length, 0);
});

test('conflicting evidence reports the conflicting required input', () => {
  const evidence = [item(fullNormalized, 'evidence://one'), item({ regime: 'RANGE' }, 'evidence://two')];
  const result = assessCompleteness(evidence);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.conflicts, ['regime']);
});

test('malformed evidence fails structural validation', () => {
  const errors = validateNormalizedEvidence({ evidence: [{ evidence_type: '', source_ref: '', captured_at: 'not-a-date', normalized: {} }] });
  assert.ok(errors.some((error) => error.includes('evidence_type')));
  assert.ok(errors.some((error) => error.includes('source_ref')));
  assert.ok(errors.some((error) => error.includes('captured_at')));
  assert.ok(errors.some((error) => error.includes('normalized')));
});
