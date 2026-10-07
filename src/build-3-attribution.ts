import { neon } from '@neondatabase/serverless';
import type { Build3Direction, Build3Regime } from './build-3-forecast-contract';
import type { Build3RecommendationClassification } from './build-3-efficacy-contract';
import type { Build3NoTradeClassification } from './build-3-no-trade-efficacy';

export const BUILD3_ATTRIBUTION_VERSION='MDOS_BUILD_3_ATTRIBUTION_V1' as const;
export const BUILD3_ATTRIBUTION_MIN_SAMPLE=10 as const;
export const BUILD3_ATTRIBUTION_STRONG_MIN_SAMPLE=30 as const;

export type Build3AttributionConfidence='INSUFFICIENT'|'DEVELOPING'|'STRONG';

export type Build3AttributionObservation={
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  horizon:'D'|'D+1'|'D+2'|'D+3'|'D+4';
  forecast_direction:Build3Direction;
  regime:Build3Regime;
  direction_result:'HIT'|'MISS'|'NOT_SCORABLE';
  outer_close_hit:boolean;
  core_close_hit:boolean;
  outer_quality_status:'GREEN'|'AMBER'|'RED'|'NOT_SCORABLE';
  core_quality_status:'GREEN'|'AMBER'|'RED'|'NOT_SCORABLE';
  outer_high_breach_points:number|null;
  outer_low_breach_points:number|null;
  core_high_breach_points:number|null;
  core_low_breach_points:number|null;
  component_scores:Record<string,number>;
  gate_results:Array<{gate:string;passed:boolean|null;observed:unknown;threshold:string|null}>;
  verified_inputs:string[];
  recommendation_classification:Build3RecommendationClassification|null;
  no_trade_classification:Build3NoTradeClassification|null;
};

export type Build3ObservationAttribution={
  version:typeof BUILD3_ATTRIBUTION_VERSION;
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  horizon:string;
  success_signals:string[];
  failure_signals:string[];
  unknown_direction_cause:boolean;
};

export type Build3AttributionInsight={
  signal:string;
  occurrences:number;
  eligible_observations:number;
  prevalence_pct:number;
  wilson_lower_95:number;
  confidence:Build3AttributionConfidence;
};

export type Build3AttributionSummary={
  version:typeof BUILD3_ATTRIBUTION_VERSION;
  generated_at:string;
  sample_size:number;
  successes:number;
  failures:number;
  success_insights:Build3AttributionInsight[];
  failure_insights:Build3AttributionInsight[];
  unknown_direction_misses:number;
  policy:{
    min_sample:typeof BUILD3_ATTRIBUTION_MIN_SAMPLE;
    strong_min_sample:typeof BUILD3_ATTRIBUTION_STRONG_MIN_SAMPLE;
    strong_requires_wilson_lower_95_gte:0.5;
    single_observation_never_changes_production:true;
  };
};

const COMPONENT_FAILURE:Record<string,string>={
  PRICE_STRUCTURE:'DIRECTION_EVIDENCE_ERROR:PRICE_STRUCTURE_CONFLICT',
  PVPO:'PVPO_ERROR:PVPO_CONFLICT',
  PARTICIPATION:'PARTICIPATION_SECTOR_CONFLICT',
  MACRO_CATALYSTS:'EVENT_MACRO_MISS:MACRO_CATALYST_CONFLICT',
};

function unique(values:string[]):string[]{
  return [...new Set(values.filter(Boolean))].sort();
}

function componentAligns(direction:Build3Direction,score:number):boolean{
  if(direction==='BULL')return score>0;
  if(direction==='BEAR')return score<0;
  return Math.abs(score)<15;
}

function componentConflicts(direction:Build3Direction,score:number):boolean{
  if(direction==='BULL')return score<0;
  if(direction==='BEAR')return score>0;
  return false;
}

