import { neon } from '@neondatabase/serverless';
import {
  persistBuild3RecommendationIntradaySource,
  prepareBuild3RecommendationIntradaySource,
  type Build3RecommendationIntradaySource,
  type Build3RecommendationIntradaySourceInput,
} from './build-3-recommendation-intraday-source';
import type { EngineDispatchEnv } from './engine-dispatch';

export const BUILD3_TRUTH_HANDOFF_VERSION='MDOS_BUILD_3_TRUTH_HANDOFF_V1' as const;
export const BUILD3_TRUTH_HANDOFF_BRANCH='state/build3-truth' as const;

export type Build3TruthHandoffEnv=EngineDispatchEnv&{
  DATABASE_URL?:string;
};

export type Build3TruthHandoffIdentity={
  engine:'5DR'|'EDGE_STOCKS';
  source_id:string;
  provider_instrument_key:string;
  session_date:string;
};

export type Build3TruthHandoffRecoveryResult=Build3TruthHandoffIdentity&{
  status:'RECOVERED'|'PENDING'|'INVALID'|'CONFIGURATION_BLOCKED';
  detail:string|null;
  candle_count?:number;
  provider_hash?:string;
};

const nonEmpty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
const dateOnly=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);

async function sha256Hex(value:string):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function build3TruthHandoffKey(identity:Build3TruthHandoffIdentity):Promise<string>{
  if(identity.engine!=='5DR'&&identity.engine!=='EDGE_STOCKS')throw new Error('BUILD3_TRUTH_HANDOFF_ENGINE_INVALID');
  if(!nonEmpty(identity.source_id)||!nonEmpty(identity.provider_instrument_key)||!dateOnly(identity.session_date)){
    throw new Error('BUILD3_TRUTH_HANDOFF_IDENTITY_INVALID');
  }
  return sha256Hex([
    identity.engine,
    identity.source_id.trim(),
    identity.provider_instrument_key.trim(),
    identity.session_date,
  ].join('|'));
}

export async function fetchBuild3TruthHandoff(
  env:Build3TruthHandoffEnv,
  identity:Build3TruthHandoffIdentity,
  fetcher:typeof fetch=fetch,
):Promise<Build3RecommendationIntradaySourceInput|null>{
  const repository=env.BUILD3_TRUTH_REPOSITORY?.trim()||'kanirudhsaxena-code/EDGE---V1';
  const token=env.GITHUB_ACTIONS_TOKEN?.trim();
  if(!token)throw new Error('BUILD3_TRUTH_HANDOFF_GITHUB_TOKEN_MISSING');
  const key=await build3TruthHandoffKey(identity);
  const path=`runtime/build3-truth/${key}.json`;
  const url=`https://api.github.com/repos/${repository}/contents/${path}?ref=${encodeURIComponent(BUILD3_TRUTH_HANDOFF_BRANCH)}`;
  const response=await fetcher(url,{
    method:'GET',
    headers:{
      'accept':'application/vnd.github.raw+json',
      'authorization':`Bearer ${token}`,
      'user-agent':'EDGE-CONSOLE-BUILD3-TRUTH-HANDOFF',
      'x-github-api-version':'2022-11-28',
    },
  });
  if(response.status===404)return null;
  if(response.status===401||response.status===403)throw new Error('BUILD3_TRUTH_HANDOFF_GITHUB_PERMISSION_BLOCKED');
  if(!response.ok)throw new Error(`BUILD3_TRUTH_HANDOFF_GITHUB_HTTP_${response.status}`);

  let body:Record<string,unknown>;
  try{
    const parsed=await response.json();
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('shape');
    body=parsed as Record<string,unknown>;
  }catch{
    throw new Error('BUILD3_TRUTH_HANDOFF_JSON_INVALID');
  }
  if(body.handoff_version!==BUILD3_TRUTH_HANDOFF_VERSION)throw new Error('BUILD3_TRUTH_HANDOFF_VERSION_INVALID');
  if(String(body.handoff_key??'')!==key)throw new Error('BUILD3_TRUTH_HANDOFF_KEY_MISMATCH');
  if(body.engine!==identity.engine)throw new Error('BUILD3_TRUTH_HANDOFF_ENGINE_MISMATCH');
  if(String(body.source_id??'')!==identity.source_id)throw new Error('BUILD3_TRUTH_HANDOFF_SOURCE_ID_MISMATCH');
  if(String(body.provider_instrument_key??'')!==identity.provider_instrument_key)throw new Error('BUILD3_TRUTH_HANDOFF_PROVIDER_KEY_MISMATCH');
  if(String(body.session_date??'')!==identity.session_date)throw new Error('BUILD3_TRUTH_HANDOFF_SESSION_MISMATCH');

  return {
    engine:identity.engine,
    source_id:identity.source_id,
    provider_instrument_key:identity.provider_instrument_key,
    session_date:identity.session_date,
    captured_at:String(body.captured_at??''),
    source_ref:String(body.source_ref??''),
    candles:Array.isArray(body.candles)?body.candles:[],
  };
}

