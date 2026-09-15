import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAutonomousEvidence, initialAutonomousEvidenceState } from '../src/autonomous-evidence';

test('initial autonomous evidence state is blocked', () => {
  const result = assessAutonomousEvidence(initialAutonomousEvidenceState());
  assert.equal(result.complete, false);
  assert.equal(result.next_stage, 'AUTONOMOUS_EVIDENCE_BLOCKED');
  assert.equal(result.unverifiable.length, 3);
});

test('verified autonomous evidence requires source provenance', () => {
  const items = initialAutonomousEvidenceState().map(item => ({ ...item, status: 'VERIFIED' as const }));
  const result = assessAutonomousEvidence(items);
  assert.equal(result.complete, false);
  assert.equal(result.unverifiable.length, 3);
});

test('all system-owned evidence with provenance becomes ready', () => {
  const now = new Date().toISOString();
  const items = initialAutonomousEvidenceState().map(item => ({
    ...item,
    status: 'VERIFIED' as const,
    source_refs: [`source://${item.category.toLowerCase()}`],
    retrieved_at: now
  }));
  const result = assessAutonomousEvidence(items);
  assert.equal(result.complete, true);
  assert.equal(result.degraded, false);
  assert.equal(result.next_stage, 'AUTONOMOUS_EVIDENCE_READY');
});

test('explicit degraded evidence is allowed but surfaced', () => {
  const now = new Date().toISOString();
  const items = initialAutonomousEvidenceState().map((item, index) => ({
    ...item,
    status: index === 0 ? 'DEGRADED' as const : 'VERIFIED' as const,
    source_refs: [`source://${item.category.toLowerCase()}`],
    retrieved_at: now
  }));
  const result = assessAutonomousEvidence(items);
  assert.equal(result.complete, true);
  assert.equal(result.degraded, true);
  assert.equal(result.next_stage, 'AUTONOMOUS_EVIDENCE_READY');
});