export function attributeBuild3Observation(row:Build3AttributionObservation):Build3ObservationAttribution{
  const success:string[]=[];
  const failure:string[]=[];

  if(row.direction_result==='HIT'){
    success.push('DIRECTION_HIT');
    for(const [component,score] of Object.entries(row.component_scores)){
      if(Number.isFinite(score)&&componentAligns(row.forecast_direction,score)){
        success.push('ALIGNED_COMPONENT:'+component);
      }
    }
    for(const gate of row.gate_results){
      if(gate.passed===true)success.push('PASSED_GATE:'+String(gate.gate).toUpperCase());
    }
    for(const input of row.verified_inputs)success.push('VERIFIED_INPUT:'+input.toUpperCase());
  }

  let unknownDirection=false;
  if(row.direction_result==='MISS'){
    failure.push('DIRECTION_MISS');
    let supportedCause=false;
    for(const [component,score] of Object.entries(row.component_scores)){
      if(!Number.isFinite(score)||!componentConflicts(row.forecast_direction,score))continue;
      failure.push(COMPONENT_FAILURE[component]??('DIRECTION_EVIDENCE_ERROR:'+component+'_CONFLICT'));
      supportedCause=true;
    }
    const failedGateNames=row.gate_results
      .filter(gate=>gate.passed===false)
      .map(gate=>String(gate.gate).toUpperCase());
    if(failedGateNames.some(gate=>/EVENT|MACRO/.test(gate))){
      failure.push('EVENT_MACRO_MISS:FROZEN_GATE_CONFLICT');
      supportedCause=true;
    }
    if(failedGateNames.some(gate=>/PVPO/.test(gate))){
      failure.push('PVPO_ERROR:FROZEN_GATE_CONFLICT');
      supportedCause=true;
    }
    if(!supportedCause){
      failure.push('UNKNOWN_DIRECTION_CAUSE');
      unknownDirection=true;
    }
  }

  if(!row.outer_close_hit)failure.push('OUTER_CLOSE_MISS');
  if(!row.core_close_hit)failure.push('CORE_CLOSE_MISS');
  if((row.outer_high_breach_points??0)>0||(row.core_high_breach_points??0)>0)failure.push('HIGH_SIDE_BREACH');
  if((row.outer_low_breach_points??0)>0||(row.core_low_breach_points??0)>0)failure.push('LOW_SIDE_BREACH');
  if(row.outer_quality_status==='GREEN')success.push('OUTER_ZONE_GREEN');
  if(row.core_quality_status==='GREEN')success.push('CORE_ZONE_GREEN');
  if(row.outer_quality_status==='RED')failure.push('OUTER_ZONE_RED');
  if(row.core_quality_status==='RED')failure.push('CORE_ZONE_RED');

  if(row.horizon==='D'&&row.recommendation_classification){
    const c=row.recommendation_classification;
    if(c==='TARGET_ONLY')success.push('RECOMMENDATION_TARGET_ONLY');
    if(c==='SL_ONLY')failure.push('SL_ONLY');
    if(c==='DUAL_TOUCH')failure.push('DUAL_TOUCH');
    if(c==='TIMEOUT_NO_TARGET')failure.push('TIMEOUT_NO_TARGET');
  }
  if(row.horizon==='D'&&row.no_trade_classification){
    const c=row.no_trade_classification;
    if(c==='GOOD_AVOID')success.push('NO_TRADE_GOOD_AVOID');
    if(c==='MISSED_OPPORTUNITY')failure.push('NO_TRADE_MISSED_OPPORTUNITY');
    if(c==='EXECUTION_REJECTION')failure.push('EXECUTION_REJECTION');
    if(c==='DATA_FAILURE')failure.push('DATA_FAILURE');
    if(c==='EVIDENCE_CONFLICT')failure.push('EVIDENCE_CONFLICT');
  }

  return {
    version:BUILD3_ATTRIBUTION_VERSION,
    engine:row.engine,instrument:row.instrument,source_id:row.source_id,horizon:row.horizon,
    success_signals:unique(success),failure_signals:unique(failure),
    unknown_direction_cause:unknownDirection,
  };
}

function wilsonLower95(successes:number,total:number):number{
  if(total<=0)return 0;
  const z=1.959963984540054;
  const p=successes/total;
  const z2=z*z;
  const centre=p+z2/(2*total);
  const spread=z*Math.sqrt((p*(1-p)+z2/(4*total))/total);
  return Math.max(0,(centre-spread)/(1+z2/total));
}

