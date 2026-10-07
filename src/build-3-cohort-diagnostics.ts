import { neon } from '@neondatabase/serverless';
import { summarizeBuild3Truth, type Build3TruthMetricRow, type Build3TruthMetrics } from './build-3-truth-metrics';
import type { Build3MarketPhase } from './build-3-run-contract';
import type { Build3Regime } from './build-3-forecast-contract';

export const BUILD3_COHORT_DIAGNOSTICS_VERSION='MDOS_BUILD_3_COHORT_DIAGNOSTICS_V1' as const;

export type Build3CohortEventState='EVENT_SHOCK'|'NORMAL';

export type Build3CohortTruthRow=Build3TruthMetricRow&{
  regime:Build3Regime;
  evidence_quality:'VERIFIED'|'PARTIAL'|'MISSING'|'STALE';
  event_state:Build3CohortEventState;
};

export type Build3CohortMetric=Build3TruthMetrics['independent_metrics']&{
  raw_rows:number;
  independent_cells:number;
};

export type Build3CohortDiagnostics={
  version:typeof BUILD3_COHORT_DIAGNOSTICS_VERSION;
  generated_at:string;
  diagnostic_only:true;
  production_change_allowed:false;
  selection_rule:'FIRST_VALID_ISSUANCE_PER_ENGINE_INSTRUMENT_TARGET_SESSION_HORIZON';
  by_horizon:Record<string,Build3CohortMetric>;
  by_regime:Record<string,Build3CohortMetric>;
  by_instrument:Record<string,Build3CohortMetric>;
  by_run_time_bucket:Record<string,Build3CohortMetric>;
  by_evidence_quality:Record<string,Build3CohortMetric>;
  by_event_state:Record<string,Build3CohortMetric>;
};

function metric(rows:Build3CohortTruthRow[],generatedAt:string):Build3CohortMetric{
  const summary=summarizeBuild3Truth(rows,generatedAt);
  return {
    ...summary.independent_metrics,
    raw_rows:rows.length,
    independent_cells:summary.population.independent_cells,
  };
}

function grouped(
  rows:Build3CohortTruthRow[],
  key:(row:Build3CohortTruthRow)=>string,
  generatedAt:string,
):Record<string,Build3CohortMetric>{
  const groups=new Map<string,Build3CohortTruthRow[]>();
  for(const row of rows){
    const k=key(row);
    const current=groups.get(k)??[];
    current.push(row);
    groups.set(k,current);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([a],[b])=>a.localeCompare(b))
      .map(([k,v])=>[k,metric(v,generatedAt)])
  );
}

export function summarizeBuild3Cohorts(
  rows:Build3CohortTruthRow[],
  generatedAt:string=new Date().toISOString(),
):Build3CohortDiagnostics{
  if(Number.isNaN(Date.parse(generatedAt)))throw new Error('BUILD3_COHORT_GENERATED_AT_INVALID');
  const timestamp=new Date(generatedAt).toISOString();
  for(const row of rows){
    if(!['TREND','RANGE','TRANSITION','EVENT_SHOCK'].includes(row.regime))throw new Error('BUILD3_COHORT_REGIME_INVALID');
    if(!['VERIFIED','PARTIAL','MISSING','STALE'].includes(row.evidence_quality))throw new Error('BUILD3_COHORT_EVIDENCE_QUALITY_INVALID');
    if(row.event_state!==(row.regime==='EVENT_SHOCK'?'EVENT_SHOCK':'NORMAL'))throw new Error('BUILD3_COHORT_EVENT_STATE_MISMATCH');
  }
  return {
    version:BUILD3_COHORT_DIAGNOSTICS_VERSION,
    generated_at:timestamp,
    diagnostic_only:true,
    production_change_allowed:false,
    selection_rule:'FIRST_VALID_ISSUANCE_PER_ENGINE_INSTRUMENT_TARGET_SESSION_HORIZON',
    by_horizon:grouped(rows,row=>row.horizon,timestamp),
    by_regime:grouped(rows,row=>row.regime,timestamp),
    by_instrument:grouped(rows,row=>row.instrument.trim().toUpperCase(),timestamp),
    by_run_time_bucket:grouped(rows,row=>row.run_time_bucket,timestamp),
    by_evidence_quality:grouped(rows,row=>row.evidence_quality,timestamp),
    by_event_state:grouped(rows,row=>row.event_state,timestamp),
  };
}

