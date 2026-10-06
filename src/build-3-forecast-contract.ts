import { neon } from '@neondatabase/serverless';
import { BUILD3_HORIZONS, type Build3DataQualityState, type Build3Engine, type Build3Horizon } from './build-3-run-contract';
import { canonicalBuild3EvidenceJson } from './build-3-evidence-snapshot';

export const BUILD3_FORECAST_VERSION='MDOS_BUILD_3_FORECAST_V1' as const;
export type Build3Direction='BULL'|'RANGE'|'BEAR';
export type Build3Regime='TREND'|'RANGE'|'TRANSITION'|'EVENT_SHOCK';

export type Build3ProbabilityVector={BULL:number;RANGE:number;BEAR:number};
export type Build3Zone={low:number;high:number};

export type Build3ForecastHorizon={
  horizon:Build3Horizon;
  target_session:string;
  direction:Build3Direction;
  probabilities:Build3ProbabilityVector;
  regime:Build3Regime;
  reasoning:string;
  expected_centre:number;
  core_zone:Build3Zone;
  outer_zone:Build3Zone;
};

export type Build3Forecast={
  forecast_version:typeof BUILD3_FORECAST_VERSION;
  engine:Build3Engine;
  instrument:string;
  source_id:string;
  model_version:string;
  issued_at:string;
  reference_price_p0:number;
  evidence_snapshot_id:string;
  evidence_hash:string;
  data_quality_state:Build3DataQualityState;
  horizons:Build3ForecastHorizon[];
};

const isFinitePositive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const nonEmpty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
const dateOnly=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
const directions=new Set<Build3Direction>(['BULL','RANGE','BEAR']);
const regimes=new Set<Build3Regime>(['TREND','RANGE','TRANSITION','EVENT_SHOCK']);

export function validateBuild3Forecast(value:Build3Forecast):string[]{
  const errors:string[]=[];
  if(value.forecast_version!==BUILD3_FORECAST_VERSION)errors.push('forecast_version is invalid');
  if(value.engine!=='5DR'&&value.engine!=='EDGE_STOCKS')errors.push('engine is invalid');
  if(!nonEmpty(value.instrument))errors.push('instrument is mandatory');
  if(!nonEmpty(value.source_id))errors.push('source_id is mandatory');
  if(!nonEmpty(value.model_version))errors.push('model_version is mandatory');
  if(!nonEmpty(value.issued_at)||Number.isNaN(Date.parse(value.issued_at)))errors.push('issued_at must be a valid timestamp');
  if(!isFinitePositive(value.reference_price_p0))errors.push('reference_price_p0 must be positive');
  if(!nonEmpty(value.evidence_snapshot_id))errors.push('evidence_snapshot_id is mandatory');
  if(!/^[0-9a-f]{64}$/i.test(value.evidence_hash))errors.push('evidence_hash must be SHA-256');
  if(value.data_quality_state!=='VERIFIED')errors.push('data_quality_state must be VERIFIED for a valid Build 3.0 forecast');
  if(!Array.isArray(value.horizons)||value.horizons.length!==BUILD3_HORIZONS.length){
    errors.push('exactly five horizon rows are required');
    return errors;
  }
  const observed=value.horizons.map(row=>row.horizon);
  if(!BUILD3_HORIZONS.every((horizon,index)=>observed[index]===horizon)){
    errors.push('horizons must be ordered exactly D,D+1,D+2,D+3,D+4');
  }
  const sessions=value.horizons.map(row=>row.target_session);
  if(sessions.some(session=>!dateOnly(session)))errors.push('target_session must be YYYY-MM-DD');
  if(new Set(sessions).size!==sessions.length)errors.push('target sessions must be unique');
  for(let index=1;index<sessions.length;index++){
    if(sessions[index]<=sessions[index-1])errors.push('target sessions must be strictly increasing');
  }

  value.horizons.forEach((row,index)=>{
    const prefix=`horizons[${index}]`;
    if(!directions.has(row.direction))errors.push(`${prefix}.direction is invalid`);
    if(!regimes.has(row.regime))errors.push(`${prefix}.regime is invalid`);
    if(!nonEmpty(row.reasoning))errors.push(`${prefix}.reasoning is mandatory`);
    const probs=row.probabilities;
    const values=[probs?.BULL,probs?.RANGE,probs?.BEAR];
    if(values.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<0||x>100)){
      errors.push(`${prefix}.probabilities must be finite 0..100`);
    }else{
      const sum=values.reduce((acc,x)=>acc+Number(x),0);
      if(Math.abs(sum-100)>0.02)errors.push(`${prefix}.probabilities must sum to 100`);
      const selected=probs[row.direction];
      if(Math.abs(selected-Math.max(...values.map(Number)))>0.02){
        errors.push(`${prefix}.direction must match the highest probability`);
      }
    }
    const centre=row.expected_centre;
    const core=row.core_zone;
    const outer=row.outer_zone;
    if(!isFinitePositive(centre)||!isFinitePositive(core?.low)||!isFinitePositive(core?.high)||!isFinitePositive(outer?.low)||!isFinitePositive(outer?.high)){
      errors.push(`${prefix}.geometry must contain positive finite values`);
    }else if(!(outer.low<=core.low&&core.low<=centre&&centre<=core.high&&core.high<=outer.high)){
      errors.push(`${prefix}.geometry must satisfy outer.low <= core.low <= centre <= core.high <= outer.high`);
    }else if((core.high-core.low)>=(outer.high-outer.low)){
      errors.push(`${prefix}.Core Zone must be narrower than Outer Zone`);
    }
  });
  return errors;
}

