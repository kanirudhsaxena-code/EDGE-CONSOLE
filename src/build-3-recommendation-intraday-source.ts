import { neon } from '@neondatabase/serverless';
import { canonicalBuild3EvidenceJson } from './build-3-evidence-snapshot';
import type { Build3Engine } from './build-3-run-contract';

export const BUILD3_RECOMMENDATION_INTRADAY_SOURCE_VERSION='MDOS_BUILD_3_RECOMMENDATION_INTRADAY_SOURCE_V1' as const;

export type Build3MinuteCandle={
  timestamp:string;
  open:number;
  high:number;
  low:number;
  close:number;
  volume:number;
  open_interest:number;
};

export type Build3RecommendationIntradaySource={
  source_version:typeof BUILD3_RECOMMENDATION_INTRADAY_SOURCE_VERSION;
  engine:Build3Engine;
  instrument:string;
  source_id:string;
  provider_instrument_key:string;
  session_date:string;
  captured_at:string;
  source_ref:string;
  provider_hash:string;
  candle_interval_minutes:1;
  candles:Build3MinuteCandle[];
};

export type Build3RecommendationIntradaySourceInput={
  engine:Build3Engine;
  source_id:string;
  provider_instrument_key:string;
  session_date:string;
  captured_at:string;
  source_ref:string;
  candles:unknown[];
};

const nonEmpty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const sessionDate=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);

function istDate(value:string):string{
  const parsed=new Date(value);
  if(Number.isNaN(parsed.getTime()))throw new Error('BUILD3_INTRADAY_CANDLE_TIMESTAMP_INVALID');
  const shifted=new Date(parsed.getTime()+330*60_000);
  return shifted.toISOString().slice(0,10);
}

function normalizeCandle(raw:unknown,expectedDate:string):Build3MinuteCandle{
  if(!Array.isArray(raw)||raw.length<5)throw new Error('BUILD3_INTRADAY_CANDLE_SHAPE_INVALID');
  const timestamp=String(raw[0]??'');
  if(istDate(timestamp)!==expectedDate)throw new Error('BUILD3_INTRADAY_CANDLE_SESSION_MISMATCH');
  const open=Number(raw[1]),high=Number(raw[2]),low=Number(raw[3]),close=Number(raw[4]);
  const volume=raw[5]===undefined?0:Number(raw[5]);
  const openInterest=raw[6]===undefined?0:Number(raw[6]);
  if(![open,high,low,close,volume,openInterest].every(Number.isFinite))throw new Error('BUILD3_INTRADAY_CANDLE_VALUE_INVALID');
  if(open<=0||high<=0||low<=0||close<=0||volume<0||openInterest<0)throw new Error('BUILD3_INTRADAY_CANDLE_VALUE_INVALID');
  if(low>Math.min(open,close)||high<Math.max(open,close)||low>high)throw new Error('BUILD3_INTRADAY_CANDLE_OHLC_INVALID');
  return {timestamp:new Date(timestamp).toISOString(),open,high,low,close,volume,open_interest:openInterest};
}

async function sha256(text:string):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function prepareBuild3RecommendationIntradaySource(
  input:Build3RecommendationIntradaySourceInput,
  instrument:string,
):Promise<Build3RecommendationIntradaySource>{
  if(input.engine!=='5DR'&&input.engine!=='EDGE_STOCKS')throw new Error('BUILD3_INTRADAY_ENGINE_INVALID');
  if(!nonEmpty(input.source_id))throw new Error('BUILD3_INTRADAY_SOURCE_ID_REQUIRED');
  if(!nonEmpty(input.provider_instrument_key))throw new Error('BUILD3_INTRADAY_PROVIDER_KEY_REQUIRED');
  if(!sessionDate(input.session_date))throw new Error('BUILD3_INTRADAY_SESSION_DATE_INVALID');
  if(!nonEmpty(input.source_ref))throw new Error('BUILD3_INTRADAY_SOURCE_REF_REQUIRED');
  const captured=new Date(input.captured_at);
  if(Number.isNaN(captured.getTime()))throw new Error('BUILD3_INTRADAY_CAPTURED_AT_INVALID');
  if(!Array.isArray(input.candles)||input.candles.length===0||input.candles.length>600)throw new Error('BUILD3_INTRADAY_CANDLE_COUNT_INVALID');
  const candles=input.candles.map(row=>normalizeCandle(row,input.session_date))
    .sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
  const timestamps=new Set<string>();
  for(const candle of candles){
    if(timestamps.has(candle.timestamp))throw new Error('BUILD3_INTRADAY_CANDLE_DUPLICATE_TIMESTAMP');
    timestamps.add(candle.timestamp);
  }
  const providerHash=await sha256(canonicalBuild3EvidenceJson({
    provider_instrument_key:input.provider_instrument_key.trim(),
    session_date:input.session_date,
    candles,
  }));
  return {
    source_version:BUILD3_RECOMMENDATION_INTRADAY_SOURCE_VERSION,
    engine:input.engine,instrument:instrument.trim().toUpperCase(),source_id:input.source_id.trim(),
    provider_instrument_key:input.provider_instrument_key.trim(),
    session_date:input.session_date,captured_at:captured.toISOString(),source_ref:input.source_ref.trim(),
    provider_hash:providerHash,candle_interval_minutes:1,candles,
  };
}