function insight(signal:string,count:number,total:number):Build3AttributionInsight{
  const lower=wilsonLower95(count,total);
  const confidence:Build3AttributionConfidence=
    total>=BUILD3_ATTRIBUTION_STRONG_MIN_SAMPLE&&lower>=0.5?'STRONG':
    total>=BUILD3_ATTRIBUTION_MIN_SAMPLE?'DEVELOPING':'INSUFFICIENT';
  return {
    signal,occurrences:count,eligible_observations:total,
    prevalence_pct:total?Number((count/total*100).toFixed(4)):0,
    wilson_lower_95:Number(lower.toFixed(6)),
    confidence,
  };
}

function aggregateSignals(
  attributions:Build3ObservationAttribution[],
  field:'success_signals'|'failure_signals',
):Build3AttributionInsight[]{
  const counts=new Map<string,number>();
  for(const row of attributions){
    for(const signal of row[field])counts.set(signal,(counts.get(signal)??0)+1);
  }
  const total=attributions.length;
  return [...counts.entries()]
    .map(([signal,count])=>insight(signal,count,total))
    .sort((a,b)=>b.occurrences-a.occurrences||a.signal.localeCompare(b.signal));
}

export function summarizeBuild3Attribution(
  observations:Build3AttributionObservation[],
  generatedAt:string=new Date().toISOString(),
):Build3AttributionSummary{
  if(Number.isNaN(Date.parse(generatedAt)))throw new Error('BUILD3_ATTRIBUTION_GENERATED_AT_INVALID');
  const attributed=observations.map(attributeBuild3Observation);
  const successRows=attributed.filter(row=>row.success_signals.length>0);
  const failureRows=attributed.filter(row=>row.failure_signals.length>0);
  return {
    version:BUILD3_ATTRIBUTION_VERSION,
    generated_at:new Date(generatedAt).toISOString(),
    sample_size:observations.length,
    successes:successRows.length,
    failures:failureRows.length,
    success_insights:aggregateSignals(successRows,'success_signals'),
    failure_insights:aggregateSignals(failureRows,'failure_signals'),
    unknown_direction_misses:attributed.filter(row=>row.unknown_direction_cause).length,
    policy:{
      min_sample:BUILD3_ATTRIBUTION_MIN_SAMPLE,
      strong_min_sample:BUILD3_ATTRIBUTION_STRONG_MIN_SAMPLE,
      strong_requires_wilson_lower_95_gte:0.5,
      single_observation_never_changes_production:true,
    },
  };
}

function object(value:unknown):Record<string,unknown>|null{
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
}

function componentScores(evidence:unknown):Record<string,number>{
  const root=object(evidence);
  const engineInput=object(root?.engine_input);
  const rows=Array.isArray(engineInput?.evidence)?engineInput.evidence:[];
  for(const candidate of rows){
    const normalized=object(object(candidate)?.normalized);
    const scores=object(normalized?.component_scores);
    if(!scores)continue;
    const out:Record<string,number>={};
    for(const [key,value] of Object.entries(scores)){
      const n=Number(value);
      if(Number.isFinite(n))out[key.toUpperCase()]=n;
    }
    return out;
  }
  return {};
}

