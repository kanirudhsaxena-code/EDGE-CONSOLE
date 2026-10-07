import { neon } from '@neondatabase/serverless';
import { scoreBuild3ZoneEfficacy, scoreBuild3RecommendationEfficacy, summarizeBuild3RecommendationEfficacy, type Build3RecommendationEfficacy } from './build-3-efficacy-contract';
import { readBuild3OutcomeSource, type Build3OutcomeSourceEnv } from './build-3-outcome-source';
import { buildStockBuild3Forecast, type Build3StockPathRow } from './build-3-stock-forecast';
import { buildStockPrecisionPlan } from './build-3-precision';

export const BUILD3_HISTORICAL_REPLAY_VERSION='MDOS_BUILD_3_HISTORICAL_REPLAY_V1' as const;
const HORIZONS=['D','D+1','D+2','D+3','D+4'] as const;
const NIFTY_HALF_WIDTH_PERCENT=[0.50,0.55,0.60,0.65,0.75] as const;

type ReplayEnv=Build3OutcomeSourceEnv&{
  DATABASE_URL?:string;
};

type ZoneAccumulator={
  close_samples:number;
  close_hits:number;
  deviation_samples:number;
  deviation_hits:number;
  challenger_3pct_hits:number;
  green:number;
  amber:number;
  red:number;
  deviation_sum:number;
};

type DirectionAccumulator={samples:number;hits:number};
type ProbabilityAccumulator={samples:number;brier_sum:number};

const zoneAcc=():ZoneAccumulator=>({
  close_samples:0,close_hits:0,deviation_samples:0,deviation_hits:0,challenger_3pct_hits:0,
  green:0,amber:0,red:0,deviation_sum:0,
});
const dirAcc=():DirectionAccumulator=>({samples:0,hits:0});
const probAcc=():ProbabilityAccumulator=>({samples:0,brier_sum:0});
const pct=(n:number,d:number)=>d?Number((n/d*100).toFixed(4)):null;
const mean=(n:number,d:number)=>d?Number((n/d).toFixed(8)):null;
const isoDate=(value:unknown)=>new Date(String(value)).toISOString().slice(0,10);
const finite=(value:unknown):value is number=>Number.isFinite(Number(value));
const num=(value:unknown):number|null=>value===null||value===undefined||value===''?null:(finite(value)?Number(value):null);
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};

