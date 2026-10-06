import { neon } from '@neondatabase/serverless';

export const BUILD3_TRUTH_METRICS_VERSION='MDOS_BUILD_3_TRUTH_METRICS_V1' as const;

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
  core_touch_rate_pct:number|null;
  core_close_hit_rate_pct:number|null;
  outer_touch_rate_pct:number|null;
  outer_close_hit_rate_pct:number|null;
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
}

function metricSet(rows:Build3TruthMetricRow[]):MetricSet{
  const directionRows=rows.filter(row=>row.direction_result==='HIT'||row.direction_result==='MISS');
  const brier=rows
    .filter(row=>row.probability_state==='SCORABLE'&&finite(row.brier_score))
    .map(row=>Number(row.brier_score));
  return {
    samples:rows.length,
    direction_accuracy_pct:pct(directionRows.filter(row=>row.direction_result==='HIT').length,directionRows.length),
    core_touch_rate_pct:pct(rows.filter(row=>row.core_touch).length,rows.length),
    core_close_hit_rate_pct:pct(rows.filter(row=>row.core_close_hit).length,rows.length),
    outer_touch_rate_pct:pct(rows.filter(row=>row.outer_touch).length,rows.length),
    outer_close_hit_rate_pct:pct(rows.filter(row=>row.outer_close_hit).length,rows.length),
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
             o.core_touch,o.core_close_hit,o.normalized_centre_error,o.brier_score,
             o.probability_state,o.core_width_percent,o.outer_width_percent,o.scorability_state
        from build3_precision_outcomes o
        join build3_forecast_horizons f
          on f.engine=o.engine and f.source_id=o.source_id and f.horizon=o.horizon
       where o.engine=${engine}
       order by o.target_session,f.issued_at,o.source_id,o.horizon
    `
    :await sql`
      select o.engine,o.instrument,o.source_id,o.horizon,o.target_session,
             f.issued_at,o.direction_result,o.outer_touch,o.outer_close_hit,
             o.core_touch,o.core_close_hit,o.normalized_centre_error,o.brier_score,
             o.probability_state,o.core_width_percent,o.outer_width_percent,o.scorability_state
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
    normalized_centre_error:Number(row.normalized_centre_error),
    brier_score:row.brier_score===null?null:Number(row.brier_score),
    probability_state:String(row.probability_state) as Build3TruthMetricRow['probability_state'],
    core_width_percent:Number(row.core_width_percent),
    outer_width_percent:Number(row.outer_width_percent),
    scorability_state:String(row.scorability_state) as Build3TruthMetricRow['scorability_state'],
  }));
  return summarizeBuild3Truth(normalized);
}
