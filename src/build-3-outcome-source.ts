import { neon } from '@neondatabase/serverless';
import { canonicalBuild3EvidenceJson } from './build-3-evidence-snapshot';
import { validateBuild3SessionOhlc, type Build3SessionOhlcSource } from './build-3-outcome-types';

export const BUILD3_OUTCOME_SOURCE_READER_VERSION='MDOS_BUILD_3_OUTCOME_SOURCE_READER_V1' as const;
export const BUILD3_SESSION_OHLC_SOURCE_VERSION='BUILD3_SESSION_OHLC_V1' as const;
export const BUILD3_NIFTY_DAILY_SERIES='5DR:NIFTY_PRICE_CANDLES:NIFTY_50:1d' as const;

export type Build3OutcomeSourceEnv={
  FIVEDR_DATABASE_URL?:string;
  EDGE_DATABASE_URL?:string;
};

type CacheRow={
  provider_id:unknown;
  source_semantic:unknown;
  document_sha256:unknown;
  dataset_sha256:unknown;
  latest_timestamp:unknown;
  record_count:unknown;
  document:unknown;
  updated_at:unknown;
};

type OutcomeSourceRequest={
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  target_session:string;
};

const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const hex64=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{64}$/i.test(value.trim());
const positive=(value:unknown):number=>{
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)throw new Error('BUILD3_OUTCOME_SOURCE_PRICE_INVALID');
  return n;
};
const iso=(value:unknown,code:string):string=>{
  const d=new Date(String(value??''));
  if(Number.isNaN(d.getTime()))throw new Error(code);
  return d.toISOString();
};
const dateOnly=(value:unknown,code:string):string=>{
  const text=String(value??'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))throw new Error(code);
  return text;
};
const istSessionDate=(value:unknown):string=>{
  const d=new Date(String(value??''));
  if(Number.isNaN(d.getTime()))throw new Error('BUILD3_OUTCOME_SOURCE_CANDLE_TIMESTAMP_INVALID');
  return new Date(d.getTime()+330*60_000).toISOString().slice(0,10);
};

const upstoxMonths:Record<string,string>={
  Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
  Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12',
};
const upstoxCorporateDate=(value:unknown):string|null=>{
  const text=String(value??'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;
  const match=text.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if(!match)return null;
  const month=upstoxMonths[match[2][0].toUpperCase()+match[2].slice(1).toLowerCase()];
  if(!month)return null;
  const day=String(Number(match[1])).padStart(2,'0');
  const normalized=`${match[3]}-${month}-${day}`;
  const parsed=new Date(normalized+'T00:00:00.000Z');
  return Number.isNaN(parsed.getTime())?null:normalized;
};
async function sha256Text(value:string):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export type Build3StockCorporateActionEvidence={
  snapshot_id:string;
  captured_at:string;
  payload_hash:string;
  source_ref:string;
  payload:Record<string,unknown>;
};

export async function bindBuild3StockCorporateActionTruth(
  source:Build3SessionOhlcSource,
  evidence:Build3StockCorporateActionEvidence,
):Promise<Build3SessionOhlcSource>{
  if(source.engine!=='EDGE_STOCKS')throw new Error('BUILD3_CORPORATE_ACTION_STOCK_SOURCE_REQUIRED');
  if(!evidence.snapshot_id?.trim()||!hex64(evidence.payload_hash)){
    throw new Error('BUILD3_CORPORATE_ACTION_SNAPSHOT_IDENTITY_INVALID');
  }
  const providerHash=String(evidence.source_ref.match(/#sha256=([0-9a-f]{64})/i)?.[1]??'').toLowerCase();
  if(!hex64(providerHash))throw new Error('BUILD3_CORPORATE_ACTION_PROVIDER_HASH_INVALID');
  if(evidence.payload.status!=='success'||!Array.isArray(evidence.payload.data)){
    throw new Error('BUILD3_CORPORATE_ACTION_PAYLOAD_INVALID');
  }
  const actions=evidence.payload.data as unknown[];
  const parsed=actions.map((raw,index)=>{
    if(!isObject(raw))return {valid:false,index,name:'UNKNOWN',date:null as string|null};
    const name=String(raw.name??'UNKNOWN').trim()||'UNKNOWN';
    const date=upstoxCorporateDate(raw.expiry_date);
    return {valid:date!==null,index,name,date};
  });
  const allDatesValid=parsed.every(row=>row.valid);
  const onTarget=parsed.filter(row=>row.date===source.session_date);
  const state:Build3SessionOhlcSource['corporate_action_state']=!allDatesValid
    ?'UNKNOWN'
    :onTarget.length?'CONFLICT':'CLEAR';
  const basis=!allDatesValid
    ?'UPSTOX_POST_SESSION_CORPORATE_ACTION_DATES_UNVERIFIED'
    :onTarget.length
      ?`RAW_OHLC_BLOCKED_BY_CORPORATE_ACTION:${[...new Set(onTarget.map(row=>row.name))].join(',')}`
      :'UPSTOX_POST_SESSION_CORPORATE_ACTIONS_CLEAR';
  const capturedAt=[source.captured_at,evidence.captured_at]
    .map(value=>new Date(value))
    .sort((a,b)=>b.getTime()-a.getTime())[0];
  if(Number.isNaN(capturedAt.getTime()))throw new Error('BUILD3_CORPORATE_ACTION_CAPTURED_AT_INVALID');
  const compositeHash=await sha256Text(canonicalBuild3EvidenceJson({
    price_provider_hash:source.provider_hash,
    corporate_action_provider_hash:providerHash,
    corporate_action_snapshot_hash:evidence.payload_hash.toLowerCase(),
    corporate_action_state:state,
    target_session:source.session_date,
  }));
  const bound:Build3SessionOhlcSource={
    ...source,
    captured_at:capturedAt.toISOString(),
    source_ref:`${source.source_ref}|${evidence.source_ref};snapshot=${evidence.snapshot_id}`,
    provider_hash:compositeHash,
    corporate_action_state:state,
    adjustment_basis:basis,
  };
  const errors=validateBuild3SessionOhlc(bound);
  if(errors.length)throw new Error('BUILD3_OUTCOME_SOURCE_INVALID:'+errors.join(','));
  return bound;
}

function parseDocument(value:unknown):Record<string,unknown>{
  if(isObject(value))return value;
  if(typeof value==='string'){
    try{
      const parsed=JSON.parse(value);
      if(isObject(parsed))return parsed;
    }catch{}
  }
  throw new Error('BUILD3_OUTCOME_SOURCE_CACHE_DOCUMENT_INVALID');
}

function validateCacheRow(row:CacheRow,seriesId:string):Record<string,unknown>{
  const document=parseDocument(row.document);
  const rowDocumentHash=String(row.document_sha256??'').trim();
  const rowDatasetHash=String(row.dataset_sha256??'').trim();
  if(
    document.schema!=='market-cache-document-v1'||
    document.series_id!==seriesId||
    document.provider_id!=='UPSTOX'||
    document.source_semantic!=='UPSTOX_AUTHENTICATED'||
    String(row.provider_id)!=='UPSTOX'||
    String(row.source_semantic)!=='UPSTOX_AUTHENTICATED'
  )throw new Error('BUILD3_OUTCOME_SOURCE_CACHE_IDENTITY_INVALID');
  if(
    !hex64(rowDocumentHash)||!hex64(rowDatasetHash)||
    String(document.document_sha256??'').trim()!==rowDocumentHash||
    String(document.dataset_sha256??'').trim()!==rowDatasetHash
  )throw new Error('BUILD3_OUTCOME_SOURCE_CACHE_HASH_INVALID');
  const records=document.records;
  if(!Array.isArray(records)||Number(document.record_count)!==records.length||Number(row.record_count)!==records.length){
    throw new Error('BUILD3_OUTCOME_SOURCE_CACHE_COUNT_INVALID');
  }
  return document;
}

function recordForSession(document:Record<string,unknown>,targetSession:string):Record<string,unknown>|null{
  const records=document.records as unknown[];
  const matches=records.filter((raw)=>{
    if(!isObject(raw))throw new Error('BUILD3_OUTCOME_SOURCE_CACHE_RECORD_INVALID');
    const timestamp=String(raw.timestamp??'');
    return istSessionDate(timestamp)===targetSession;
  }) as Record<string,unknown>[];
  if(matches.length>1)throw new Error('BUILD3_OUTCOME_SOURCE_SESSION_AMBIGUOUS');
  return matches[0]??null;
}

function sourceFromRecord(
  row:CacheRow,
  document:Record<string,unknown>,
  record:Record<string,unknown>,
  request:OutcomeSourceRequest,
  seriesId:string,
):Build3SessionOhlcSource{
  const candle=record.candle;
  if(!Array.isArray(candle)||candle.length<5)throw new Error('BUILD3_OUTCOME_SOURCE_CANDLE_INVALID');
  const candleTimestamp=iso(candle[0],'BUILD3_OUTCOME_SOURCE_CANDLE_TIMESTAMP_INVALID');
  if(istSessionDate(candleTimestamp)!==request.target_session){
    throw new Error('BUILD3_OUTCOME_SOURCE_SESSION_MISMATCH');
  }
  const actual_open=positive(candle[1]);
  const actual_high=positive(candle[2]);
  const actual_low=positive(candle[3]);
  const actual_close=positive(candle[4]);

  let captured_at:string;
  let source_ref:string;
  let provider_hash:string;
  let corporate_action_state:Build3SessionOhlcSource['corporate_action_state'];
  let adjustment_basis:string;

  if(request.engine==='5DR'){
    const provenance=isObject(record.provenance)?record.provenance:null;
    const sourcePath=String(provenance?.source_path??'');
    const rawHash=String(provenance?.sha256??'').trim();
    const marketHash=String(record.market_sha256??'').trim();
    if(!sourcePath.startsWith('/')||!hex64(rawHash)||!hex64(marketHash)){
      throw new Error('BUILD3_OUTCOME_SOURCE_5DR_PROVENANCE_INVALID');
    }
    captured_at=iso(provenance?.received_at,'BUILD3_OUTCOME_SOURCE_CAPTURED_AT_INVALID');
    source_ref=`upstox:${sourcePath}#sha256=${rawHash};market_sha256=${marketHash};cache_series=${seriesId}`;
    provider_hash=rawHash.toLowerCase();
    corporate_action_state='NOT_APPLICABLE';
    adjustment_basis='INDEX_RAW_SESSION_OHLC';
  }else{
    const documentHash=String(document.document_sha256??'').trim();
    if(!hex64(documentHash))throw new Error('BUILD3_OUTCOME_SOURCE_EDGE_DOCUMENT_HASH_INVALID');
    captured_at=iso(row.updated_at,'BUILD3_OUTCOME_SOURCE_CAPTURED_AT_INVALID');
    source_ref=`upstox:cache:${seriesId}#sha256=${documentHash}`;
    provider_hash=documentHash.toLowerCase();
    // Price truth is available from the immutable cache. Corporate-action truth is
    // deliberately separate; until it is independently bound, stock headline scoring
    // fails closed rather than silently treating an unadjusted series as CLEAR.
    corporate_action_state='UNKNOWN';
    adjustment_basis='CORPORATE_ACTION_TRUTH_NOT_YET_BOUND';
  }

  const source:Build3SessionOhlcSource={
    source_version:BUILD3_SESSION_OHLC_SOURCE_VERSION,
    engine:request.engine,
    instrument:request.instrument.trim().toUpperCase(),
    session_date:request.target_session,
    captured_at,
    source_ref,
    provider_hash,
    actual_open,actual_high,actual_low,actual_close,
    corporate_action_state,
    adjustment_basis,
  };
  const errors=validateBuild3SessionOhlc(source);
  if(errors.length)throw new Error('BUILD3_OUTCOME_SOURCE_INVALID:'+errors.join(','));
  return source;
}

export function buildBuild3SessionOhlcFromCache(
  row:CacheRow,
  request:OutcomeSourceRequest,
  seriesId:string,
):Build3SessionOhlcSource|null{
  dateOnly(request.target_session,'BUILD3_OUTCOME_SOURCE_TARGET_SESSION_INVALID');
  if(!request.instrument?.trim()||!request.source_id?.trim())throw new Error('BUILD3_OUTCOME_SOURCE_IDENTITY_REQUIRED');
  const document=validateCacheRow(row,seriesId);
  const record=recordForSession(document,request.target_session);
  if(!record)return null;
  return sourceFromRecord(row,document,record,request,seriesId);
}

async function stockSeriesId(databaseUrl:string,request:OutcomeSourceRequest):Promise<string>{
  const edge=neon(databaseUrl);
  const rows=await edge`
    select ms.payload #>> '{market,instrument_key}' as instrument_key
      from edge_run_lifecycles l
      join edge_market_snapshots ms
        on ms.lifecycle_id=l.lifecycle_id
     where l.lifecycle_id=${request.source_id}
       and upper(l.ticker)=${request.instrument.trim().toUpperCase()}
       and ms.status='DATA_READY'
     limit 2
  `;
  if(rows.length!==1)throw new Error(rows.length?'BUILD3_OUTCOME_SOURCE_STOCK_IDENTITY_AMBIGUOUS':'BUILD3_OUTCOME_SOURCE_STOCK_IDENTITY_MISSING');
  const instrumentKey=String(rows[0].instrument_key??'').trim();
  if(!instrumentKey)throw new Error('BUILD3_OUTCOME_SOURCE_STOCK_INSTRUMENT_KEY_MISSING');
  return `EDGE_STOCK:PRICE_CANDLES:${instrumentKey}:1d`;
}

async function readCacheRow(databaseUrl:string,seriesId:string):Promise<CacheRow|null>{
  const sql=neon(databaseUrl);
  const rows=await sql`
    select provider_id,source_semantic,document_sha256,dataset_sha256,
           latest_timestamp,record_count,document,updated_at
      from market_data_cache.market_cache_documents
     where series_id=${seriesId}
     limit 1
  `;
  return rows.length?rows[0] as CacheRow:null;
}

async function readStockCorporateActionEvidence(
  databaseUrl:string,
  request:OutcomeSourceRequest,
):Promise<Build3StockCorporateActionEvidence|null>{
  const edge=neon(databaseUrl);
  const postClose=`${request.target_session}T10:30:00.000Z`;
  const rows=await edge`
    select snapshot_id,captured_at,payload_hash,payload
      from edge_market_snapshots
     where upper(ticker)=${request.instrument.trim().toUpperCase()}
       and status='DATA_READY'
       and captured_at >= ${postClose}::timestamptz
     order by captured_at asc,snapshot_id asc
     limit 20
  `;
  for(const row of rows){
    const payload=isObject(row.payload)?row.payload:null;
    const research=payload&&isObject(payload.provider_research)?payload.provider_research:null;
    const payloads=research&&isObject(research.payloads)?research.payloads:null;
    if(!payloads)continue;
    const entries=Object.entries(payloads).filter(([ref])=>/\/v2\/fundamentals\/[^/]+\/corporate-actions(?:\?|#)/.test(ref));
    if(entries.length>1)throw new Error('BUILD3_CORPORATE_ACTION_SOURCE_AMBIGUOUS');
    if(entries.length!==1)continue;
    const [sourceRef,rawPayload]=entries[0];
    if(!isObject(rawPayload))throw new Error('BUILD3_CORPORATE_ACTION_PAYLOAD_INVALID');
    const payloadHash=String(row.payload_hash??'').trim().toLowerCase();
    if(!hex64(payloadHash))throw new Error('BUILD3_CORPORATE_ACTION_SNAPSHOT_HASH_INVALID');
    return {
      snapshot_id:String(row.snapshot_id),
      captured_at:iso(row.captured_at,'BUILD3_CORPORATE_ACTION_CAPTURED_AT_INVALID'),
      payload_hash:payloadHash,
      source_ref:sourceRef,
      payload:rawPayload,
    };
  }
  return null;
}

export async function readBuild3OutcomeSource(
  env:Build3OutcomeSourceEnv,
  request:OutcomeSourceRequest,
):Promise<Build3SessionOhlcSource|null>{
  const normalized:OutcomeSourceRequest={
    ...request,
    instrument:request.instrument.trim().toUpperCase(),
    source_id:request.source_id.trim(),
    target_session:dateOnly(request.target_session,'BUILD3_OUTCOME_SOURCE_TARGET_SESSION_INVALID'),
  };
  let databaseUrl:string|undefined;
  let seriesId:string;
  if(normalized.engine==='5DR'){
    if(normalized.instrument!=='NIFTY')throw new Error('BUILD3_OUTCOME_SOURCE_5DR_INSTRUMENT_INVALID');
    databaseUrl=env.FIVEDR_DATABASE_URL;
    seriesId=BUILD3_NIFTY_DAILY_SERIES;
  }else{
    databaseUrl=env.EDGE_DATABASE_URL;
    if(!databaseUrl?.trim())throw new Error('BUILD3_OUTCOME_SOURCE_EDGE_DATABASE_NOT_CONFIGURED');
    seriesId=await stockSeriesId(databaseUrl,normalized);
  }
  if(!databaseUrl?.trim())throw new Error('BUILD3_OUTCOME_SOURCE_5DR_DATABASE_NOT_CONFIGURED');
  const row=await readCacheRow(databaseUrl,seriesId);
  if(!row)return null;
  const base=buildBuild3SessionOhlcFromCache(row,normalized,seriesId);
  if(!base||normalized.engine==='5DR')return base;
  const corporateActionEvidence=await readStockCorporateActionEvidence(databaseUrl,normalized);
  if(!corporateActionEvidence)return base;
  return bindBuild3StockCorporateActionTruth(base,corporateActionEvidence);
}

export async function persistBuild3SessionOhlcSource(
  databaseUrl:string|undefined,
  source:Build3SessionOhlcSource,
):Promise<Build3SessionOhlcSource>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_OUTCOME_DATABASE_NOT_CONFIGURED');
  const errors=validateBuild3SessionOhlc(source);
  if(errors.length)throw new Error('BUILD3_OUTCOME_SOURCE_INVALID:'+errors.join(','));
  const sql=neon(databaseUrl);
  await sql`
    insert into build3_session_ohlc_sources(
      source_version,engine,instrument,session_date,captured_at,source_ref,provider_hash,
      actual_open,actual_high,actual_low,actual_close,corporate_action_state,adjustment_basis,payload
    ) values(
      ${source.source_version},${source.engine},${source.instrument},${source.session_date},
      ${source.captured_at},${source.source_ref},${source.provider_hash},
      ${source.actual_open},${source.actual_high},${source.actual_low},${source.actual_close},
      ${source.corporate_action_state},${source.adjustment_basis},${JSON.stringify(source)}::jsonb
    )
    on conflict (engine,instrument,session_date,provider_hash) do nothing
  `;
  const rows=await sql`
    select payload
      from build3_session_ohlc_sources
     where engine=${source.engine}
       and instrument=${source.instrument}
       and session_date=${source.session_date}
       and provider_hash=${source.provider_hash}
     limit 1
  `;
  if(rows.length!==1)throw new Error('BUILD3_OUTCOME_SOURCE_READBACK_MISSING');
  const restored=rows[0].payload as Build3SessionOhlcSource;
  if(canonicalBuild3EvidenceJson(restored)!==canonicalBuild3EvidenceJson(source)){
    throw new Error('BUILD3_OUTCOME_SOURCE_IMMUTABLE_CONFLICT');
  }
  return restored;
}
