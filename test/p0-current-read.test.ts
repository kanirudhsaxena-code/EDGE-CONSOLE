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

test('G5-D current read model exposes exact immutable D through D+4 persistence without efficacy mutation', () => {
  const source = readFileSync('src/p0-current-read.ts', 'utf8');
  assert.match(source, /from edge_stock_forecast_paths/);
  assert.match(source, /from edge_stock_forecast_path_rows/);
  assert.match(source, /order by horizon_index asc/);
  assert.match(source, /rows\.length !== 5/);
  assert.match(source, /EDGE_FORECAST_LABELS\[index\]/);
  assert.match(source, /Persisted EDGE forecast path is incomplete or misordered/);
  assert.match(source, /IMMUTABLE_D_THROUGH_D_PLUS_4_BY_RECOMMENDATION_ID/);
  assert.match(source, /payload_hash/);
  assert.match(source, /exact_row_count: forecastPath \? 5 : 0/);
  assert.match(source, /fail_closed_on_incomplete_or_misordered: true/);
  assert.doesNotMatch(source, /update\s+edge_stock_forecast_paths/i);
  assert.doesNotMatch(source, /insert\s+into\s+edge_stock_forecast_paths/i);
  assert.doesNotMatch(source, /update\s+edge_stock_forecast_path_rows/i);
  assert.doesNotMatch(source, /insert\s+into\s+edge_stock_forecast_path_rows/i);
});

test('P0 current read layer preserves tester sandbox isolation', () => {
  const source = readFileSync('src/p0-current-read.ts', 'utf8');
  assert.match(source, /isAccessIdentityEnforced/);
  assert.match(source, /actor\.role !== 'OWNER'/);
  assert.match(source, /if \(url\.pathname === '\/api\/5dr\/latest'\) return null/);
  assert.match(source, /tester runs remain sandbox-scoped/);
});