export async function validateBuild3TruthHandoffWithoutPersist(
  env:Build3TruthHandoffEnv,
  input:Build3TruthHandoffIdentity&{instrument:string},
):Promise<Build3RecommendationIntradaySource|null>{
  const raw=await fetchBuild3TruthHandoff(env,input);
  if(!raw)return null;
  return prepareBuild3RecommendationIntradaySource(raw,input.instrument);
}

export async function recoverDispatchedBuild3TruthHandoffs(
  env:Build3TruthHandoffEnv,
  options:{limit?:number}={},
):Promise<Build3TruthHandoffRecoveryResult[]>{
  if(!env.DATABASE_URL?.trim())throw new Error('BUILD3_TRUTH_HANDOFF_DATABASE_NOT_CONFIGURED');
  const limit=Math.max(1,Math.min(100,Math.floor(options.limit??25)));
  const sql=neon(env.DATABASE_URL);
  const rows=await sql`
    select distinct on (a.engine,a.source_id,a.provider_instrument_key,a.session_date)
           a.engine,a.source_id,a.provider_instrument_key,a.session_date,
           d.instrument,a.attempted_at
      from build3_recommendation_intraday_dispatch_attempts a
      join build3_decisions d
        on d.engine=a.engine and d.source_id=a.source_id
      left join build3_recommendation_intraday_sources s
        on s.engine=a.engine and s.source_id=a.source_id
       and s.provider_instrument_key=a.provider_instrument_key
       and s.session_date=a.session_date
     where a.dispatch_state='DISPATCHED'
       and s.id is null
     order by a.engine,a.source_id,a.provider_instrument_key,a.session_date,a.attempted_at desc
     limit ${limit}
  `;
  const results:Build3TruthHandoffRecoveryResult[]=[];
  for(const row of rows){
    const identity:Build3TruthHandoffIdentity={
      engine:String(row.engine) as Build3TruthHandoffIdentity['engine'],
      source_id:String(row.source_id),
      provider_instrument_key:String(row.provider_instrument_key),
      session_date:new Date(String(row.session_date)).toISOString().slice(0,10),
    };
    try{
      const raw=await fetchBuild3TruthHandoff(env,identity);
      if(!raw){
        results.push({...identity,status:'PENDING',detail:'STATE_HANDOFF_NOT_PUBLISHED_YET'});
        continue;
      }
      const stored=await persistBuild3RecommendationIntradaySource(env.DATABASE_URL,raw);
      results.push({
        ...identity,status:'RECOVERED',detail:null,
        candle_count:stored.candles.length,provider_hash:stored.provider_hash,
      });
    }catch(error){
      const detail=error instanceof Error?error.message:String(error);
      const status=detail.includes('TOKEN_MISSING')?'CONFIGURATION_BLOCKED':'INVALID';
      results.push({...identity,status,detail});
    }
  }
  return results;
}
