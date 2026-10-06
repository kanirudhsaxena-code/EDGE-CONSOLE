import test from 'node:test';
import assert from 'node:assert/strict';
import { build3MaturedThroughDate } from '../src/build-3-outcome-evaluator';

test('Truth evaluator does not mature the current session before the 16:00 IST finalization buffer',()=>{
  assert.equal(build3MaturedThroughDate(new Date('2026-10-06T10:00:00.000Z')),'2026-10-05');
});

test('Truth evaluator may mature the current session only after 16:00 IST',()=>{
  assert.equal(build3MaturedThroughDate(new Date('2026-10-06T11:00:00.000Z')),'2026-10-06');
});
