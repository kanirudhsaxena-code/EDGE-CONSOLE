import { neon } from '@neondatabase/serverless';

export const BUILD3_TRUTH_METRICS_VERSION='MDOS_BUILD_3_TRUTH_METRICS_V2' as const;

export type Build3TruthMetricRow={
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  horizon:'D'|'D+1'|'D+2'|'D+3'|'D+4';
  target_session:string;
  issued_at:string;
  direction_result:'HIT'|'MISS'|'NOT_SCORABLE';
  outer_touch:boolean;
  outer_close_hit:boolean;
  core_touch:boolean;
  core_close_hit:boolean;
  outer_efficacy_state:'SCORABLE'|'NOT_SCORABLE';
  core_efficacy_state:'SCORABLE'|'NOT_SCORABLE';
  outer_deviation_hit:boolean|null;
  core_deviation_hit:boolean|null;
  outer_challenger_3pct_hit:boolean|null;
  core_challenger_3pct_hit:boolean|null;
  outer_quality_status:'GREEN'|'AMBER'|'RED'|'NOT_SCORABLE';
  core_quality_status:'GREEN'|'AMBER'|'RED'|'NOT_SCORABLE';
  outer_range_deviation_pct:number|null;
  core_range_deviation_pct:number|null;
  normalized_centre_error:number;
  brier_score:number|null;
  probability_state:'SCORABLE'|'NOT_SCORABLE';
  core_width_percent:number;
  outer_width_percent:number;
  scorability_state:'SCORABLE'|'NOT_SCORABLE';
};

type MetricSet={
  samples:number;
  direction_accuracy_pct:number|null;
  outer_zone_samples:number;
  outer_close_hit_rate_pct:number|null;
  outer_deviation_hit_rate_pct:number|null;
  outer_green_pct:number|null;
  outer_amber_pct:number|null;
  outer_red_pct:number|null;
  outer_challenger_3pct_hit_rate_pct:number|null;
  mean_outer_range_deviation_pct:number|null;
  core_zone_samples:number;
  core_close_hit_rate_pct:number|null;
  core_deviation_hit_rate_pct:number|null;
  core_green_pct:number|null;
  core_amber_pct:number|null;
  core_red_pct:number|null;
  core_challenger_3pct_hit_rate_pct:number|null;
  mean_core_range_deviation_pct:number|null;
  diagnostic_outer_touch_rate_pct:number|null;
  diagnostic_core_touch_rate_pct:number|null;
  mean_normalized_centre_error_pct:number|null;
  mean_brier_score:number|null;
  mean_core_width_pct:number|null;
  mean_outer_width_pct:number|null;
};

export type Build3TruthMetrics={
  metrics_version:typeof BUILD3_TRUTH_METRICS_VERSION;
  generated_at:string;
  diagnostic_only:true;
  official_efficacy_mutated:false;
  production_change_allowed:false;
  population:{
    raw_outcomes:number;
    scorable_outcomes:number;
    independent_cells:number;
    repeated_same_cell_outcomes:number;
    selection_rule:'FIRST_VALID_ISSUANCE_PER_ENGINE_INSTRUMENT_TARGET_SESSION_HORIZON';
    independence_key:'ENGINE|INSTRUMENT|TARGET_SESSION|HORIZON';
  };
  independent_metrics:MetricSet;
  all_observation_metrics:MetricSet;
  horizon_breakdown:Record<string,MetricSet>;
};

const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const pct=(numerator:number,denominator:number):number|null=>denominator?Number((numerator/denominator*100).toFixed(4)):null;
const mean=(values:number[]):number|null=>values.length
  ?Number((values.reduce((a,b)=>a+b,0)/values.length).toFixed(8))
  :null;

