import { neon } from '@neondatabase/serverless';
import type { Build3ForecastHorizon } from './build-3-forecast-contract';
import { scoreBuild3HorizonOutcome } from './build-3-outcome-score';
import {
  persistBuild3SessionOhlcSource,
  readBuild3OutcomeSource,
  type Build3OutcomeSourceEnv,
} from './build-3-outcome-source';
import { persistBuild3HorizonOutcome } from './build-3-outcome-store';
import type { Build3PrecisionIssuance } from './build-3-precision';

export const BUILD3_OUTCOME_ATTEMPT_VERSION='MDOS_BUILD_3_OUTCOME_ATTEMPT_V1' as const;

export type Build3OutcomeEvaluatorEnv=Build3OutcomeSourceEnv&{
  DATABASE_URL?:string;
};

export type Build3OutcomeEvaluationResult={
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  horizon:string;
  target_session:string;
  status:'SCORED'|'BLOCKED_CORPORATE_ACTION'|'SOURCE_NOT_AVAILABLE'|'SOURCE_INVALID';
  detail?:string;
};

const isConfigurationError=(message:string)=>/DATABASE_NOT_CONFIGURED/.test(message);

export function build3MaturedThroughDate(now:Date=new Date()):string{
  if(Number.isNaN(now.getTime()))throw new Error('BUILD3_OUTCOME_NOW_INVALID');
  const local=new Date(now.getTime()+330*60_000);
  const localDate=local.toISOString().slice(0,10);
  const localMinutes=local.getUTCHours()*60+local.getUTCMinutes();
  if(localMinutes>=16*60)return localDate;
  return new Date(Date.parse(localDate+'T00:00:00.000Z')-86_400_000).toISOString().slice(0,10);
}

async function recordAttempt(
  databaseUrl:string,
  row:{
    engine:'5DR'|'EDGE_STOCKS';instrument:string;source_id:string;horizon:string;target_session:string;
  },
  state:'SOURCE_NOT_AVAILABLE'|'SOURCE_INVALID'|'BLOCKED_CORPORATE_ACTION'|'SCORED'|'ALREADY_SCORED',
  sourceRef:string|null,
  detail:string|null,
):Promise<void>{
  const sql=neon(databaseUrl);
  const attemptedAt=new Date().toISOString();
  const payload={
    attempt_version:BUILD3_OUTCOME_ATTEMPT_VERSION,
    engine:row.engine,instrument:row.instrument,source_id:row.source_id,
    horizon:row.horizon,target_session:row.target_session,attempted_at:attemptedAt,
    attempt_state:state,source_ref:sourceRef,detail,
  };
  await sql`
    insert into build3_outcome_attempts(
      attempt_version,engine,instrument,source_id,horizon,target_session,
      attempted_at,attempt_state,source_ref,detail,payload
    ) values(
      ${BUILD3_OUTCOME_ATTEMPT_VERSION},${row.engine},${row.instrument},${row.source_id},
      ${row.horizon},${row.target_session},${attemptedAt},${state},
      ${sourceRef},${detail},${JSON.stringify(payload)}::jsonb
    )
  `;
}

export async function evaluateMaturedBuild3Outcomes(
  env:Build3OutcomeEvaluatorEnv,
  options:{now?:Date;limit?:number}={},
):Promise<Build3OutcomeEvaluationResult[]>{
  if(!env.DATABASE_URL?.trim())throw new Error('BUILD3_OUTCOME_DATABASE_NOT_CONFIGURED');
  const databaseUrl=env.DATABASE_URL;
  const sql=neon(databaseUrl);
  const limit=Math.max(1,Math.min(100,Math.floor(options.limit??25)));
  const maturedThrough=build3MaturedThroughDate(options.now??new Date());
  const rows=await sql`
    select f.engine,f.instrument,f.source_id,f.horizon,f.target_session,
           f.reference_price_p0,f.payload as forecast_payload,p.payload as precision_payload
      from build3_forecast_horizons f
      join build3_precision_issuance p
        on p.engine=f.engine and p.source_id=f.source_id and p.horizon=f.horizon
      left join build3_precision_outcomes o
        on o.engine=f.engine and o.source_id=f.source_id and o.horizon=f.horizon
     where o.id is null
       and f.target_session <= ${maturedThrough}::date
     order by f.target_session asc,f.created_at asc,f.horizon_index asc
     limit ${limit}
  `;
  const results:Build3OutcomeEvaluationResult[]=[];
  for(const raw of rows){
    const identity={
      engine:String(raw.engine) as '5DR'|'EDGE_STOCKS',
      instrument:String(raw.instrument).toUpperCase(),
      source_id:String(raw.source_id),
      horizon:String(raw.horizon),
      target_session:new Date(String(raw.target_session)).toISOString().slice(0,10),
    };
    let source;
    try{
      source=await readBuild3OutcomeSource(env,{
        engine:identity.engine,instrument:identity.instrument,source_id:identity.source_id,
        target_session:identity.target_session,
      });
    }catch(error){
      const detail=error instanceof Error?error.message:String(error);
      if(isConfigurationError(detail))throw error;
      await recordAttempt(databaseUrl,identity,'SOURCE_INVALID',null,detail);
      results.push({...identity,status:'SOURCE_INVALID',detail});
      continue;
    }
    if(!source){
      await recordAttempt(databaseUrl,identity,'SOURCE_NOT_AVAILABLE',null,'IMMUTABLE_DAILY_CACHE_SESSION_NOT_AVAILABLE');
      results.push({...identity,status:'SOURCE_NOT_AVAILABLE',detail:'IMMUTABLE_DAILY_CACHE_SESSION_NOT_AVAILABLE'});
      continue;
    }
    const persistedSource=await persistBuild3SessionOhlcSource(databaseUrl,source);
    const forecastRow=raw.forecast_payload as Build3ForecastHorizon;
    const precision=raw.precision_payload as Build3PrecisionIssuance;
    const outcome=scoreBuild3HorizonOutcome({
      engine:identity.engine,
      instrument:identity.instrument,
      source_id:identity.source_id,
      reference_price_p0:Number(raw.reference_price_p0),
      row:forecastRow,
      precision,
      source:persistedSource,
    });
    await persistBuild3HorizonOutcome(databaseUrl,outcome);
    const blocked=outcome.scorability_state==='NOT_SCORABLE'&&
      ['UNKNOWN','CONFLICT'].includes(outcome.corporate_action_state);
    const status=blocked?'BLOCKED_CORPORATE_ACTION':'SCORED';
    const detail=blocked?outcome.scorability_reason??'CORPORATE_ACTION_NOT_SCORABLE':undefined;
    await recordAttempt(databaseUrl,identity,status,persistedSource.source_ref,detail??null);
    results.push({...identity,status,detail});
  }
  return results;
}
