import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('P0 production entry exposes canonical-performance reads before legacy routing', () => {
  const entry = readFileSync('src/production-entry.ts', 'utf8');
  assert.match(entry, /handleP0PerformanceRead/);
  assert.match(entry, /const p0Performance = await handleP0PerformanceRead\(request, env\)/);
  assert.match(entry, /if \(p0Performance\) return p0Performance/);
});

test('5DR canonical performance reads the latest persisted assessment snapshot', () => {
  const source = readFileSync('src/p0-performance-read.ts', 'utf8');
  assert.match(source, /\/api\/5dr\/canonical-performance/);
  assert.match(source, /from assessment_rollups/);
  assert.match(source, /where engine='5DR'/);
  assert.match(source, /order by created_at desc,id desc/);
  assert.match(source, /exact_persisted_snapshot: true/);
  assert.match(source, /reconstructed_from_latest_run: false/);
});

test('EDGE canonical performance reads governed canonical selections and persisted outcomes', () => {
  const source = readFileSync('src/p0-performance-read.ts', 'utf8');
  assert.match(source, /\/api\/edge-stocks\/canonical-performance/);
  assert.match(source, /from edge_canonical_selections cs/);
  assert.match(source, /left join recommendations r on r\.recommendation_id=cs\.selected_recommendation_id/);
  assert.match(source, /left join recommendation_performance p on p\.recommendation_id=cs\.selected_recommendation_id/);
  assert.match(source, /v_edge_stock_report/);
  assert.match(source, /v_edge_master_report/);
  assert.match(source, /exact_persisted_selection: true/);
  assert.match(source, /efficacy_population_changed: false/);
  assert.doesNotMatch(source, /insert\s+into\s+edge_canonical_selections/i);
  assert.doesNotMatch(source, /update\s+edge_canonical_selections/i);
});