function validateRow(row:Build3TruthMetricRow):void{
  if(row.engine!=='5DR'&&row.engine!=='EDGE_STOCKS')throw new Error('BUILD3_TRUTH_METRICS_ENGINE_INVALID');
  if(!row.instrument?.trim()||!row.source_id?.trim())throw new Error('BUILD3_TRUTH_METRICS_IDENTITY_INVALID');
  if(!['D','D+1','D+2','D+3','D+4'].includes(row.horizon))throw new Error('BUILD3_TRUTH_METRICS_HORIZON_INVALID');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(row.target_session))throw new Error('BUILD3_TRUTH_METRICS_TARGET_SESSION_INVALID');
  if(Number.isNaN(Date.parse(row.issued_at)))throw new Error('BUILD3_TRUTH_METRICS_ISSUED_AT_INVALID');
  if(!finite(row.normalized_centre_error)||row.normalized_centre_error<0)throw new Error('BUILD3_TRUTH_METRICS_CENTRE_ERROR_INVALID');
  if(!finite(row.core_width_percent)||row.core_width_percent<0)throw new Error('BUILD3_TRUTH_METRICS_CORE_WIDTH_INVALID');
  if(!finite(row.outer_width_percent)||row.outer_width_percent<=0)throw new Error('BUILD3_TRUTH_METRICS_OUTER_WIDTH_INVALID');
  if(row.outer_efficacy_state==='SCORABLE'&&!finite(row.outer_range_deviation_pct))throw new Error('BUILD3_TRUTH_METRICS_OUTER_DEVIATION_MISSING');
  if(row.core_efficacy_state==='SCORABLE'&&!finite(row.core_range_deviation_pct))throw new Error('BUILD3_TRUTH_METRICS_CORE_DEVIATION_MISSING');
}

function zoneMetrics(rows:Build3TruthMetricRow[],zone:'outer'|'core'){
  const stateKey=zone==='outer'?'outer_efficacy_state':'core_efficacy_state';
  const closeKey=zone==='outer'?'outer_close_hit':'core_close_hit';
  const deviationKey=zone==='outer'?'outer_deviation_hit':'core_deviation_hit';
  const challengerKey=zone==='outer'?'outer_challenger_3pct_hit':'core_challenger_3pct_hit';
  const qualityKey=zone==='outer'?'outer_quality_status':'core_quality_status';
  const rangeKey=zone==='outer'?'outer_range_deviation_pct':'core_range_deviation_pct';
  const eligible=rows.filter(row=>row[stateKey]==='SCORABLE');
  const deviations=eligible.map(row=>row[rangeKey]).filter(finite);
  return {
    samples:eligible.length,
    close:pct(eligible.filter(row=>row[closeKey]===true).length,eligible.length),
    deviation:pct(eligible.filter(row=>row[deviationKey]===true).length,eligible.length),
    green:pct(eligible.filter(row=>row[qualityKey]==='GREEN').length,eligible.length),
    amber:pct(eligible.filter(row=>row[qualityKey]==='AMBER').length,eligible.length),
    red:pct(eligible.filter(row=>row[qualityKey]==='RED').length,eligible.length),
    challenger:pct(eligible.filter(row=>row[challengerKey]===true).length,eligible.length),
    meanDeviation:mean(deviations),
  };
}

function metricSet(rows:Build3TruthMetricRow[]):MetricSet{
  const directionRows=rows.filter(row=>row.direction_result==='HIT'||row.direction_result==='MISS');
  const brier=rows
    .filter(row=>row.probability_state==='SCORABLE'&&finite(row.brier_score))
    .map(row=>Number(row.brier_score));
  const outer=zoneMetrics(rows,'outer');
  const core=zoneMetrics(rows,'core');
  return {
    samples:rows.length,
    direction_accuracy_pct:pct(directionRows.filter(row=>row.direction_result==='HIT').length,directionRows.length),
    outer_zone_samples:outer.samples,
    outer_close_hit_rate_pct:outer.close,
    outer_deviation_hit_rate_pct:outer.deviation,
    outer_green_pct:outer.green,
    outer_amber_pct:outer.amber,
    outer_red_pct:outer.red,
    outer_challenger_3pct_hit_rate_pct:outer.challenger,
    mean_outer_range_deviation_pct:outer.meanDeviation,
    core_zone_samples:core.samples,
    core_close_hit_rate_pct:core.close,
    core_deviation_hit_rate_pct:core.deviation,
    core_green_pct:core.green,
    core_amber_pct:core.amber,
    core_red_pct:core.red,
    core_challenger_3pct_hit_rate_pct:core.challenger,
    mean_core_range_deviation_pct:core.meanDeviation,
    diagnostic_outer_touch_rate_pct:pct(rows.filter(row=>row.outer_touch).length,rows.length),
    diagnostic_core_touch_rate_pct:pct(rows.filter(row=>row.core_touch).length,rows.length),
    mean_normalized_centre_error_pct:mean(rows.map(row=>row.normalized_centre_error)),
    mean_brier_score:mean(brier),
    mean_core_width_pct:mean(rows.map(row=>row.core_width_percent)),
    mean_outer_width_pct:mean(rows.map(row=>row.outer_width_percent)),
  };
}