function istClock(asOf:Date){
  const shifted=new Date(asOf.getTime()+330*60_000);
  return {
    date:shifted.toISOString().slice(0,10),
    minute:shifted.getUTCHours()*60+shifted.getUTCMinutes(),
  };
}
function isMatured(session:string,asOf:Date):boolean{
  const c=istClock(asOf);
  return session<c.date||(session===c.date&&c.minute>=15*60+30);
}
function addZone(acc:ZoneAccumulator,input:{low:number;high:number;actualHigh?:number|null;actualLow?:number|null;actualClose:number}){
  const {low,high,actualClose}=input;
  if(!(high>low)||![low,high,actualClose].every(Number.isFinite))return;
  acc.close_samples++;
  if(actualClose>=low&&actualClose<=high)acc.close_hits++;
  if(!finite(input.actualHigh)||!finite(input.actualLow))return;
  const scored=scoreBuild3ZoneEfficacy({
    zone_low:low,zone_high:high,
    actual_high:Number(input.actualHigh),actual_low:Number(input.actualLow),actual_close:actualClose,
  });
  if(scored.scorability_state!=='SCORABLE')return;
  acc.deviation_samples++;
  if(scored.deviation_hit)acc.deviation_hits++;
  if(scored.challenger_deviation_hit)acc.challenger_3pct_hits++;
  if(scored.quality_status==='GREEN')acc.green++;
  if(scored.quality_status==='AMBER')acc.amber++;
  if(scored.quality_status==='RED')acc.red++;
  acc.deviation_sum+=Number(scored.range_deviation_pct??0);
}
function addDirection(acc:DirectionAccumulator,direction:string,p0:number|null,close:number|null,low:number|null,high:number|null){
  if(close===null)return;
  let hit:boolean|null=null;
  if(direction==='BULL'||direction==='BULLISH')hit=p0===null?null:close>p0;
  else if(direction==='BEAR'||direction==='BEARISH')hit=p0===null?null:close<p0;
  else if(direction==='RANGE'||direction==='BASE'||direction==='BASE_RANGE')hit=low!==null&&high!==null?close>=low&&close<=high:null;
  if(hit===null)return;
  acc.samples++; if(hit)acc.hits++;
}
function addProbability(acc:ProbabilityAccumulator,input:{
  bull:number|null;range:number|null;bear:number|null;p0:number|null;close:number|null;coreLow:number|null;coreHigh:number|null;
}){
  const {bull,range,bear,p0,close,coreLow,coreHigh}=input;
  if([bull,range,bear,p0,close,coreLow,coreHigh].some(x=>x===null))return;
  if(Math.abs((bull!+range!+bear!)-100)>0.02||!(coreHigh!>coreLow!))return;
  const half=(coreHigh!-coreLow!)/2;
  const actual=close!>p0!+half?'BULL':close!<p0!-half?'BEAR':'RANGE';
  const q={BULL:bull!/100,RANGE:range!/100,BEAR:bear!/100};
  const brier=(q.BULL-(actual==='BULL'?1:0))**2+(q.RANGE-(actual==='RANGE'?1:0))**2+(q.BEAR-(actual==='BEAR'?1:0))**2;
  acc.samples++;acc.brier_sum+=brier;
}
function zoneSummary(acc:ZoneAccumulator){
  return {
    close_samples:acc.close_samples,
    close_hit_rate_pct:pct(acc.close_hits,acc.close_samples),
    deviation_samples:acc.deviation_samples,
    deviation_hit_rate_5pct:pct(acc.deviation_hits,acc.deviation_samples),
    challenger_hit_rate_3pct:pct(acc.challenger_3pct_hits,acc.deviation_samples),
    green_pct:pct(acc.green,acc.deviation_samples),
    amber_pct:pct(acc.amber,acc.deviation_samples),
    red_pct:pct(acc.red,acc.deviation_samples),
    mean_range_deviation_pct:mean(acc.deviation_sum,acc.deviation_samples),
  };
}
const directionSummary=(acc:DirectionAccumulator)=>({samples:acc.samples,hit_rate_pct:pct(acc.hits,acc.samples)});
const probabilitySummary=(acc:ProbabilityAccumulator)=>({samples:acc.samples,mean_brier_score:mean(acc.brier_sum,acc.samples)});

function bump(map:Record<string,number>,key:string){map[key]=(map[key]??0)+1}
function pushSample(samples:string[],value:string){if(samples.length<20)samples.push(value)}

