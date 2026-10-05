import { neon } from '@neondatabase/serverless';

export type StockLifecycleStage=
  'RUN_CREATED'|'DATA_PENDING'|'DATA_READY'|'DATA_BLOCKED'|
  'RESEARCH_PENDING'|'RESEARCH_READY'|'RESEARCH_BLOCKED'|
  'RECONCILED'|'COMPUTE_PENDING'|'COMPUTED'|'COMPUTE_BLOCKED'|
  'PERSISTED'|'PRESENTED';

export type StockLifecycle={
  lifecycle_id:string;
  ticker:string;
  trigger_type:'USER'|'SCHEDULED';
  target_session:string|null;
  canonical_requested_at:string|null;
  stage:StockLifecycleStage;
  market_snapshot_id:string|null;
  research_bundle_id:string|null;
  auction_snapshot_id:string|null;
  recommendation_id:string|null;
  stage_detail:string|null;
  created_at:string;
  updated_at:string;
};

type Env={EDGE_DATABASE_URL?:string};

const validTicker=(value:string)=>/^[A-Z0-9._&-]{1,20}$/.test(value);
const lifecycleId=(date:string,ticker:string,mode:'PREOPEN'|'USER')=>`EDGE-LC-${date}-${ticker}-${mode}`;

export function preopenStockLifecycleId(date:string,ticker:string):string{
  const symbol=ticker.trim().toUpperCase();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!validTicker(symbol))throw new Error('invalid pre-open lifecycle identity');
  return lifecycleId(date,symbol,'PREOPEN');
}

export async function ensureStockLifecycle(
  env:Env,
  input:{lifecycle_id:string;ticker:string;trigger_type:'USER'|'SCHEDULED';target_session?:string|null;canonical_requested_at?:string|null}
):Promise<StockLifecycle>{
  if(!env.EDGE_DATABASE_URL)throw new Error('EDGE database is not configured');
  const symbol=input.ticker.trim().toUpperCase();
  if(!validTicker(symbol))throw new Error('invalid ticker');
  const sql=neon(env.EDGE_DATABASE_URL);
  await sql`
    insert into edge_run_lifecycles(
      lifecycle_id,ticker,trigger_type,target_session,canonical_requested_at,stage,stage_detail
    ) values(
      ${input.lifecycle_id},${symbol},${input.trigger_type},
      ${input.target_session??null},${input.canonical_requested_at??null},
      'RUN_CREATED','Governed lifecycle created; DATA stage not yet started'
    )
    on conflict (lifecycle_id) do nothing
  `;
  const row=await getStockLifecycle(env,input.lifecycle_id);
  if(!row)throw new Error('lifecycle readback failed');
  if(row.ticker!==symbol)throw new Error('lifecycle ticker mismatch');
  return row;
}

export async function getStockLifecycle(env:Env,id:string):Promise<StockLifecycle|null>{
  if(!env.EDGE_DATABASE_URL)throw new Error('EDGE database is not configured');
  const sql=neon(env.EDGE_DATABASE_URL);
  const rows=await sql`
    select lifecycle_id,ticker,trigger_type,target_session,canonical_requested_at,stage,
           market_snapshot_id,research_bundle_id,auction_snapshot_id,recommendation_id,stage_detail,created_at,updated_at
      from edge_run_lifecycles
     where lifecycle_id=${id}
     limit 1
  `;
  if(!rows.length)return null;
  const row=rows[0];
  return {
    lifecycle_id:String(row.lifecycle_id),
    ticker:String(row.ticker).toUpperCase(),
    trigger_type:String(row.trigger_type) as 'USER'|'SCHEDULED',
    target_session:row.target_session?String(row.target_session).slice(0,10):null,
    canonical_requested_at:row.canonical_requested_at?String(row.canonical_requested_at):null,
    stage:String(row.stage) as StockLifecycleStage,
    market_snapshot_id:row.market_snapshot_id?String(row.market_snapshot_id):null,
    research_bundle_id:row.research_bundle_id?String(row.research_bundle_id):null,
    auction_snapshot_id:row.auction_snapshot_id?String(row.auction_snapshot_id):null,
    recommendation_id:row.recommendation_id?String(row.recommendation_id):null,
    stage_detail:row.stage_detail?String(row.stage_detail):null,
    created_at:String(row.created_at),
    updated_at:String(row.updated_at),
  };
}

export async function markStockResearchPending(env:Env,id:string,snapshotId:string):Promise<StockLifecycle>{
  if(!env.EDGE_DATABASE_URL)throw new Error('EDGE database is not configured');
  const sql=neon(env.EDGE_DATABASE_URL);
  const updated=await sql`
    update edge_run_lifecycles
       set stage='RESEARCH_PENDING',
           stage_detail='Independent production-owned web research started after immutable DATA snapshot',
           updated_at=now()
     where lifecycle_id=${id}
       and market_snapshot_id=${snapshotId}
       and stage in ('DATA_READY','RESEARCH_PENDING','RESEARCH_BLOCKED')
     returning lifecycle_id
  `;
  if(!updated.length)throw new Error('lifecycle is not DATA_READY for research');
  const row=await getStockLifecycle(env,id);
  if(!row)throw new Error('lifecycle readback failed');
  return row;
}

export async function markStockResearchBlocked(env:Env,id:string,detail:string):Promise<void>{
  if(!env.EDGE_DATABASE_URL)return;
  const sql=neon(env.EDGE_DATABASE_URL);
  await sql`
    update edge_run_lifecycles
       set stage='RESEARCH_BLOCKED',stage_detail=${detail.slice(0,1000)},updated_at=now()
     where lifecycle_id=${id}
       and stage in ('DATA_READY','RESEARCH_PENDING','RESEARCH_BLOCKED')
  `;
}

export async function readMarketSnapshotPayload(
  env:Env,
  lifecycleId:string,
  snapshotId:string
):Promise<{ticker:string;captured_at:string;payload:Record<string,unknown>}|null>{
  if(!env.EDGE_DATABASE_URL)throw new Error('EDGE database is not configured');
  const sql=neon(env.EDGE_DATABASE_URL);
  const rows=await sql`
    select ticker,captured_at,payload,status
      from edge_market_snapshots
     where lifecycle_id=${lifecycleId}
       and snapshot_id=${snapshotId}
     limit 1
  `;
  if(!rows.length||String(rows[0].status)!=='DATA_READY')return null;
  const payload=rows[0].payload;
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return null;
  return {ticker:String(rows[0].ticker).toUpperCase(),captured_at:String(rows[0].captured_at),payload:payload as Record<string,unknown>};
}

export async function preopenLifecycleReadiness(env:Env,date:string,tickers:readonly string[]):Promise<StockLifecycle[]>{
  const out:StockLifecycle[]=[];
  for(const raw of tickers){
    const ticker=raw.trim().toUpperCase();
    const row=await getStockLifecycle(env,preopenStockLifecycleId(date,ticker));
    if(row)out.push(row);
  }
  return out;
}


export async function markStockDataBlocked(env:Env,id:string,detail:string):Promise<void>{
  if(!env.EDGE_DATABASE_URL)return;
  const sql=neon(env.EDGE_DATABASE_URL);
  await sql`
    update edge_run_lifecycles
       set stage='DATA_BLOCKED',stage_detail=${detail.slice(0,1000)},updated_at=now()
     where lifecycle_id=${id}
       and stage in ('RUN_CREATED','DATA_PENDING','DATA_BLOCKED')
  `;
}