export async function readBuild3Attribution(
  databaseUrl:string|undefined,
  engine?:'5DR'|'EDGE_STOCKS',
):Promise<Build3AttributionSummary>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_ATTRIBUTION_DATABASE_NOT_CONFIGURED');
  const sql=neon(databaseUrl);
  const rows=engine
    ?await sql`
      select o.engine,o.instrument,o.source_id,o.horizon,
             f.direction as forecast_direction,f.regime,
             o.direction_result,o.outer_close_hit,o.core_close_hit,
             o.outer_quality_status,o.core_quality_status,
             o.outer_high_breach_points,o.outer_low_breach_points,
             o.core_high_breach_points,o.core_low_breach_points,
             es.payload as evidence_payload,d.gate_results,
             q.payload as quality_payload,
             re.classification as recommendation_classification,
             dox.outcome_classification as no_trade_classification
        from build3_precision_outcomes o
        join build3_forecast_horizons f
          on f.engine=o.engine and f.source_id=o.source_id and f.horizon=o.horizon
        join build3_evidence_snapshots es
          on es.engine=o.engine and es.source_id=o.source_id
        join build3_decisions d
          on d.engine=o.engine and d.source_id=o.source_id
        left join build3_data_quality_assessments q
          on q.engine=o.engine and q.source_id=o.source_id
        left join build3_recommendation_efficacy re
          on re.engine=o.engine and re.source_id=o.source_id
        left join build3_decision_outcomes dox
          on dox.engine=o.engine and dox.source_id=o.source_id
       where o.engine=${engine}
       order by o.target_session,o.source_id,o.horizon
    `
    :await sql`
      select o.engine,o.instrument,o.source_id,o.horizon,
             f.direction as forecast_direction,f.regime,
             o.direction_result,o.outer_close_hit,o.core_close_hit,
             o.outer_quality_status,o.core_quality_status,
             o.outer_high_breach_points,o.outer_low_breach_points,
             o.core_high_breach_points,o.core_low_breach_points,
             es.payload as evidence_payload,d.gate_results,
             q.payload as quality_payload,
             re.classification as recommendation_classification,
             dox.outcome_classification as no_trade_classification
        from build3_precision_outcomes o
        join build3_forecast_horizons f
          on f.engine=o.engine and f.source_id=o.source_id and f.horizon=o.horizon
        join build3_evidence_snapshots es
          on es.engine=o.engine and es.source_id=o.source_id
        join build3_decisions d
          on d.engine=o.engine and d.source_id=o.source_id
        left join build3_data_quality_assessments q
          on q.engine=o.engine and q.source_id=o.source_id
        left join build3_recommendation_efficacy re
          on re.engine=o.engine and re.source_id=o.source_id
        left join build3_decision_outcomes dox
          on dox.engine=o.engine and dox.source_id=o.source_id
       order by o.engine,o.instrument,o.target_session,o.source_id,o.horizon
    `;
  const observations:Build3AttributionObservation[]=rows.map(row=>{
    const quality=object(row.quality_payload);
    const required=Array.isArray(quality?.required_inputs)?quality.required_inputs:[];
    const verifiedInputs=required
      .filter(item=>object(item)?.state==='VERIFIED')
      .map(item=>String(object(item)?.input??''))
      .filter(Boolean);
    return {
      engine:String(row.engine) as Build3AttributionObservation['engine'],
      instrument:String(row.instrument),
      source_id:String(row.source_id),
      horizon:String(row.horizon) as Build3AttributionObservation['horizon'],
      forecast_direction:String(row.forecast_direction) as Build3Direction,
      regime:String(row.regime) as Build3Regime,
      direction_result:String(row.direction_result) as Build3AttributionObservation['direction_result'],
      outer_close_hit:Boolean(row.outer_close_hit),
      core_close_hit:Boolean(row.core_close_hit),
      outer_quality_status:String(row.outer_quality_status) as Build3AttributionObservation['outer_quality_status'],
      core_quality_status:String(row.core_quality_status) as Build3AttributionObservation['core_quality_status'],
      outer_high_breach_points:row.outer_high_breach_points===null?null:Number(row.outer_high_breach_points),
      outer_low_breach_points:row.outer_low_breach_points===null?null:Number(row.outer_low_breach_points),
      core_high_breach_points:row.core_high_breach_points===null?null:Number(row.core_high_breach_points),
      core_low_breach_points:row.core_low_breach_points===null?null:Number(row.core_low_breach_points),
      component_scores:componentScores(row.evidence_payload),
      gate_results:Array.isArray(row.gate_results)?row.gate_results as Build3AttributionObservation['gate_results']:[],
      verified_inputs:verifiedInputs,
      recommendation_classification:row.recommendation_classification===null?null:String(row.recommendation_classification) as Build3RecommendationClassification,
      no_trade_classification:row.no_trade_classification===null?null:String(row.no_trade_classification) as Build3NoTradeClassification,
    };
  });
  return summarizeBuild3Attribution(observations);
}