async function read5drReplay(env:ReplayEnv,asOf:Date){
  if(!env.FIVEDR_DATABASE_URL?.trim())throw new Error('BUILD3_REPLAY_5DR_DATABASE_NOT_CONFIGURED');
  const sql=neon(env.FIVEDR_DATABASE_URL);
  const headers=await sql`
    select f.forecast_id,f.run_timestamp,f.spot_price,f.model_version,f.regime,f.recommendation,
           fg.validity_status
      from forecasts f
      left join forecast_governance fg on fg.forecast_id=f.forecast_id
     where f.run_timestamp <= ${asOf.toISOString()}::timestamptz
       and (fg.validity_status is null or fg.validity_status='VALID')
     order by f.run_timestamp,f.forecast_id
  `;
  const rows=await sql`
    select f.forecast_id,f.run_timestamp,f.spot_price,f.model_version,f.regime,f.recommendation,
           d.day_number,d.trading_date,d.bias,d.probability,d.zone_low,d.zone_high,
           d.bull_probability,d.range_probability,d.bear_probability,
           e.actual_close as evaluation_actual_close
      from forecasts f
      join daily_forecasts d on d.forecast_id=f.forecast_id
      left join forecast_governance fg on fg.forecast_id=f.forecast_id
      left join lateral (
        select actual_close
          from forecast_checkpoint_evaluations x
         where x.forecast_id=f.forecast_id and x.day_number=d.day_number
           and x.evaluation_status='SCORABLE' and x.actual_close is not null
         order by x.evaluated_at desc,x.evaluation_id desc
         limit 1
      ) e on true
     where f.run_timestamp <= ${asOf.toISOString()}::timestamptz
       and (fg.validity_status is null or fg.validity_status='VALID')
     order by f.run_timestamp,f.forecast_id,d.day_number
  `;

  const outer=zoneAcc(),coreShadow=zoneAcc(),direction=dirAcc(),probabilityShadow=probAcc();
  const exclusions:Record<string,number>={};
  const exclusion_samples:string[]=[];
  const byForecast=new Map<string,any[]>();
  for(const row of rows as any[]){
    const id=String(row.forecast_id);
    const list=byForecast.get(id)??[];list.push(row);byForecast.set(id,list);
  }
  let maturedHorizons=0,futureHorizons=0,ohlcTruth=0,closeOnlyTruth=0;
  for(const [forecastId,forecastRows] of byForecast){
    for(const row of forecastRows){
      const day=Number(row.day_number);
      if(!Number.isInteger(day)||day<1||day>5){bump(exclusions,'HORIZON_INDEX_INVALID');continue}
      const horizon=HORIZONS[day-1];
      const session=isoDate(row.trading_date);
      if(!isMatured(session,asOf)){futureHorizons++;continue}
      maturedHorizons++;
      const low=num(row.zone_low),high=num(row.zone_high),p0=num(row.spot_price);
      if(low===null||high===null||!(high>low)){bump(exclusions,'FROZEN_OUTER_ZONE_INVALID');pushSample(exclusion_samples,forecastId+':'+horizon);continue}
      let actualHigh:number|null=null,actualLow:number|null=null,actualClose:number|null=null;
      try{
        const source=await readBuild3OutcomeSource(env,{engine:'5DR',instrument:'NIFTY',source_id:forecastId,target_session:session});
        if(source){
          actualHigh=source.actual_high;actualLow=source.actual_low;actualClose=source.actual_close;ohlcTruth++;
        }
      }catch{
        bump(exclusions,'AUTHENTICATED_OHLC_SOURCE_ERROR');
      }
      if(actualClose===null){
        actualClose=num(row.evaluation_actual_close);
        if(actualClose!==null)closeOnlyTruth++;
      }
      if(actualClose===null){bump(exclusions,'TRUTH_NOT_AVAILABLE');pushSample(exclusion_samples,forecastId+':'+horizon);continue}
      addZone(outer,{low,high,actualHigh,actualLow,actualClose});
      addDirection(direction,String(row.bias),p0,actualClose,low,high);

      const centre=(low+high)/2;
      const half=centre*(NIFTY_HALF_WIDTH_PERCENT[day-1]/100);
      const coreLow=centre-half,coreHigh=centre+half;
      const coreValid=coreLow>=low&&coreHigh<=high&&(coreHigh-coreLow)<(high-low);
      if(coreValid){
        addZone(coreShadow,{low:coreLow,high:coreHigh,actualHigh,actualLow,actualClose});
        addProbability(probabilityShadow,{
          bull:num(row.bull_probability),range:num(row.range_probability),bear:num(row.bear_probability),
          p0,close:actualClose,coreLow,coreHigh,
        });
      }else bump(exclusions,'CORE_SHADOW_CALIBRATION_BLOCKED');
    }
  }
  const noPath=headers.length-byForecast.size;
  if(noPath>0)exclusions.FIVE_HORIZON_PATH_MISSING=noPath;

  const eventRows=await sql`
    select f.forecast_id,f.run_timestamp,f.recommendation,
           ep.instrument,ep.entry_low,ep.entry_high,ep.stop_premium,ep.target1_premium,
           re.event_type,re.event_timestamp,re.notes
      from forecasts f
      left join execution_plans ep on ep.forecast_id=f.forecast_id
      left join recommendation_events re on re.forecast_id=f.forecast_id
     where f.run_timestamp <= ${asOf.toISOString()}::timestamptz
       and f.recommendation in ('BUY_CE','BUY_PE','BUY_CONVEXITY')
     order by f.forecast_id,re.event_timestamp,re.event_id
  `;
  const recGroups=new Map<string,any[]>();
  for(const row of eventRows as any[]){
    const id=String(row.forecast_id),list=recGroups.get(id)??[];list.push(row);recGroups.set(id,list);
  }
  const recommendationRows:Build3RecommendationEfficacy[]=[];
  const recommendationExclusions:Record<string,number>={};
  for(const [id,group] of recGroups){
    const types=new Set(group.map(x=>String(x.event_type??'')));
    if(types.has('NOT_SCORABLE')||types.has('ENTRY_NOT_VERIFIABLE')){bump(recommendationExclusions,'EXPLICIT_NOT_SCORABLE_OR_ENTRY_NOT_VERIFIABLE');continue}
    const entry=types.has('ENTRY_REFERENCE_SET')||types.has('ENTRY_TRIGGERED');
    if(!entry){bump(recommendationExclusions,'ENTRY_TRIGGER_NOT_FROZEN');continue}
    const target=types.has('T1_HIT');
    const sl=types.has('SL_HIT');
    const complete=types.has('T2_HIT')||types.has('SL_HIT')||types.has('THESIS_EXIT')||types.has('TIME_EXIT');
    recommendationRows.push(scoreBuild3RecommendationEfficacy({entry_triggered:true,target_hit:target,sl_hit:sl,lifecycle_complete:complete}));
  }

  return {
    source_population:{
      valid_forecasts:headers.length,
      forecasts_with_horizon_rows:byForecast.size,
      horizon_rows:rows.length,
      matured_horizons:maturedHorizons,
      not_due_horizons:futureHorizons,
      authenticated_ohlc_horizons:ohlcTruth,
      close_only_fallback_horizons:closeOnlyTruth,
    },
    native_forecast_efficacy:{
      direction:directionSummary(direction),
      outer_zone:zoneSummary(outer),
    },
    reconstructed_shadow_only:{
      label:'NOT_ISSUANCE_EVIDENCE_DO_NOT_ENTER_OFFICIAL_EFFICACY',
      core_zone:zoneSummary(coreShadow),
      probability_calibration:probabilitySummary(probabilityShadow),
    },
    recommendations:{
      actionable_forecasts:recGroups.size,
      scorable_or_open:recommendationRows.length,
      efficacy:summarizeBuild3RecommendationEfficacy(recommendationRows),
      exclusions:recommendationExclusions,
    },
    exclusions,
    exclusion_samples,
    accounted_forecasts:headers.length,
  };
}