export async function persistBuild3RecommendationIntradaySource(
  databaseUrl:string|undefined,
  input:Build3RecommendationIntradaySourceInput,
):Promise<Build3RecommendationIntradaySource>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_INTRADAY_DATABASE_NOT_CONFIGURED');
  const sql=neon(databaseUrl);
  const decisions=await sql`
    select instrument,execution_snapshot
      from build3_decisions
     where engine=${input.engine} and source_id=${input.source_id}
     limit 1
  `;
  if(decisions.length!==1)throw new Error('BUILD3_INTRADAY_DECISION_NOT_FOUND');
  const snapshot=decisions[0].execution_snapshot as Record<string,unknown>;
  const frozenKey=String(snapshot?.provider_instrument_key??'').trim();
  if(!frozenKey)throw new Error('BUILD3_INTRADAY_FROZEN_PROVIDER_KEY_MISSING');
  if(frozenKey!==input.provider_instrument_key.trim())throw new Error('BUILD3_INTRADAY_PROVIDER_KEY_MISMATCH');
  const prepared=await prepareBuild3RecommendationIntradaySource(input,String(decisions[0].instrument));
  await sql`
    insert into build3_recommendation_intraday_sources(
      source_version,engine,instrument,source_id,provider_instrument_key,session_date,
      captured_at,source_ref,provider_hash,candle_interval_minutes,candles,payload
    ) values(
      ${prepared.source_version},${prepared.engine},${prepared.instrument},${prepared.source_id},
      ${prepared.provider_instrument_key},${prepared.session_date},${prepared.captured_at},
      ${prepared.source_ref},${prepared.provider_hash},1,${JSON.stringify(prepared.candles)}::jsonb,
      ${JSON.stringify(prepared)}::jsonb
    )
    on conflict (engine,source_id,provider_instrument_key,session_date) do nothing
  `;
  const rows=await sql`
    select payload from build3_recommendation_intraday_sources
     where engine=${prepared.engine} and source_id=${prepared.source_id}
       and provider_instrument_key=${prepared.provider_instrument_key}
       and session_date=${prepared.session_date}::date
     limit 1
  `;
  if(rows.length!==1)throw new Error('BUILD3_INTRADAY_READBACK_MISSING');
  const stored=rows[0].payload as Build3RecommendationIntradaySource;
  if(canonicalBuild3EvidenceJson(stored)!==canonicalBuild3EvidenceJson(prepared)){
    throw new Error('BUILD3_INTRADAY_IMMUTABLE_CONFLICT');
  }
  return stored;
}

export async function readBuild3RecommendationIntradaySources(
  databaseUrl:string|undefined,
  engine:Build3Engine,
  sourceId:string,
):Promise<Build3RecommendationIntradaySource[]>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_INTRADAY_DATABASE_NOT_CONFIGURED');
  const sql=neon(databaseUrl);
  const rows=await sql`
    select payload from build3_recommendation_intraday_sources
     where engine=${engine} and source_id=${sourceId}
     order by session_date asc
  `;
  return rows.map(row=>row.payload as Build3RecommendationIntradaySource);
}
