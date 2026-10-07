import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILD3_ZONE_PRIMARY_TOLERANCE_PCT,
  scoreBuild3RecommendationEfficacy,
  scoreBuild3ZoneEfficacy,
  summarizeBuild3RecommendationEfficacy,
} from '../src/build-3-efficacy-contract';

test('zone efficacy uses close as the primary hit and width-normalized high/low deviation',()=>{
  const z=scoreBuild3ZoneEfficacy({
    zone_low:23100,zone_high:23300,
    actual_low:23094,actual_high:23307,actual_close:23220,
  });
  assert.equal(z.close_hit,true);
  assert.equal(z.high_breach_points,7);
  assert.equal(z.low_breach_points,6);
  assert.equal(Number(z.high_deviation_pct?.toFixed(4)),3.5);
  assert.equal(Number(z.low_deviation_pct?.toFixed(4)),3);
  assert.equal(Number(z.range_deviation_pct?.toFixed(4)),3.5);
  assert.equal(z.deviation_hit,true);
  assert.equal(z.challenger_deviation_hit,false);
  assert.equal(z.quality_status,'GREEN');
});

test('exactly 5 percent deviation passes and anything greater fails',()=>{
  assert.equal(BUILD3_ZONE_PRIMARY_TOLERANCE_PCT,5);
  const exact=scoreBuild3ZoneEfficacy({
    zone_low:100,zone_high:200,actual_low:95,actual_high:200,actual_close:150,
  });
  assert.equal(exact.range_deviation_pct,5);
  assert.equal(exact.deviation_hit,true);
  assert.equal(exact.quality_status,'GREEN');

  const over=scoreBuild3ZoneEfficacy({
    zone_low:100,zone_high:200,actual_low:94.999,actual_high:200,actual_close:150,
  });
  assert.equal(over.deviation_hit,false);
  assert.equal(over.quality_status,'AMBER');
});

test('traffic light matrix is deterministic',()=>{
  const green=scoreBuild3ZoneEfficacy({zone_low:100,zone_high:200,actual_low:100,actual_high:200,actual_close:150});
  const amberClose=scoreBuild3ZoneEfficacy({zone_low:100,zone_high:200,actual_low:90,actual_high:200,actual_close:150});
  const amberDeviation=scoreBuild3ZoneEfficacy({zone_low:100,zone_high:200,actual_low:100,actual_high:200,actual_close:201});
  const red=scoreBuild3ZoneEfficacy({zone_low:100,zone_high:200,actual_low:80,actual_high:220,actual_close:220});
  assert.deepEqual(
    [green.quality_status,amberClose.quality_status,amberDeviation.quality_status,red.quality_status],
    ['GREEN','AMBER','AMBER','RED'],
  );
});

test('zero-width zones are not efficacy-scorable',()=>{
  const z=scoreBuild3ZoneEfficacy({zone_low:100,zone_high:100,actual_low:99,actual_high:101,actual_close:100});
  assert.equal(z.scorability_state,'NOT_SCORABLE');
  assert.equal(z.close_hit,null);
  assert.equal(z.quality_status,'NOT_SCORABLE');
});

test('recommendation dual-touch has conservative loss and liberal hit without sequencing',()=>{
  const targetOnly=scoreBuild3RecommendationEfficacy({entry_triggered:true,target_hit:true,sl_hit:false,lifecycle_complete:true});
  const slOnly=scoreBuild3RecommendationEfficacy({entry_triggered:true,target_hit:false,sl_hit:true,lifecycle_complete:true});
  const dual=scoreBuild3RecommendationEfficacy({entry_triggered:true,target_hit:true,sl_hit:true,lifecycle_complete:true});
  const timeout=scoreBuild3RecommendationEfficacy({entry_triggered:true,target_hit:false,sl_hit:false,lifecycle_complete:true});
  assert.deepEqual([targetOnly.conservative_result,targetOnly.liberal_result],['HIT','HIT']);
  assert.deepEqual([slOnly.conservative_result,slOnly.liberal_result],['LOSS','LOSS']);
  assert.deepEqual([dual.conservative_result,dual.liberal_result],['LOSS','HIT']);
  assert.deepEqual([timeout.conservative_result,timeout.liberal_result],['MISS','MISS']);
});

test('liberal minus conservative hit rate equals dual-touch rate on the same denominator',()=>{
  const rows=[
    scoreBuild3RecommendationEfficacy({entry_triggered:true,target_hit:true,sl_hit:false,lifecycle_complete:true}),
    scoreBuild3RecommendationEfficacy({entry_triggered:true,target_hit:true,sl_hit:true,lifecycle_complete:true}),
    scoreBuild3RecommendationEfficacy({entry_triggered:true,target_hit:false,sl_hit:true,lifecycle_complete:true}),
    scoreBuild3RecommendationEfficacy({entry_triggered:true,target_hit:false,sl_hit:false,lifecycle_complete:true}),
    scoreBuild3RecommendationEfficacy({entry_triggered:true,target_hit:false,sl_hit:false,lifecycle_complete:false}),
    scoreBuild3RecommendationEfficacy({entry_triggered:false,target_hit:true,sl_hit:true,lifecycle_complete:true}),
  ];
  const s=summarizeBuild3RecommendationEfficacy(rows);
  assert.equal(s.finalized_triggered,4);
  assert.equal(s.open,1);
  assert.equal(s.untriggered,1);
  assert.equal(s.conservative_hit_rate_pct,25);
  assert.equal(s.liberal_hit_rate_pct,50);
  assert.equal(s.hit_rate_gap_pct,25);
  assert.equal(s.dual_touch_pct,25);
});