export async function readBuild3CohortDiagnostics(
  databaseUrl:string|undefined,
  engine?:'5DR'|'EDGE_STOCKS',
):Promise<Build3CohortDiagnostics>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_COHORT_DATABASE_NOT_CONFIGURED');
  const sql=neon(databaseUrl);
  const rows=engine
    ?await sql`
      select o.engine,o.instrument,o.source_id,o.horizon,o.target_session,
             f.issued_at,f.regime,f.data_quality_state as evidence_quality,
             r.market_phase as run_time_bucket,
             o.direction_result,o.outer_touch,o.outer_close_hit,o.core_touch,o.core_close_hit,
             o.outer_efficacy_state,o.core_efficacy_state,o.outer_deviation_hit,o.core_deviation_hit,
             o.outer_challenger_3pct_hit,o.core_challenger_3pct_hit,
             o.outer_quality_status,o.core_quality_status,o.outer_range_deviation_pct,o.core_range_deviation_pct,
             o.normalized_centre_error,o.brier_score,o.probability_state,
             o.core_width_percent,o.outer_width_percent,o.scorability_state
        from build3_precision_outcomes o
        join build3_forecast_horizons f
          on f.engine=o.engine and f.source_id=o.source_id and f.horizon=o.horizon
        join build3_run_registry r
          on r.engine=o.engine and r.source_id=o.source_id
       where o.engine=${engine}
       order by o.instrument,o.target_session,f.issued_at,o.source_id,o.horizon
    `
    :await sql`
      select o.engine,o.instrument,o.source_id,o.horizon,o.target_session,
             f.issued_at,f.regime,f.data_quality_state as evidence_quality,
             r.market_phase as run_time_bucket,
             o.direction_result,o.outer_touch,o.outer_close_hit,o.core_touch,o.core_close_hit,
             o.outer_efficacy_state,o.core_efficacy_state,o.outer_deviation_hit,o.core_deviation_hit,
             o.outer_challenger_3pct_hit,o.core_challenger_3pct_hit,
             o.outer_quality_status,o.core_quality_status,o.outer_range_deviation_pct,o.core_range_deviation_pct,
             o.normalized_centre_error,o.brier_score,o.probability_state,
             o.core_width_percent,o.outer_width_percent,o.scorability_state
        from build3_precision_outcomes o
        join build3_forecast_horizons f
          on f.engine=o.engine and f.source_id=o.source_id and f.horizon=o.horizon
        join build3_run_registry r
          on r.engine=o.engine and r.source_id=o.source_id
       order by o.engine,o.instrument,o.target_session,f.issued_at,o.source_id,o.horizon
    `;
  const normalized:Build3CohortTruthRow[]=rows.map(row=>{
    const regime=String(row.regime) as Build3Regime;
    return {
      engine:String(row.engine) as Build3CohortTruthRow['engine'],
      instrument:String(row.instrument),
      source_id:String(row.source_id),
      horizon:String(row.horizon) as Build3CohortTruthRow['horizon'],
      target_session:new Date(String(row.target_session)).toISOString().slice(0,10),
      issued_at:new Date(String(row.issued_at)).toISOString(),
      run_time_bucket:String(row.run_time_bucket) as Build3MarketPhase,
      regime,
      evidence_quality:String(row.evidence_quality) as Build3CohortTruthRow['evidence_quality'],
      event_state:regime==='EVENT_SHOCK'?'EVENT_SHOCK':'NORMAL',
      direction_result:String(row.direction_result) as Build3CohortTruthRow['direction_result'],
      outer_touch:Boolean(row.outer_touch),
      outer_close_hit:Boolean(row.outer_close_hit),
      core_touch:Boolean(row.core_touch),
      core_close_hit:Boolean(row.core_close_hit),
      outer_efficacy_state:String(row.outer_efficacy_state) as Build3CohortTruthRow['outer_efficacy_state'],
      core_efficacy_state:String(row.core_efficacy_state) as Build3CohortTruthRow['core_efficacy_state'],
      outer_deviation_hit:row.outer_deviation_hit===null?null:Boolean(row.outer_deviation_hit),
      core_deviation_hit:row.core_deviation_hit===null?null:Boolean(row.core_deviation_hit),
      outer_challenger_3pct_hit:row.outer_challenger_3pct_hit===null?null:Boolean(row.outer_challenger_3pct_hit),
      core_challenger_3pct_hit:row.core_challenger_3pct_hit===null?null:Boolean(row.core_challenger_3pct_hit),
      outer_quality_status:String(row.outer_quality_status) as Build3CohortTruthRow['outer_quality_status'],
      core_quality_status:String(row.core_quality_status) as Build3CohortTruthRow['core_quality_status'],
      outer_range_deviation_pct:row.outer_range_deviation_pct===null?null:Number(row.outer_range_deviation_pct),
      core_range_deviation_pct:row.core_range_deviation_pct===null?null:Number(row.core_range_deviation_pct),
      normalized_centre_error:Number(row.normalized_centre_error),
      brier_score:row.brier_score===null?null:Number(row.brier_score),
      probability_state:String(row.probability_state) as Build3CohortTruthRow['probability_state'],
      core_width_percent:Number(row.core_width_percent),
      outer_width_percent:Number(row.outer_width_percent),
      scorability_state:String(row.scorability_state) as Build3CohortTruthRow['scorability_state'],
    };
  });
  return summarizeBuild3Cohorts(normalized);
}
