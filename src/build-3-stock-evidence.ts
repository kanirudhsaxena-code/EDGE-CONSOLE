import { neon } from '@neondatabase/serverless';
import { build3EvidenceSnapshotRef, freezeBuild3EvidenceSnapshot, type Build3EvidenceSnapshot } from './build-3-evidence-snapshot';

type Env={DATABASE_URL?:string;EDGE_DATABASE_URL?:string};

export async function freezeBuild3StockEvidence(
  env:Env,
  input:{
    ticker:string;
    lifecycle_id:string;
    market_snapshot_id:string;
    research_bundle_id:string;
    auction_snapshot_id?:string|null;
    canonical_requested_at?:string|null;
    canonical_attempt_slot?:string|null;
  },
):Promise<Build3EvidenceSnapshot>{
  if(!env.EDGE_DATABASE_URL)throw new Error('BUILD3_STOCK_EVIDENCE_EDGE_DATABASE_NOT_CONFIGURED');
  const ticker=input.ticker.trim().toUpperCase();
  const sql=neon(env.EDGE_DATABASE_URL);

  const lifecycleRows=await sql`
    select lifecycle_id,ticker,trigger_type,target_session,canonical_requested_at,stage,
           market_snapshot_id,research_bundle_id,auction_snapshot_id,created_at,updated_at
      from edge_run_lifecycles
     where lifecycle_id=${input.lifecycle_id}
     limit 1
  `;
  if(!lifecycleRows.length)throw new Error('BUILD3_STOCK_EVIDENCE_LIFECYCLE_MISSING');
  const lifecycle=lifecycleRows[0];
  if(
    String(lifecycle.ticker).toUpperCase()!==ticker||
    String(lifecycle.market_snapshot_id??'')!==input.market_snapshot_id||
    String(lifecycle.research_bundle_id??'')!==input.research_bundle_id
  )throw new Error('BUILD3_STOCK_EVIDENCE_LIFECYCLE_MISMATCH');

  const marketRows=await sql`
    select snapshot_id,lifecycle_id,ticker,captured_at,provider,payload,payload_hash,status,inserted_at
      from edge_market_snapshots
     where snapshot_id=${input.market_snapshot_id}
       and lifecycle_id=${input.lifecycle_id}
       and ticker=${ticker}
     limit 1
  `;
  if(!marketRows.length||String(marketRows[0].status)!=='DATA_READY'){
    throw new Error('BUILD3_STOCK_EVIDENCE_MARKET_SNAPSHOT_INVALID');
  }

  const researchRows=await sql`
    select bundle_id,ticker,contract_version,research_authority,research_fresh_at,created_at,
           payload,payload_hash,status,lifecycle_id,market_snapshot_id,inserted_at
      from edge_research_bundles
     where bundle_id=${input.research_bundle_id}
       and ticker=${ticker}
       and lifecycle_id=${input.lifecycle_id}
       and market_snapshot_id=${input.market_snapshot_id}
     limit 1
  `;
  if(!researchRows.length||String(researchRows[0].status)!=='READY'){
    throw new Error('BUILD3_STOCK_EVIDENCE_RESEARCH_BUNDLE_INVALID');
  }

  let auction:Record<string,unknown>|null=null;
  if(input.auction_snapshot_id){
    const auctionRows=await sql`
      select auction_snapshot_id,lifecycle_id,ticker,captured_at,provider,source_ref,
             indicative_equilibrium_price,payload,payload_hash,status,inserted_at
        from edge_auction_snapshots
       where auction_snapshot_id=${input.auction_snapshot_id}
         and lifecycle_id=${input.lifecycle_id}
         and ticker=${ticker}
       limit 1
    `;
    if(!auctionRows.length||String(auctionRows[0].status)!=='AUCTION_READY'){
      throw new Error('BUILD3_STOCK_EVIDENCE_AUCTION_SNAPSHOT_INVALID');
    }
    auction=auctionRows[0] as Record<string,unknown>;
  }

  const evidence={
    dispatch_lineage:{
      ticker,
      lifecycle_id:input.lifecycle_id,
      market_snapshot_id:input.market_snapshot_id,
      research_bundle_id:input.research_bundle_id,
      auction_snapshot_id:input.auction_snapshot_id??null,
      canonical_requested_at:input.canonical_requested_at??null,
      canonical_attempt_slot:input.canonical_attempt_slot??null,
      holding_state:'UNKNOWN',
    },
    lifecycle:lifecycle as Record<string,unknown>,
    market_snapshot:marketRows[0] as Record<string,unknown>,
    research_bundle:researchRows[0] as Record<string,unknown>,
    auction_snapshot:auction,
  };

  return freezeBuild3EvidenceSnapshot(env.DATABASE_URL,{
    engine:'EDGE_STOCKS',
    instrument:ticker,
    source_id:input.lifecycle_id,
    evidence,
  });
}

export { build3EvidenceSnapshotRef };
