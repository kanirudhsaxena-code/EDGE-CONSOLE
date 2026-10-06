import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILD3_TRUTH_CRON } from '../src/build-3-outcome-scheduler';

test('Build 3 Truth has a dedicated post-close scheduler with a retry',()=>{
  assert.equal(BUILD3_TRUTH_CRON,'7,37 11 * * 1-5');
  const config=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
  assert.match(config,/"7,37 11 \* \* 1-5"/);
});

test('production entry routes the Truth cron before unrelated scheduled work',()=>{
  const source=readFileSync(new URL('../src/production-entry.ts',import.meta.url),'utf8');
  assert.match(source,/cron===BUILD3_TRUTH_CRON/);
  assert.match(source,/runBuild3TruthScheduledTick\(env,controller\.scheduledTime\)/);
  assert.match(source,/trading_enabled:false/);
  const scheduler=readFileSync(new URL('../src/build-3-outcome-scheduler.ts',import.meta.url),'utf8');
  assert.match(scheduler,/readBuild3TruthMetrics\(env\.DATABASE_URL\)/);
  assert.match(scheduler,/truth_metrics:truthMetrics/);
});
