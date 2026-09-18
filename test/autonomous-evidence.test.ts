import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAutonomousEvidence, initialAutonomousEvidenceState } from '../src/autonomous-evidence';

test('initial system evidence is pending and blocked', () => {
  const result = assessAutonomousEvidence(initialAutonomousEvidenceState());
  assert.equal(result.complete, false);
  assert.equal(result.next_stage, 'AUTONOMOUS_EVIDENCE_BLOCKED');
  assert.deepEqual(result.unverifiable.sort(), ['EVENT_SHOCK', 'EXECUTION_RISK', 'MARKET_TRUST'].sort());
});

test('all verified system evidence with provenance is ready', () => {
  const result = assessAutonomousEvidence([
    { category: 'MARKET_TRUST', status: 'VERIFIED', source_refs: ['src:market'] },
    { category: 'EVENT_SHOCK', status: 'VERIFIED', source_refs: ['src:event'] },
    { category: 'EXECUTION_RISK', status: 'VERIFIED', source_refs: ['src:risk'] }
  ]);
  assert.equal(result.complete, true);
  assert.equal(result.degraded, false);
  assert.equal(result.next_stage, 'AUTONOMOUS_EVIDENCE_READY');
});

test('verified evidence without provenance fails closed', () => {
  const result = assessAutonomousEvidence([
    { category: 'MARKET_TRUST', status: 'VERIFIED', source_refs: [] },
    { category: 'EVENT_SHOCK', status: 'VERIFIED', source_refs: ['src:event'] },
    { category: 'EXECUTION_RISK', status: 'VERIFIED', source_refs: ['src:risk'] }
  ]);
  assert.equal(result.complete, false);
  assert.deepEqual(result.unverifiable, ['MARKET_TRUST']);
});

test('unavailable system evidence blocks the run', () => {
  const result = assessAutonomousEvidence([
    { category: 'MARKET_TRUST', status: 'VERIFIED', source_refs: ['src:market'] },
    { category: 'EVENT_SHOCK', status: 'UNAVAILABLE', source_refs: ['src:event-failure'] },
    { category: 'EXECUTION_RISK', status: 'VERIFIED', source_refs: ['src:risk'] }
  ]);
  assert.equal(result.complete, false);
  assert.deepEqual(result.unverifiable, ['EVENT_SHOCK']);
});