async function readEdgeReplay(env:ReplayEnv,asOf:Date){
  if(!env.EDGE_DATABASE_URL?.trim())throw new Error('BUILD3_REPLAY_EDGE_DATABASE_NOT_CONFIGURED');
  const sql=neon(env.EDGE_DATABASE_URL);
  const headers=await sql`
    select recommendation_id,run_timestamp,ticker,definitive_recommendation
      from recommendations
     where run_timestamp <= ${asOf.toISOString()}::timestamptz
     order by run_timestamp,recommendation_id
  `;
  const rows=await sql`
    select r.recommendation_id,r.run_timestamp,r.ticker,r.model_version,
           p.path_version,p.issued_at,
           pr.horizon_index,pr.horizon_label,pr.target_trading_date,pr.direction,
           pr.bull_probability,pr.base_probability,pr.bear_probability,
           pr.expected_centre,pr.outer_expected_zone_low,pr.outer_expected_zone_high,
           pr.evidence_basis,pr.regime_context,pr.verification_state,pr.lineage,
           perf.reference_price,
           lc.lifecycle_id,
           oc.actual_price as checkpoint_close,oc.period_high as checkpoint_high,oc.period_low as checkpoint_low
      from recommendations r
      join edge_stock_forecast_paths p on p.recommendation_id=r.recommendation_id
      join edge_stock_forecast_path_rows pr on pr.recommendation_id=r.recommendation_id
      left join recommendation_performance perf on perf.recommendation_id=r.recommendation_id
      left join lateral (
        select lifecycle_id
          from edge_run_lifecycles x
         where x.recommendation_id=r.recommendation_id
         order by x.updated_at desc
         limit 1
      ) lc on true
      left join lateral (
        select actual_price,period_high,period_low
          from outcome_checkpoints x
         where x.recommendation_id=r.recommendation_id
           and x.due_date=pr.target_trading_date
           and x.status in ('CAPTURED','CLOSED')
         order by x.observed_at desc,x.checkpoint_id desc
         limit 1
      ) oc on true
     where r.run_timestamp <= ${asOf.toISOString()}::timestamptz
     order by r.run_timestamp,r.recommendation_id,pr.horizon_index
  `;
  const byRec=new Map<string,any[]>();
  for(const row of rows as any[]){const id=String(row.recommendation_id),list=byRec.get(id)??[];list.push(row);byRec.set(id,list)}
  const outer=zoneAcc(),coreShadow=zoneAcc(),direction=dirAcc(),probabilityShadow=probAcc();
  const exclusions:Record<string,number>={};const exclusion_samples:string[]=[];
  let maturedHorizons=0,futureHorizons=0,authenticatedOhlc=0,checkpointTruth=0,coreShadowEligible=0;

  for(const [recommendationId,group] of byRec){
    let precisionByHorizon=new Map<string,{core_low:number;core_high:number}>();
    if(group.length===5){
      try{
        const normalizedRows:Build3StockPathRow[]=group.map(row=>({
          horizon_label:String(row.horizon_label),
          target_trading_date:isoDate(row.target_trading_date),
          direction:String(row.direction),
          bull_probability:Number(row.bull_probability),
          base_probability:Number(row.base_probability),
          bear_probability:Number(row.bear_probability),
          expected_centre:num(row.expected_centre),
          outer_expected_zone_low:Number(row.outer_expected_zone_low),
          outer_expected_zone_high:Number(row.outer_expected_zone_high),
          evidence_basis:String(row.evidence_basis??''),
          regime_context:String(row.regime_context??''),
          verification_state:String(row.verification_state??''),
          lineage:object(row.lineage),
        }));
        const targets=normalizedRows.map((row,index)=>({horizon:HORIZONS[index],target_session:row.target_trading_date}));
        const forecast=buildStockBuild3Forecast({
          ticker:String(group[0].ticker),source_id:recommendationId,path_version:String(group[0].path_version),
          issued_at:new Date(String(group[0].issued_at)).toISOString(),target_sessions:targets,rows:normalizedRows,
          evidence_snapshot_id:'HISTORICAL_REPLAY_SHADOW',evidence_hash:'0'.repeat(64),
        });
        const precision=buildStockPrecisionPlan(forecast,normalizedRows);
        for(const p of precision.issuance){
          if(p.calibration_state==='UNVALIDATED_SHADOW'||p.calibration_state==='CALIBRATED_SHADOW'){
            precisionByHorizon.set(p.horizon,{core_low:p.core_low,core_high:p.core_high});
          }
        }
      }catch{bump(exclusions,'CORE_SHADOW_INPUTS_INCOMPLETE_OR_UNSUPPORTED')}
    }
    for(const row of group){
      const horizon=String(row.horizon_label);
      const session=isoDate(row.target_trading_date);
      if(!isMatured(session,asOf)){futureHorizons++;continue}
      maturedHorizons++;
      const low=num(row.outer_expected_zone_low),high=num(row.outer_expected_zone_high);
      if(low===null||high===null||!(high>low)){bump(exclusions,'FROZEN_OUTER_ZONE_INVALID');continue}
      let actualHigh:number|null=null,actualLow:number|null=null,actualClose:number|null=null;
      const lifecycleId=String(row.lifecycle_id??'').trim();
      if(lifecycleId){
        try{
          const source=await readBuild3OutcomeSource(env,{engine:'EDGE_STOCKS',instrument:String(row.ticker),source_id:lifecycleId,target_session:session});
          if(source&&['CLEAR','ADJUSTED'].includes(source.corporate_action_state)){
            actualHigh=source.actual_high;actualLow=source.actual_low;actualClose=source.actual_close;authenticatedOhlc++;
          }
        }catch{bump(exclusions,'AUTHENTICATED_OHLC_SOURCE_ERROR')}
      }
      if(actualClose===null){
        actualClose=num(row.checkpoint_close);actualHigh=num(row.checkpoint_high);actualLow=num(row.checkpoint_low);
        if(actualClose!==null)checkpointTruth++;
      }
      if(actualClose===null){bump(exclusions,'TRUTH_NOT_AVAILABLE');pushSample(exclusion_samples,recommendationId+':'+horizon);continue}
      addZone(outer,{low,high,actualHigh,actualLow,actualClose});
      const lineage=object(row.lineage);
      const p0=num(lineage.p0)??num(row.reference_price);
      addDirection(direction,String(row.direction),p0,actualClose,low,high);
      const core=precisionByHorizon.get(horizon);
      if(core){
        coreShadowEligible++;
        addZone(coreShadow,{low:core.core_low,high:core.core_high,actualHigh,actualLow,actualClose});
        addProbability(probabilityShadow,{
          bull:num(row.bull_probability),range:num(row.base_probability),bear:num(row.bear_probability),
          p0,close:actualClose,coreLow:core.core_low,coreHigh:core.core_high,
        });
      }
    }
  }

  const recRows=await sql`
    select r.recommendation_id,r.run_timestamp,r.ticker,r.definitive_recommendation,
           ep.instrument,ep.entry_low,ep.entry_high,ep.stop_price,ep.target1,
           l.status as lifecycle_status,l.closure_reason,
           perf.target_hit,perf.stop_hit,perf.outcome_verdict,
           mp.position_id
      from recommendations r
      left join execution_plans ep on ep.recommendation_id=r.recommendation_id
      left join recommendation_lifecycle l on l.recommendation_id=r.recommendation_id
      left join recommendation_performance perf on perf.recommendation_id=r.recommendation_id
      left join lateral (
        select position_id
          from model_portfolio_positions x
         where x.opened_by_recommendation_id=r.recommendation_id
         order by x.opened_at
         limit 1
      ) mp on true
     where r.run_timestamp <= ${asOf.toISOString()}::timestamptz
     order by r.run_timestamp,r.recommendation_id
  `;
  const recommendationRows:Build3RecommendationEfficacy[]=[];
  const recommendationExclusions:Record<string,number>={};
  let noTradeLike=0,actionable=0;
  for(const row of recRows as any[]){
    const instrument=String(row.instrument??'NONE').toUpperCase();
    if(instrument==='NONE'){noTradeLike++;continue}
    actionable++;
    const complete=String(row.lifecycle_status??'')==='CLOSED';
    const entryFrozen=row.position_id!==null&&row.position_id!==undefined;
    if(!entryFrozen){bump(recommendationExclusions,'ENTRY_TRIGGER_NOT_FROZEN_TO_MODEL_POSITION');continue}
    recommendationRows.push(scoreBuild3RecommendationEfficacy({
      entry_triggered:true,
      target_hit:row.target_hit===true,
      sl_hit:row.stop_hit===true,
      lifecycle_complete:complete,
    }));
  }

  return {
    source_population:{
      recommendations:headers.length,
      recommendations_with_five_horizon_path:byRec.size,
      horizon_rows:rows.length,
      matured_horizons:maturedHorizons,
      not_due_horizons:futureHorizons,
      authenticated_ohlc_horizons:authenticatedOhlc,
      legacy_checkpoint_truth_horizons:checkpointTruth,
      core_shadow_eligible_horizons:coreShadowEligible,
    },
    native_forecast_efficacy:{
      direction:directionSummary(direction),
      outer_zone:zoneSummary(outer),
    },
    reconstructed_shadow_only:{
      label:'NOT_ISSUANCE_EVIDENCE_DO_NOT_ENTER_OFFICIAL_EFFICACY',
      core_zone:zoneSummary(coreShadow),
      probability_calibration:probabilitySummary(probabilityShadow),
    },
    recommendations:{
      total_recommendations:recRows.length,
      actionable,
      no_trade_or_none:noTradeLike,
      scorable_or_open:recommendationRows.length,
      efficacy:summarizeBuild3RecommendationEfficacy(recommendationRows),
      exclusions:recommendationExclusions,
    },
    exclusions,
    exclusion_samples,
    accounted_recommendations:headers.length,
  };
}