const cellKey=(row:Build3TruthMetricRow)=>[
  row.engine,row.instrument.trim().toUpperCase(),row.target_session,row.horizon,
].join('|');

export function selectIndependentBuild3TruthRows(rows:Build3TruthMetricRow[]):Build3TruthMetricRow[]{
  rows.forEach(validateRow);
  const selected=new Map<string,Build3TruthMetricRow>();
  const ordered=[...rows].sort((a,b)=>{
    const issued=Date.parse(a.issued_at)-Date.parse(b.issued_at);
    return issued||a.source_id.localeCompare(b.source_id);
  });
  for(const row of ordered){
    if(row.scorability_state!=='SCORABLE')continue;
    const key=cellKey(row);
    if(!selected.has(key))selected.set(key,row);
  }
  return [...selected.values()];
}

export function summarizeBuild3Truth(
  rows:Build3TruthMetricRow[],
  generatedAt:string=new Date().toISOString(),
):Build3TruthMetrics{
  if(Number.isNaN(Date.parse(generatedAt)))throw new Error('BUILD3_TRUTH_METRICS_GENERATED_AT_INVALID');
  rows.forEach(validateRow);
  const scorable=rows.filter(row=>row.scorability_state==='SCORABLE');
  const independent=selectIndependentBuild3TruthRows(scorable);
  const horizon_breakdown:Record<string,MetricSet>={};
  for(const horizon of ['D','D+1','D+2','D+3','D+4'] as const){
    horizon_breakdown[horizon]=metricSet(independent.filter(row=>row.horizon===horizon));
  }
  return {
    metrics_version:BUILD3_TRUTH_METRICS_VERSION,
    generated_at:new Date(generatedAt).toISOString(),
    diagnostic_only:true,
    official_efficacy_mutated:false,
    production_change_allowed:false,
    population:{
      raw_outcomes:rows.length,
      scorable_outcomes:scorable.length,
      independent_cells:independent.length,
      repeated_same_cell_outcomes:Math.max(0,scorable.length-independent.length),
      selection_rule:'FIRST_VALID_ISSUANCE_PER_ENGINE_INSTRUMENT_TARGET_SESSION_HORIZON',
      independence_key:'ENGINE|INSTRUMENT|TARGET_SESSION|HORIZON',
    },
    independent_metrics:metricSet(independent),
    all_observation_metrics:metricSet(scorable),
    horizon_breakdown,
  };
}

