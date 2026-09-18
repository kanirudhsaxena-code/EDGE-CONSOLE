import test from 'node:test';
import assert from 'node:assert/strict';
import { assessUserEvidenceReadiness, REQUIRED_USER_5DR_EVIDENCE_CATEGORIES } from '../src/evidence-readiness';

test('both routine screenshot evidence families are ready', () => {
  const result = assessUserEvidenceReadiness([...REQUIRED_USER_5DR_EVIDENCE_CATEGORIES]);
  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.invalid, []);
});

test('missing derivatives/OI screenshot evidence is blocked', () => {
  const result = assessUserEvidenceReadiness(['PRICE_TECHNICALS']);
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ['DERIVATIVES_OI']);
});

test('system-owned evidence cannot be declared as user screenshot evidence', () => {
  const result = assessUserEvidenceReadiness(['PRICE_TECHNICALS', 'DERIVATIVES_OI', 'MARKET_TRUST']);
  assert.equal(result.ready, false);
  assert.deepEqual(result.invalid, ['MARKET_TRUST']);
});

test('duplicate declarations are normalized without weakening the gate', () => {
  const result = assessUserEvidenceReadiness(['PRICE_TECHNICALS', 'PRICE_TECHNICALS']);
  assert.deepEqual(result.declared, ['PRICE_TECHNICALS']);
  assert.equal(result.ready, false);
});

test('non-array declaration is blocked', () => {
  const result = assessUserEvidenceReadiness('PRICE_TECHNICALS');
  assert.equal(result.ready, false);
  assert.equal(result.missing.length, REQUIRED_USER_5DR_EVIDENCE_CATEGORIES.length);
});
