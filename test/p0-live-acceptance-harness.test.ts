import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('P0 live acceptance harness covers current and canonical-performance reads for both engines', () => {
  const script = readFileSync('scripts/p0-live-acceptance.mjs', 'utf8');
  assert.match(script, /P0_BASE_URL/);
  assert.match(script, /\/api\/5dr\/current/);
  assert.match(script, /\/api\/edge-stocks\/current\?ticker=/);
  assert.match(script, /\/api\/5dr\/canonical-performance/);
  assert.match(script, /\/api\/edge-stocks\/canonical-performance\?ticker=/);
  assert.match(script, /P0 live acceptance passed/);
  assert.match(script, /process\.exit\(1\)/);
});