export async function readBuild3HistoricalReplay(env:ReplayEnv,input:{as_of?:string}={}){
  const asOf=input.as_of?new Date(input.as_of):new Date();
  if(Number.isNaN(asOf.getTime()))throw new Error('BUILD3_HISTORICAL_REPLAY_AS_OF_INVALID');
  const [fiveDr,edge]=await Promise.all([read5drReplay(env,asOf),readEdgeReplay(env,asOf)]);
  const integrity={
    historical_records_mutated:false,
    writes_performed:0,
    future_information_used_for_issuance:false,
    reconstructed_core_enters_official_efficacy:false,
    methodology_promotion_authorized:false,
  };
  return {
    version:BUILD3_HISTORICAL_REPLAY_VERSION,
    generated_at:new Date().toISOString(),
    as_of:asOf.toISOString(),
    mode:'READ_ONLY_HISTORICAL_ACCEPTANCE',
    scope:'ALL_RELEVANT_FROZEN_5DR_AND_EDGE_STOCK_RECORDS_AVAILABLE_TO_DATE',
    no_new_run_count_requirement:true,
    live_dependency:'ONE_PROSPECTIVE_AUTOMATION_SMOKE_ONLY',
    integrity,
    five_dr:fiveDr,
    edge_stocks:edge,
    acceptance:{
      source_population_accounted:
        fiveDr.accounted_forecasts===fiveDr.source_population.valid_forecasts&&
        edge.accounted_recommendations===edge.source_population.recommendations,
      official_vs_shadow_separated:true,
      not_scorable_is_explicit:true,
      historical_replay_can_close_engineering_population_gates:true,
      forward_shadow_remains_required_only_for_non_reconstructable_methodology_promotion:true,
    },
  };
}
