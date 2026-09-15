import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessUserEvidenceReadiness,
  REQUIRED_USER_5DR_EVIDENCE_CATEGORIES,
  SYSTEM_OWNED_5DR_EVIDENCE_CATEGORIES
} from '../src/evidence-readiness';

test('chart plus options/OI screenshot coverage is user-ready', () => {
  const result = assessUserEvidenceReadiness([...REQUIRED_USER_5DR_EVIDENCE_CATEGORIES]);
  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.invalid, []);
});

test('chart alone is blocked and options/OI is explicitly missing', () => {
  const result = assessUserEvidenceReadiness(['PRICE_TECHNICALS']);
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ['DERIVATIVES_OI']);
});

test('system-owned evidence cannot be declared as user evidence', () => {
  for (const category of SYSTEM_OWNED_5DR_EVIDENCE_CATEGORIES) {
    const result = assessUserEvidenceReadiness([...REQUIRED_USER_5DR_EVIDENCE_CATEGORIES, category]);
    assert.equal(result.ready, false);
    assert.ok(result.invalid.includes(category));
  }
});

test('unknown categories are rejected', () => {
  const result = assessUserEvidenceReadiness([...REQUIRED_USER_5DR_EVIDENCE_CATEGORIES, 'UNVERIFIED_MAGIC']);
  assert.equal(result.ready, false);
  assert.deepEqual(result.invalid, ['UNVERIFIED_MAGIC']);
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
