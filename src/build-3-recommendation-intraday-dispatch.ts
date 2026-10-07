import { neon } from '@neondatabase/serverless';
import { build3MaturedThroughDate } from './build-3-outcome-evaluator';
import {
  dispatchBuild3RecommendationIntradayTruth,
  type EngineDispatchEnv,
  type EngineDispatchResult,
} from './engine-dispatch';

export const BUILD3_INTRADAY_DISPATCH_VERSION='MDOS_BUILD_3_INTRADAY_DISPATCH_V1' as const;

export type Build3IntradayDispatchResult={
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  provider_instrument_key:string;
  session_date:string;
  dispatch_state:EngineDispatchResult['status'];
  detail:string|null;
};

type Candidate={
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  provider_instrument_key:string;
  session_date:string;
};

async function recordDispatch(
  databaseUrl:string,
  candidate:Candidate,
  result:EngineDispatchResult,
  attemptedAt:string,
):Promise<void>{
  const sql=neon(databaseUrl);
  const payload={
    dispatch_version:BUILD3_INTRADAY_DISPATCH_VERSION,
    ...candidate,attempted_at:attemptedAt,dispatch_state:result.status,
    repository:result.repository,workflow:result.workflow,detail:result.detail??null,
  };
  await sql`
    insert into build3_recommendation_intraday_dispatch_attempts(
      dispatch_version,engine,instrument,source_id,provider_instrument_key,session_date,
      attempted_at,dispatch_state,detail,payload
    ) values(
      ${BUILD3_INTRADAY_DISPATCH_VERSION},${candidate.engine},${candidate.instrument},
      ${candidate.source_id},${candidate.provider_instrument_key},${candidate.session_date},
      ${attemptedAt},${result.status},${result.detail??null},${JSON.stringify(payload)}::jsonb
    )
  `;
}

export async function dispatchDueBuild3RecommendationIntradayTruth(
  env:EngineDispatchEnv&{DATABASE_URL?:string},
  options:{now?:Date;limit?:number}={},
):Promise<Build3IntradayDispatchResult[]>{
  if(!env.DATABASE_URL?.trim())throw new Error('BUILD3_INTRADAY_DISPATCH_DATABASE_NOT_CONFIGURED');
  const now=options.now??new Date();
  if(Number.isNaN(now.getTime()))throw new Error('BUILD3_INTRADAY_DISPATCH_NOW_INVALID');
  const limit=Math.max(1,Math.min(100,Math.floor(options.limit??25)));
  const maturedThrough=build3MaturedThroughDate(now);
  const sql=neon(env.DATABASE_URL);
  const rows=await sql`
    select d.engine,d.instrument,d.source_id,
           d.execution_snapshot->>'provider_instrument_key' as provider_instrument_key,
           f.target_session
      from build3_decisions d
      join build3_forecast_horizons f
        on f.engine=d.engine and f.source_id=d.source_id
      left join build3_recommendation_intraday_sources src
        on src.engine=d.engine and src.source_id=d.source_id
       and src.provider_instrument_key=d.execution_snapshot->>'provider_instrument_key'
       and src.session_date=f.target_session
      left join lateral (
        select a.dispatch_state,a.attempted_at
          from build3_recommendation_intraday_dispatch_attempts a
         where a.engine=d.engine and a.source_id=d.source_id
           and a.provider_instrument_key=d.execution_snapshot->>'provider_instrument_key'
           and a.session_date=f.target_session
         order by a.attempted_at desc
         limit 1
      ) latest on true
     where d.decision_state='ACTIONABLE'
       and coalesce(d.execution_snapshot->>'provider_instrument_key','')<>''
       and coalesce(d.execution_snapshot->>'lifecycle_end_at','')<>''
       and f.target_session <= ${maturedThrough}::date
       and f.target_session <= (
         (d.execution_snapshot->>'lifecycle_end_at')::timestamptz at time zone 'Asia/Kolkata'
       )::date
       and src.id is null
       and (
         latest.dispatch_state is null
         or latest.dispatch_state<>'DISPATCHED'
         or latest.attempted_at < ${new Date(now.getTime()-25*60_000).toISOString()}::timestamptz
       )
     order by f.target_session asc,d.issued_at asc
     limit ${limit}
  `;
  const results:Build3IntradayDispatchResult[]=[];
  for(const row of rows){
    const candidate:Candidate={
      engine:String(row.engine) as Candidate['engine'],
      instrument:String(row.instrument).toUpperCase(),
      source_id:String(row.source_id),
      provider_instrument_key:String(row.provider_instrument_key),
      session_date:new Date(String(row.target_session)).toISOString().slice(0,10),
    };
    const dispatch=await dispatchBuild3RecommendationIntradayTruth(
      env,candidate,env.FIVEDR_CALLBACK_URL??'',fetch,
    );
    const attemptedAt=new Date().toISOString();
    await recordDispatch(env.DATABASE_URL,candidate,dispatch,attemptedAt);
    results.push({
      ...candidate,dispatch_state:dispatch.status,detail:dispatch.detail??null,
    });
  }
  return results;
}
