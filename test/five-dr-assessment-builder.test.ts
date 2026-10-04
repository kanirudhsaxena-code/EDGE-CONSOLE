import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFiveDrAssessmentFromDatabase,fiveDrHorizonLabel} from '../src/five-dr-assessment-builder';

test('5DR horizon labels are exactly D through D+4',()=>{
  assert.deepEqual([1,2,3,4,5].map(fiveDrHorizonLabel),['D','D+1','D+2','D+3','D+4']);
});

test('local canonical assessment builder reproduces complete governed snapshot shape',async()=>{
  const now='2026-10-04T16:00:00.000Z';
  const sql=async(strings:TemplateStringsArray,..._values:any[])=>{
    const q=strings.join('?').replace(/\s+/g,' ').trim().toLowerCase();
    if(q.startsWith('select selected_forecast_id'))return [{selected_forecast_id:'5drf_test'}];
    if(q.startsWith('select target_trading_date,selection_status'))return [{
      target_trading_date:'2026-10-05',selection_status:'SELECTED',
      selection_rule:'PREOPEN_CANONICAL',selection_reason:'test',
      selected_forecast_id:'5drf_test',selected_at:now
    }];
    if(q.includes('from canon')&&q.includes('avg_directional_margin_points')===false&&q.includes('avg(directional_margin_points)'))return [
      {day_number:1,scorable:2,hits:2,zone_hits:1,hit_rate_pct:100,zone_hit_rate_pct:50,avg_margin:12.5,avg_zone_error:20,last_evaluated_at:now},
      {day_number:2,scorable:1,hits:1,zone_hits:1,hit_rate_pct:100,zone_hit_rate_pct:100,avg_margin:8,avg_zone_error:10,last_evaluated_at:now},
    ];
    if(q.includes('eligible_matured'))return [
      {day_number:1,eligible_matured:2},
      {day_number:2,eligible_matured:1},
    ];
    if(q.includes('round(100.0*count(*) filter (where directional_hit)'))return [{
      scorable:3,hits:3,zone_hits:2,accuracy:100,zone_accuracy:66.67,assessed_at:now
    }];
    if(q.includes("where oc.status='due'"))return [{overdue:0}];
    if(q.includes('daily_count<5 or checkpoint_count<5'))return [{incomplete:0}];
    if(q.includes('as actionable_calls'))return [{
      actionable_calls:1,no_trade_calls:1,resolved:1,wins:1,losses:0,open_calls:0,
      hit_rate_pct:100,average_resolved_r:2,average_resolved_pnl_pct:4,recommendation_as_of:now
    }];
    if(q.includes('as cumulative'))return [{cumulative:4,hits_return:4,misses_return:0}];
    if(q.includes('where day_number between 1 and 5'))return [{
      day_number:1,resolved:1,hits:1,misses:0,hit_rate_pct:100,
      overall_pnl_pct:4,hit_pnl_pct:4,miss_pnl_pct:null
    }];
    if(q.includes("where f.model_version='5dr_v2_1'"))return [{
      forecast_id:'5drf_test',run_timestamp:now,definitive_forecast:'BEAR',
      recommendation:'BUY_PE',bull_probability:10,range_probability:20,bear_probability:70,
      instrument:'PE',strike:22000,expiry:'2026-10-08',entry_low:100,entry_high:110,
      stop_premium:80,target1_premium:140,target2_premium:170,expected_rr:2,
      event_type:'T2_HIT',event_timestamp:now,premium:170,pnl_pct:4,r_multiple:2,
      target_trading_date:'2026-10-05'
    }];
    throw new Error('unexpected SQL in fixture: '+q.slice(0,180));
  };

  const result=await buildFiveDrAssessmentFromDatabase(sql as any);
  assert.equal(result.ok,true);
  if(!result.ok)return;
  const a=result.assessment;
  assert.equal(a.engine,'5DR');
  assert.equal(a.forecast_id,'5drf_test');
  assert.equal(a.metrics.assessment_snapshot_complete,true);
  assert.equal(a.metrics.recommendation_ledger_complete,true);
  assert.equal(a.metrics.all_recommendations_count,1);
  assert.deepEqual(Object.keys(a.metrics.day_metrics),['D','D+1','D+2','D+3','D+4']);
  assert.equal(a.metrics.day_metrics.D.scorable,2);
  assert.equal(a.metrics.day_metrics['D+1'].scorable,1);
  assert.equal(a.metrics.day_metrics['D+2'].status,'NOT DUE');
  assert.equal(a.metrics.overall_forecast_metrics.canonical_scorable_checkpoints,3);
  assert.equal(a.metrics.overall_forecast_metrics.directional_accuracy_pct,100);
  assert.equal(a.metrics.recommendation_metrics.hit_rate_pct,100);
  assert.equal(a.metrics.return_metrics.cumulative_resolved_pnl_pct,4);
  assert.equal(a.metrics.canonical_selection.canonical_type,'PREOPEN_CANONICAL');
});

test('local assessment builder fails closed when no selected canonical exists',async()=>{
  const sql=async()=>[];
  const result=await buildFiveDrAssessmentFromDatabase(sql as any);
  assert.deepEqual(result,{ok:false,detail:'no canonical forecast'});
});