export async function readBuild3TruthMetrics(
  databaseUrl:string|undefined,
  engine?:'5DR'|'EDGE_STOCKS',
):Promise<Build3TruthMetrics>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_TRUTH_METRICS_DATABASE_NOT_CONFIGURED');
  const sql=neon(databaseUrl);
  const rows=engine
    ?await sql`
      select o.engine,o.instrument,o.source_id,o.horizon,o.target_session,
             f.issued_at,o.direction_result,o.outer_touch,o.outer_close_hit,
             o.core_touch,o.core_close_hit,
             o.outer_efficacy_state,o.core_efficacy_state,
             o.outer_deviation_hit,o.core_deviation_hit,
             o.outer_challenger_3pct_hit,o.core_challenger_3pct_hit,
             o.outer_quality_status,o.core_quality_status,
             o.outer_range_deviation_pct,o.core_range_deviation_pct,
             o.normalized_centre_error,o.brier_score,o.probability_state,
             o.core_width_percent,o.outer_width_percent,o.scorability_state
        from build3_precision_outcomes o
        join build3_forecast_horizons f
          on f.engine=o.engine and f.source_id=o.source_id and f.horizon=o.horizon
       where o.engine=${engine}
       order by o.target_session,f.issued_at,o.source_id,o.horizon
    `
    :await sql`
      select o.engine,o.instrument,o.source_id,o.horizon,o.target_session,
             f.issued_at,o.direction_result,o.outer_touch,o.outer_close_hit,
             o.core_touch,o.core_close_hit,
             o.outer_efficacy_state,o.core_efficacy_state,
             o.outer_deviation_hit,o.core_deviation_hit,
             o.outer_challenger_3pct_hit,o.core_challenger_3pct_hit,
             o.outer_quality_status,o.core_quality_status,
             o.outer_range_deviation_pct,o.core_range_deviation_pct,
             o.normalized_centre_error,o.brier_score,o.probability_state,
             o.core_width_percent,o.outer_width_percent,o.scorability_state
        from build3_precision_outcomes o
        join build3_forecast_horizons f
          on f.engine=o.engine and f.source_id=o.source_id and f.horizon=o.horizon
       order by o.engine,o.instrument,o.target_session,f.issued_at,o.source_id,o.horizon
    `;
  const normalized=rows.map(row=>({
    engine:String(row.engine) as Build3TruthMetricRow['engine'],
    instrument:String(row.instrument),
    source_id:String(row.source_id),
    horizon:String(row.horizon) as Build3TruthMetricRow['horizon'],
    target_session:new Date(String(row.target_session)).toISOString().slice(0,10),
    issued_at:new Date(String(row.issued_at)).toISOString(),
    direction_result:String(row.direction_result) as Build3TruthMetricRow['direction_result'],
    outer_touch:Boolean(row.outer_touch),
    outer_close_hit:Boolean(row.outer_close_hit),
    core_touch:Boolean(row.core_touch),
    core_close_hit:Boolean(row.core_close_hit),
    outer_efficacy_state:String(row.outer_efficacy_state) as Build3TruthMetricRow['outer_efficacy_state'],
    core_efficacy_state:String(row.core_efficacy_state) as Build3TruthMetricRow['core_efficacy_state'],
    outer_deviation_hit:row.outer_deviation_hit===null?null:Boolean(row.outer_deviation_hit),
    core_deviation_hit:row.core_deviation_hit===null?null:Boolean(row.core_deviation_hit),
    outer_challenger_3pct_hit:row.outer_challenger_3pct_hit===null?null:Boolean(row.outer_challenger_3pct_hit),
    core_challenger_3pct_hit:row.core_challenger_3pct_hit===null?null:Boolean(row.core_challenger_3pct_hit),
    outer_quality_status:String(row.outer_quality_status) as Build3TruthMetricRow['outer_quality_status'],
    core_quality_status:String(row.core_quality_status) as Build3TruthMetricRow['core_quality_status'],
    outer_range_deviation_pct:row.outer_range_deviation_pct===null?null:Number(row.outer_range_deviation_pct),
    core_range_deviation_pct:row.core_range_deviation_pct===null?null:Number(row.core_range_deviation_pct),
    normalized_centre_error:Number(row.normalized_centre_error),
    brier_score:row.brier_score===null?null:Number(row.brier_score),
    probability_state:String(row.probability_state) as Build3TruthMetricRow['probability_state'],
    core_width_percent:Number(row.core_width_percent),
    outer_width_percent:Number(row.outer_width_percent),
    scorability_state:String(row.scorability_state) as Build3TruthMetricRow['scorability_state'],
  }));
  return summarizeBuild3Truth(normalized);
}
