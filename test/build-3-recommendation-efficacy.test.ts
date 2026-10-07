import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBuild3RecommendationEfficacyRecord } from '../src/build-3-recommendation-efficacy';

test('recommendation efficacy record preserves dual-touch without claiming execution order',()=>{
  const row=buildBuild3RecommendationEfficacyRecord({
    engine:'5DR',instrument:'NIFTY',source_id:'rec-1',
    evaluated_at:'2026-10-07T10:00:00.000Z',
    entry_triggered:true,target_hit:true,sl_hit:true,lifecycle_complete:true,
    evidence:{resolution:'daily_or_intraday_touch_facts_only'}
  });
  assert.equal(row.classification,'DUAL_TOUCH');
  assert.equal(row.conservative_result,'LOSS');
  assert.equal(row.liberal_result,'HIT');
  assert.equal(row.primary_target_label,'T1');
  assert.equal(row.finalized_triggered,true);
});

test('pre-entry target/SL observations cannot be represented as triggered efficacy',()=>{
  const row=buildBuild3RecommendationEfficacyRecord({
    engine:'EDGE_STOCKS',instrument:'LTF',source_id:'rec-2',
    evaluated_at:'2026-10-07T10:00:00.000Z',
    entry_triggered:false,target_hit:true,sl_hit:true,lifecycle_complete:true,
  });
  assert.equal(row.classification,'UNTRIGGERED');
  assert.equal(row.target_hit,false);
  assert.equal(row.sl_hit,false);
  assert.equal(row.conservative_result,null);
  assert.equal(row.liberal_result,null);
});
