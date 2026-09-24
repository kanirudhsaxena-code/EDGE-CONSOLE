import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Phase 2.0 Fresh Plan — P0 operational recovery guard.
 *
 * This test intentionally locks the existing read-path separation while P0 repairs
 * user-facing retrieval:
 * - current stock output follows the latest ticker run;
 * - official efficacy/active calls remain canonical-only governed views;
 * - 5DR assessment state remains persisted/read from assessment_rollups.
 *
 * It does not change scoring, canonical selection, methodology, or trading logic.
 */
test('P0 keeps current-run retrieval distinct from governed canonical efficacy', () => {
  const router = readFileSync('src/router.ts', 'utf8');

  assert.match(router, /v_edge_master_report/);
  assert.match(router, /v_edge_stock_report where ticker = \$\{symbol\}/);
  assert.match(router, /order by r\.run_timestamp desc/);
  assert.match(router, /v_edge_active_calls/);

  assert.match(router, /assessment_rollups where engine='5DR'/);
  assert.match(router, /analysis_runs where engine='5DR' and published=true and status='SUCCESS'/);
});
