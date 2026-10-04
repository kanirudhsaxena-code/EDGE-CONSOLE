import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const recovery=readFileSync('src/5dr-acquisition-recovery.ts','utf8');

test('recovered READY market evidence preserves governed NIFTY run provenance',()=>{
  assert.match(recovery,/run_provenance: recoveredProvenance/);
  assert.match(recovery,/trigger_type: sync\.evidence\.trigger_type \?\? null/);
  assert.match(recovery,/evidence_mode: sync\.evidence\.evidence_mode \?\? null/);
  assert.match(recovery,/market_session_as_of: sync\.evidence\.market_session_as_of \?\? null/);
  assert.match(recovery,/research_as_of: sync\.evidence\.research_as_of \?\? null/);
  assert.match(recovery,/target_session: sync\.evidence\.target_session \?\? null/);
  assert.match(recovery,/benchmark_role: sync\.evidence\.benchmark_role \?\? null/);
});

test('recovery still revalidates the immutable GitHub evidence before persistence',()=>{
  assert.match(recovery,/assessAutomatedMarketEvidence\(sync\.evidence, requestId\)/);
  assert.match(recovery,/adapter_stage: 'AUTOMATED_MARKET_DATA_READY'/);
  assert.match(recovery,/recovery_mode: 'CONSOLE_GITHUB_LOG_SYNC'/);
});
