import test from 'node:test';
import assert from 'node:assert/strict';
import { assessEvidenceReadiness, REQUIRED_5DR_EVIDENCE_CATEGORIES } from '../src/evidence-readiness';

test('complete declared category coverage is ready', () => {
  const result = assessEvidenceReadiness([...REQUIRED_5DR_EVIDENCE_CATEGORIES]);
  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.invalid, []);
});

test('incomplete category coverage is blocked with explicit missing categories', () => {
  const result = assessEvidenceReadiness(['PRICE_TECHNICALS']);
  assert.equal(result.ready, false);
  assert.ok(result.missing.includes('DERIVATIVES_OI'));
  assert.ok(result.missing.includes('MARKET_TRUST'));
});

test('unknown categories are rejected', () => {
  const result = assessEvidenceReadiness([...REQUIRED_5DR_EVIDENCE_CATEGORIES, 'UNVERIFIED_MAGIC']);
  assert.equal(result.ready, false);
  assert.deepEqual(result.invalid, ['UNVERIFIED_MAGIC']);
});

test('duplicate declarations are normalized without weakening the gate', () => {
  const result = assessEvidenceReadiness(['PRICE_TECHNICALS', 'PRICE_TECHNICALS']);
  assert.deepEqual(result.declared, ['PRICE_TECHNICALS']);
  assert.equal(result.ready, false);
});

test('non-array declaration is blocked', () => {
  const result = assessEvidenceReadiness('PRICE_TECHNICALS');
  assert.equal(result.ready, false);
  assert.equal(result.missing.length, REQUIRED_5DR_EVIDENCE_CATEGORIES.length);
});