export function assertBuild3Forecast(value:Build3Forecast):Build3Forecast{
  const errors=validateBuild3Forecast(value);
  if(errors.length)throw new Error(`BUILD3_FORECAST_INVALID:${errors.join('|')}`);
  return value;
}

export async function persistBuild3Forecast(
  databaseUrl:string|undefined,
  forecast:Build3Forecast,
):Promise<Build3Forecast>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_FORECAST_DATABASE_NOT_CONFIGURED');
  assertBuild3Forecast(forecast);
  const sql=neon(databaseUrl);
  const records=forecast.horizons.map((row,index)=>({
    forecast_version:forecast.forecast_version,
    engine:forecast.engine,
    instrument:forecast.instrument,
    source_id:forecast.source_id,
    model_version:forecast.model_version,
    issued_at:forecast.issued_at,
    reference_price_p0:forecast.reference_price_p0,
    evidence_snapshot_id:forecast.evidence_snapshot_id,
    evidence_hash:forecast.evidence_hash,
    data_quality_state:forecast.data_quality_state,
    horizon:row.horizon,
    horizon_index:index,
    target_session:row.target_session,
    direction:row.direction,
    bull_probability:row.probabilities.BULL,
    range_probability:row.probabilities.RANGE,
    bear_probability:row.probabilities.BEAR,
    regime:row.regime,
    reasoning:row.reasoning,
    expected_centre:row.expected_centre,
    core_low:row.core_zone.low,
    core_high:row.core_zone.high,
    outer_low:row.outer_zone.low,
    outer_high:row.outer_zone.high,
    payload:row,
  }));
  await sql`
    insert into build3_forecast_horizons(
      forecast_version,engine,instrument,source_id,model_version,issued_at,reference_price_p0,
      evidence_snapshot_id,evidence_hash,data_quality_state,horizon,horizon_index,target_session,
      direction,bull_probability,range_probability,bear_probability,regime,reasoning,
      expected_centre,core_low,core_high,outer_low,outer_high,payload
    )
    select
      x.forecast_version,x.engine,x.instrument,x.source_id,x.model_version,x.issued_at::timestamptz,x.reference_price_p0,
      x.evidence_snapshot_id,x.evidence_hash,x.data_quality_state,x.horizon,x.horizon_index,x.target_session::date,
      x.direction,x.bull_probability,x.range_probability,x.bear_probability,x.regime,x.reasoning,
      x.expected_centre,x.core_low,x.core_high,x.outer_low,x.outer_high,x.payload
    from jsonb_to_recordset(${JSON.stringify(records)}::jsonb) as x(
      forecast_version text,engine text,instrument text,source_id text,model_version text,issued_at text,reference_price_p0 double precision,
      evidence_snapshot_id text,evidence_hash text,data_quality_state text,horizon text,horizon_index integer,target_session text,
      direction text,bull_probability double precision,range_probability double precision,bear_probability double precision,regime text,reasoning text,
      expected_centre double precision,core_low double precision,core_high double precision,outer_low double precision,outer_high double precision,payload jsonb
    )
    on conflict (engine,source_id,horizon) do nothing
  `;
  const rows=await sql`
    select forecast_version,engine,instrument,source_id,model_version,issued_at,reference_price_p0,
           evidence_snapshot_id,evidence_hash,data_quality_state,horizon,horizon_index,target_session,payload
      from build3_forecast_horizons
     where engine=${forecast.engine} and source_id=${forecast.source_id}
     order by horizon_index
  `;
  if(rows.length!==5)throw new Error('BUILD3_FORECAST_READBACK_COUNT_MISMATCH');
  const restored:Build3Forecast={
    forecast_version:String(rows[0].forecast_version) as typeof BUILD3_FORECAST_VERSION,
    engine:String(rows[0].engine) as Build3Engine,
    instrument:String(rows[0].instrument),
    source_id:String(rows[0].source_id),
    model_version:String(rows[0].model_version),
    issued_at:new Date(String(rows[0].issued_at)).toISOString(),
    reference_price_p0:Number(rows[0].reference_price_p0),
    evidence_snapshot_id:String(rows[0].evidence_snapshot_id),
    evidence_hash:String(rows[0].evidence_hash),
    data_quality_state:String(rows[0].data_quality_state) as Build3DataQualityState,
    horizons:rows.map(row=>row.payload as Build3ForecastHorizon),
  };
  assertBuild3Forecast(restored);
  if(canonicalBuild3EvidenceJson(restored)!==canonicalBuild3EvidenceJson(forecast)){
    throw new Error('BUILD3_FORECAST_IMMUTABLE_CONFLICT');
  }
  return restored;
}
