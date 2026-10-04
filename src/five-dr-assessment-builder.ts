type SqlFn=(strings:TemplateStringsArray,...values:any[])=>Promise<any[]>;

const n=(value:any)=>value===null||value===undefined?null:Number(value);
const i=(value:any)=>Number.isFinite(Number(value))?Number(value):0;
const iso=(value:any)=>value instanceof Date?value.toISOString():value?new Date(String(value)).toISOString():null;
const dateOnly=(value:any)=>value instanceof Date?value.toISOString().slice(0,10):String(value??'').slice(0,10);
export const fiveDrHorizonLabel=(day:number)=>day===1?'D':`D+${day-1}`;

const dayDefault=()=>({
  status:'NOT DUE',
  eligible_matured:0,
  scorable:0,
  missing_unscorable:0,
  coverage_pct:null as number|null,
  hits:0,
  zone_scorable:0,
  zone_hits:0,
  hit_rate_pct:null as number|null,
  zone_hit_rate_pct:null as number|null,
  avg_directional_margin_points:null as number|null,
  avg_zone_error_points:null as number|null,
});

export type FiveDrAssessmentBuildResult=
  |{ok:true;assessment:any}
  |{ok:false;detail:string};

export async function buildFiveDrAssessmentFromDatabase(sql:SqlFn):Promise<FiveDrAssessmentBuildResult>{
  const sourceRows=await sql`
    select selected_forecast_id
      from canonical_selections
     where selection_status='SELECTED' and selected_forecast_id is not null
     order by target_trading_date desc
     limit 1
  `;
  if(!sourceRows.length||!sourceRows[0].selected_forecast_id)return {ok:false,detail:'no canonical forecast'};
  const forecastId=String(sourceRows[0].selected_forecast_id);

  const canonicalRows=await sql`
    select target_trading_date,selection_status,selection_rule,selection_reason,
           selected_forecast_id,selected_at
      from canonical_selections
     order by target_trading_date desc
     limit 1
  `;
  let canonicalSelection:any=null;
  if(canonicalRows.length){
    const row=canonicalRows[0];
    const target=dateOnly(row.target_trading_date);
    const legacy=target<'2026-09-22';
    const status=String(row.selection_status??'');
    canonicalSelection={
      target_trading_date:target,
      selection_status:status,
      canonical_type:legacy
        ?(status==='SELECTED'?'LEGACY_CANONICAL':'LEGACY_CANONICAL_MISSED')
        :String(row.selection_rule??(status!=='SELECTED'?'CANONICAL_MISSED':'PREOPEN_CANONICAL')),
      selection_rule:row.selection_rule??null,
      selected_forecast_id:row.selected_forecast_id??null,
      selected_at:iso(row.selected_at),
      selection_reason:row.selection_reason??null,
      governance_era:legacy?'LEGACY':'POST_GOVERNANCE',
    };
  }

  const horizonRows=await sql`
    with canon as (
      select e.*
        from v_latest_forecast_checkpoint_evaluation e
        join canonical_selections c
          on c.selected_forecast_id=e.forecast_id
         and c.selection_status='SELECTED'
    )
    select day_number,
           count(*) filter (where evaluation_status='SCORABLE') as scorable,
           count(*) filter (where evaluation_status='SCORABLE' and directional_hit) as hits,
           count(*) filter (where evaluation_status='SCORABLE' and zone_hit) as zone_hits,
           round(100.0*count(*) filter (where evaluation_status='SCORABLE' and directional_hit)
                 /nullif(count(*) filter (where evaluation_status='SCORABLE'),0),2) as hit_rate_pct,
           round(100.0*count(*) filter (where evaluation_status='SCORABLE' and zone_hit)
                 /nullif(count(*) filter (where evaluation_status='SCORABLE'),0),2) as zone_hit_rate_pct,
           round(avg(directional_margin_points) filter (where evaluation_status='SCORABLE'),2) as avg_margin,
           round(avg(zone_error_points) filter (where evaluation_status='SCORABLE'),2) as avg_zone_error,
           max(evaluated_at) as last_evaluated_at
      from canon
     group by day_number
     order by day_number
  `;

  const eligibleRows=await sql`
    select cast(substring(oc.checkpoint_type from 3) as integer) as day_number,
           count(*) as eligible_matured
      from outcome_checkpoints oc
      join canonical_selections cs
        on cs.selected_forecast_id=oc.forecast_id
       and cs.selection_status='SELECTED'
     where oc.checkpoint_type in ('D+1','D+2','D+3','D+4','D+5')
       and (
         oc.due_date < (current_timestamp at time zone 'Asia/Kolkata')::date
         or (
           oc.due_date = (current_timestamp at time zone 'Asia/Kolkata')::date
           and (current_timestamp at time zone 'Asia/Kolkata')::time >= time '15:40'
         )
       )
     group by cast(substring(oc.checkpoint_type from 3) as integer)
     order by day_number
  `;
  const eligibleByDay=new Map<number,number>(eligibleRows.map((r:any)=>[i(r.day_number),i(r.eligible_matured)]));

  const overallRows=await sql`
    with canon as (
      select e.*
        from v_latest_forecast_checkpoint_evaluation e
        join canonical_selections c
          on c.selected_forecast_id=e.forecast_id
         and c.selection_status='SELECTED'
       where e.evaluation_status='SCORABLE'
    )
    select count(*) as scorable,
           count(*) filter (where directional_hit) as hits,
           count(*) filter (where zone_hit) as zone_hits,
           round(100.0*count(*) filter (where directional_hit)/nullif(count(*),0),2) as accuracy,
           round(100.0*count(*) filter (where zone_hit)/nullif(count(*),0),2) as zone_accuracy,
           max(evaluated_at) as assessed_at
      from canon
  `;
  const overallRow=overallRows[0]??{};
  const forecastAssessedAt=overallRow.assessed_at;
  if(!forecastAssessedAt)return {ok:false,detail:'no scorable checkpoint'};

  const overdueRows=await sql`
    select count(*) as overdue
      from outcome_checkpoints oc
      join canonical_selections c
        on c.selected_forecast_id=oc.forecast_id
       and c.selection_status='SELECTED'
     where oc.status='DUE'
       and oc.due_date < (current_timestamp at time zone 'Asia/Kolkata')::date
  `;
  const overdue=i(overdueRows[0]?.overdue);

  const integrityRows=await sql`
    with selected as (
      select selected_forecast_id as forecast_id
        from canonical_selections
       where selection_status='SELECTED' and selected_forecast_id is not null
    ),
    counts as (
      select s.forecast_id,
             (select count(*) from daily_forecasts df where df.forecast_id=s.forecast_id) as daily_count,
             (select count(*) from outcome_checkpoints oc
               where oc.forecast_id=s.forecast_id
                 and oc.checkpoint_type in ('D+1','D+2','D+3','D+4','D+5')) as checkpoint_count
        from selected s
    )
    select count(*) filter (where daily_count<5 or checkpoint_count<5) as incomplete
      from counts
  `;
  const integrityIncomplete=i(integrityRows[0]?.incomplete);

  const recommendationRows=await sql`
    with selected as (
      select cs.target_trading_date,
             cs.selected_forecast_id as forecast_id,
             f.recommendation
        from canonical_selections cs
        join forecasts f on f.forecast_id=cs.selected_forecast_id
       where cs.selection_status='SELECTED'
         and cs.selected_forecast_id is not null
    ),
    terminal as (
      select distinct on (re.forecast_id)
             re.forecast_id,re.event_type,re.event_timestamp,re.pnl_pct,re.r_multiple
        from recommendation_events re
        join selected s on s.forecast_id=re.forecast_id
       where re.event_type in ('T2_HIT','SL_HIT','THESIS_EXIT','TIME_EXIT')
       order by re.forecast_id,re.event_timestamp desc,re.event_id desc
    ),
    event_clock as (
      select max(re.event_timestamp) as recommendation_as_of
        from recommendation_events re
        join selected s on s.forecast_id=re.forecast_id
    )
    select count(*) filter (where s.recommendation in ('BUY_CE','BUY_PE','BUY_CONVEXITY')) as actionable_calls,
           count(*) filter (where s.recommendation='NO_TRADE') as no_trade_calls,
           count(t.forecast_id) as resolved,
           count(*) filter (where t.event_type='T2_HIT') as wins,
           count(*) filter (where t.forecast_id is not null and t.event_type<>'T2_HIT') as losses,
           count(*) filter (
             where s.recommendation in ('BUY_CE','BUY_PE','BUY_CONVEXITY')
               and t.forecast_id is null
           ) as open_calls,
           round(100.0*count(*) filter (where t.event_type='T2_HIT')
                 / nullif(count(t.forecast_id),0),2) as hit_rate_pct,
           round(avg(t.r_multiple) filter (where t.forecast_id is not null),4) as average_resolved_r,
           round(avg(t.pnl_pct) filter (where t.forecast_id is not null),4) as average_resolved_pnl_pct,
           (select recommendation_as_of from event_clock) as recommendation_as_of
      from selected s
      left join terminal t on t.forecast_id=s.forecast_id
  `;
  const rr=recommendationRows[0]??{};
  const recommendationMetrics={
    population_rule:'SELECTED_DAILY_CANONICAL_ONLY',
    actionable_calls:i(rr.actionable_calls),
    no_trade_calls:i(rr.no_trade_calls),
    resolved:i(rr.resolved),
    wins:i(rr.wins),
    losses:i(rr.losses),
    open:i(rr.open_calls),
    hit_rate_pct:n(rr.hit_rate_pct),
    hit_rate_fraction:`${i(rr.wins)}/${i(rr.resolved)}`,
    average_resolved_r:n(rr.average_resolved_r),
    average_resolved_standardized_pnl_pct:n(rr.average_resolved_pnl_pct),
  };

  const cumulativeRows=await sql`
    with terminal as (
      select distinct on (re.forecast_id)
             re.forecast_id,re.event_type,re.pnl_pct,re.event_timestamp
        from recommendation_events re
        join canonical_selections c
          on c.selected_forecast_id=re.forecast_id
         and c.selection_status='SELECTED'
       where re.event_type in ('T2_HIT','SL_HIT','THESIS_EXIT','TIME_EXIT')
       order by re.forecast_id,re.event_timestamp desc,re.event_id desc
    )
    select coalesce(sum(pnl_pct),0) as cumulative,
           coalesce(sum(pnl_pct) filter (where event_type='T2_HIT'),0) as hits_return,
           coalesce(sum(pnl_pct) filter (where event_type<>'T2_HIT'),0) as misses_return
      from terminal
  `;
  const cr=cumulativeRows[0]??{};

  const dayRecommendationRows=await sql`
    with selected as (
      select cs.target_trading_date,cs.selected_forecast_id as forecast_id
        from canonical_selections cs
       where cs.selection_status='SELECTED'
         and cs.selected_forecast_id is not null
    ),
    issued as (
      select re.forecast_id,
             min(re.event_timestamp) filter (where re.event_type='ISSUED') as issued_at
        from recommendation_events re
        join selected s on s.forecast_id=re.forecast_id
       group by re.forecast_id
    ),
    terminal as (
      select distinct on (re.forecast_id)
             re.forecast_id,re.event_type,re.event_timestamp,re.pnl_pct
        from recommendation_events re
        join selected s on s.forecast_id=re.forecast_id
       where re.event_type in ('T2_HIT','SL_HIT','THESIS_EXIT','TIME_EXIT')
       order by re.forecast_id,re.event_timestamp desc,re.event_id desc
    ),
    resolved as (
      select t.*,i.issued_at,
             (
               select count(*)
                 from (
                   select distinct target_trading_date
                     from canonical_selections
                    where selection_status='SELECTED'
                 ) d
                where d.target_trading_date > (i.issued_at at time zone 'Asia/Kolkata')::date
                  and d.target_trading_date <= (t.event_timestamp at time zone 'Asia/Kolkata')::date
             )::int as day_number
        from terminal t
        join issued i using (forecast_id)
    )
    select day_number,
           count(*) as resolved,
           count(*) filter (where event_type='T2_HIT') as hits,
           count(*) filter (where event_type<>'T2_HIT') as misses,
           round(100.0*count(*) filter (where event_type='T2_HIT')/nullif(count(*),0),2) as hit_rate_pct,
           round(sum(pnl_pct),4) as overall_pnl_pct,
           round(sum(pnl_pct) filter (where event_type='T2_HIT'),4) as hit_pnl_pct,
           round(sum(pnl_pct) filter (where event_type<>'T2_HIT'),4) as miss_pnl_pct
      from resolved
     where day_number between 1 and 5
     group by day_number
     order by day_number
  `;

  const ledgerRows=await sql`
    with latest_event as (
      select distinct on (re.forecast_id)
             re.forecast_id,re.event_type,re.event_timestamp,re.premium,re.pnl_pct,re.r_multiple
        from recommendation_events re
       order by re.forecast_id,re.event_timestamp desc,re.event_id desc
    ),
    canonical as (
      select selected_forecast_id as forecast_id,target_trading_date
        from canonical_selections
       where selection_status='SELECTED' and selected_forecast_id is not null
    )
    select f.forecast_id,f.run_timestamp,f.definitive_forecast,f.recommendation,
           f.bull_probability,f.range_probability,f.bear_probability,
           ep.instrument,ep.strike,ep.expiry,ep.entry_low,ep.entry_high,
           ep.stop_premium,ep.target1_premium,ep.target2_premium,ep.expected_rr,
           le.event_type,le.event_timestamp,le.premium,le.pnl_pct,le.r_multiple,
           c.target_trading_date
      from forecasts f
      left join execution_plans ep using (forecast_id)
      left join latest_event le using (forecast_id)
      left join canonical c using (forecast_id)
     where f.model_version='5DR_V2_1'
     order by f.run_timestamp
  `;

  const recommendationLedger=ledgerRows.map((row:any)=>({
    forecast_id:row.forecast_id,
    run_timestamp:iso(row.run_timestamp),
    definitive_forecast:row.definitive_forecast,
    recommendation:row.recommendation,
    probabilities:{BULL:Number(row.bull_probability),RANGE:Number(row.range_probability),BEAR:Number(row.bear_probability)},
    execution:{
      instrument:row.instrument??null,
      strike:n(row.strike),expiry:row.expiry?dateOnly(row.expiry):null,
      entry_low:n(row.entry_low),entry_high:n(row.entry_high),stop:n(row.stop_premium),
      target1:n(row.target1_premium),target2:n(row.target2_premium),expected_rr:n(row.expected_rr),
    },
    lifecycle:{
      latest_event:row.event_type??(row.recommendation==='NO_TRADE'?'NO_TRADE':'ENTRY_NOT_VERIFIABLE'),
      event_timestamp:iso(row.event_timestamp),premium:n(row.premium),pnl_pct:n(row.pnl_pct),r_multiple:n(row.r_multiple),
    },
    canonical_target_trading_date:row.target_trading_date?dateOnly(row.target_trading_date):null,
  }));

  const dayMetrics:any={};
  for(let day=1;day<=5;day++)dayMetrics[fiveDrHorizonLabel(day)]=dayDefault();
  for(const row of horizonRows){
    const day=i(row.day_number);if(day<1||day>5)continue;
    dayMetrics[fiveDrHorizonLabel(day)]={
      ...dayDefault(),
      status:i(row.scorable)?'SCORABLE':'NOT DUE',
      scorable:i(row.scorable),hits:i(row.hits),zone_scorable:i(row.scorable),zone_hits:i(row.zone_hits),
      hit_rate_pct:n(row.hit_rate_pct),zone_hit_rate_pct:n(row.zone_hit_rate_pct),
      avg_directional_margin_points:n(row.avg_margin),avg_zone_error_points:n(row.avg_zone_error),
    };
  }
  for(let day=1;day<=5;day++){
    const key=fiveDrHorizonLabel(day),eligible=eligibleByDay.get(day)??0,scored=i(dayMetrics[key].scorable);
    dayMetrics[key].eligible_matured=eligible;
    dayMetrics[key].missing_unscorable=Math.max(eligible-scored,0);
    dayMetrics[key].coverage_pct=eligible?Math.round(10000*scored/eligible)/100:null;
    dayMetrics[key].status=eligible&&scored<eligible?(scored?'PARTIAL_SCORABLE':'MATURED_NOT_SCORABLE'):scored?'SCORABLE':'NOT DUE';
  }

  const scorable=i(overallRow.scorable),directionalHits=i(overallRow.hits),zoneHits=i(overallRow.zone_hits);
  const eligibleMatured=Object.values(dayMetrics).reduce((sum:number,row:any)=>sum+i(row.eligible_matured),0);
  const missingUnscorable=Math.max(eligibleMatured-scorable,0);
  const coverage=eligibleMatured?Math.round(10000*scorable/eligibleMatured)/100:null;
  let headline=`${directionalHits}/${scorable} scorable canonical checkpoints directionally correct; ${zoneHits}/${scorable} zone hits`;
  if(eligibleMatured)headline+=`; ${scorable}/${eligibleMatured} matured eligible checkpoints scorable`;
  if(overdue)headline+=`; ${overdue} overdue checkpoints still pending reconciliation`;
  if(integrityIncomplete)headline+=`; ${integrityIncomplete} canonical forecast(s) have incomplete frozen persistence`;

  const dayRecommendationMetrics:any={};
  for(let day=1;day<=5;day++)dayRecommendationMetrics[fiveDrHorizonLabel(day)]={
    resolved:0,hits:0,misses:0,hit_rate_pct:null,overall_pnl_pct:null,hit_pnl_pct:null,miss_pnl_pct:null
  };
  for(const row of dayRecommendationRows){
    const day=i(row.day_number);if(day<1||day>5)continue;
    dayRecommendationMetrics[fiveDrHorizonLabel(day)]={
      resolved:i(row.resolved),hits:i(row.hits),misses:i(row.misses),hit_rate_pct:n(row.hit_rate_pct),
      overall_pnl_pct:n(row.overall_pnl_pct),hit_pnl_pct:n(row.hit_pnl_pct),miss_pnl_pct:n(row.miss_pnl_pct),
    };
  }

  const assessedCandidates=[forecastAssessedAt,rr.recommendation_as_of].filter(Boolean).map((v:any)=>new Date(String(v)));
  const assessedAt=new Date(Math.max(...assessedCandidates.map((v:Date)=>v.getTime()))).toISOString();
  const metrics={
    canonical_selection:canonicalSelection,
    overall_forecast_metrics:{
      headline,
      canonical_matured_eligible_checkpoints:eligibleMatured,
      canonical_scorable_checkpoints:scorable,
      canonical_scorable:scorable,
      missing_unscorable_checkpoints:missingUnscorable,
      scorable_coverage_pct:coverage,
      directional_hits:directionalHits,
      zone_hits:zoneHits,
      directional_accuracy_pct:n(overallRow.accuracy),
      zone_hit_rate_pct:n(overallRow.zone_accuracy),
      pending_due_checkpoints:overdue,
      persistence_integrity_incomplete_forecasts:integrityIncomplete,
      population_rule:'SELECTED_DAILY_CANONICAL_ONLY',
    },
    day_metrics:dayMetrics,
    recommendation_metrics:recommendationMetrics,
    day_recommendation_metrics:dayRecommendationMetrics,
    return_metrics:{
      cumulative_resolved_pnl_pct:n(cr.cumulative)??0,
      hit_pnl_pct:n(cr.hits_return)??0,
      miss_pnl_pct:n(cr.misses_return)??0,
      method:'sum of resolved standardized model P&L percentages across selected DAILY_CANONICAL actionable recommendations only',
      population_rule:'SELECTED_DAILY_CANONICAL_ONLY',
    },
    recommendation_ledger:recommendationLedger,
    all_recommendations_count:recommendationLedger.length,
    recommendation_ledger_complete:true,
    assessment_snapshot_complete:['D','D+1','D+2','D+3','D+4'].every(key=>key in dayMetrics),
  };
  return {
    ok:true,
    assessment:{
      engine:'5DR',
      forecast_id:forecastId,
      assessed_at:assessedAt,
      outcome:`${headline}; ${recommendationMetrics.wins}/${recommendationMetrics.resolved} resolved recommendations won`,
      score:n(overallRow.accuracy),
      metrics,
    }
  };
}
