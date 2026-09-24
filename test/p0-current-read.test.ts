import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('P0 production entry intercepts deterministic current reads before legacy routing', () => {
  const entry = readFileSync('src/production-entry.ts', 'utf8');
  assert.match(entry, /handleP0CurrentRead/);
  assert.match(entry, /const p0Current = await handleP0CurrentRead\(request, env\)/);
  assert.match(entry, /if \(p0Current\) return p0Current/);
});

test('P0 current read layer keeps latest runs separate from governed canonical efficacy', () => {
  const source = readFileSync('src/p0-current-read.ts', 'utf8');

  assert.match(source, /\/api\/5dr\/latest/);
  assert.match(source, /\/api\/5dr\/current/);
  assert.match(source, /\/api\/edge-stocks\/current/);

  assert.match(source, /ar\.engine='5DR'/);
  assert.match(source, /ar\.published=true/);
  assert.match(source, /ar\.status='SUCCESS'/);
  assert.match(source, /order by ar\.generated_at desc,ar\.run_id desc/);

  assert.match(source, /where r\.ticker=\$\{ticker\}/);
  assert.match(source, /order by r\.run_timestamp desc,r\.recommendation_id desc/);
  assert.match(source, /from edge_canonical_selections/);
  assert.match(source, /current_run_is_selected/);

  assert.match(source, /efficacy_population_changed: false/);
  assert.doesNotMatch(source, /update\s+edge_canonical_selections/i);
  assert.doesNotMatch(source, /insert\s+into\s+edge_canonical_selections/i);
});

test('P0 current read layer preserves tester sandbox isolation', () => {
  const source = readFileSync('src/p0-current-read.ts', 'utf8');
  assert.match(source, /isAccessIdentityEnforced/);
  assert.match(source, /actor\.role !== 'OWNER'/);
  assert.match(source, /if \(url\.pathname === '\/api\/5dr\/latest'\) return null/);
  assert.match(source, /tester runs remain sandbox-scoped/);
});
