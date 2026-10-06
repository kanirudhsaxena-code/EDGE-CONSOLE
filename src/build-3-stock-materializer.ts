import { neon } from '@neondatabase/serverless';
import { readBuild3DataQuality } from './build-3-data-quality';
import { readBuild3EvidenceSnapshot } from './build-3-evidence-snapshot';
import { persistBuild3Forecast, type Build3Forecast } from './build-3-forecast-contract';
import { buildStockBuild3Forecast, BUILD3_STOCK_SOURCE_PATH_VERSION, type Build3StockPathRow } from './build-3-stock-forecast';
import { readBuild3RunRegistryRecord } from './build-3-run-registry';
import { resolveBuild3TargetSessions } from './build-3-session-resolver';
import { getStockLifecycle } from './stock-lifecycle';

type Env={DATABASE_URL?:string;EDGE_DATABASE_URL?:string};
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=(value:unknown):number=>{
  const n=Number(value);
  if(!Number.isFinite(n))throw new Error('BUILD3_STOCK_NUMERIC_INVALID');
  return n;
};
const dateOnly=(value:unknown):string=>{
  const text=value instanceof Date?value.toISOString():String(value??'');
  const match=text.match(/^(\d{4}-\d{2}-\d{2})/);
  if(!match)throw new Error('BUILD3_STOCK_TARGET_DATE_INVALID');
  return match[1];
};

export async function materializePersistedStockBuild3Forecast(
  env:Env,
  lifecycleId:string,
):Promise<Build3Forecast>{
  if(!env.DATABASE_URL?.trim())throw new Error('BUILD3_STOCK_CONSOLE_DATABASE_NOT_CONFIGURED');
  if(!env.EDGE_DATABASE_URL?.trim())throw new Error('BUILD3_STOCK_EDGE_DATABASE_NOT_CONFIGURED');

  const lifecycle=await getStockLifecycle(env,lifecycleId);
  if(!lifecycle)throw new Error('BUILD3_STOCK_LIFECYCLE_MISSING');
  if(!['PERSISTED','PRESENTED'].includes(lifecycle.stage))throw new Error('BUILD3_STOCK_LIFECYCLE_NOT_PERSISTED');
  if(!lifecycle.recommendation_id)throw new Error('BUILD3_STOCK_RECOMMENDATION_ID_MISSING');

  const registry=await readBuild3RunRegistryRecord(env.DATABASE_URL,'EDGE_STOCKS',lifecycleId);
  if(!registry)throw new Error('BUILD3_STOCK_RUN_REGISTRY_MISSING');
  const evidence=await readBuild3EvidenceSnapshot(env.DATABASE_URL,'EDGE_STOCKS',lifecycleId);
  if(!evidence)throw new Error('BUILD3_STOCK_EVIDENCE_SNAPSHOT_MISSING');
  const quality=await readBuild3DataQuality(env.DATABASE_URL,'EDGE_STOCKS',lifecycleId);
  if(!quality||!quality.valid_for_forecast||quality.overall_state!=='VERIFIED'){
    throw new Error('BUILD3_STOCK_DATA_QUALITY_NOT_VERIFIED');
  }
  if(
    registry.instrument!==lifecycle.ticker||
    evidence.instrument!==lifecycle.ticker||
    quality.evidence_snapshot_id!==evidence.snapshot_id||
    quality.evidence_hash!==evidence.evidence_hash
  )throw new Error('BUILD3_STOCK_LINEAGE_MISMATCH');

  const edge=neon(env.EDGE_DATABASE_URL);
  const headers=await edge`
    select recommendation_id,path_version,source_run_id,issued_at,payload_hash
      from edge_stock_forecast_paths
     where recommendation_id=${lifecycle.recommendation_id}
     limit 1
  `;
  if(!headers.length)throw new Error('BUILD3_STOCK_G5_PATH_MISSING');
  const header=headers[0];
  if(String(header.path_version)!==BUILD3_STOCK_SOURCE_PATH_VERSION)throw new Error('BUILD3_STOCK_PATH_VERSION_INVALID');
  if(String(header.recommendation_id)!==lifecycle.recommendation_id||String(header.source_run_id)!==lifecycle.recommendation_id){
    throw new Error('BUILD3_STOCK_PRODUCER_IDENTITY_MISMATCH');
  }
  if(!String(header.payload_hash??'').trim())throw new Error('BUILD3_STOCK_G5_PATH_HASH_MISSING');

  const rawRows=await edge`
    select horizon_index,horizon_label,target_trading_date,direction,
           bull_probability,base_probability,bear_probability,expected_centre,
           outer_expected_zone_low,outer_expected_zone_high,evidence_basis,
           regime_context,verification_state,lineage
      from edge_stock_forecast_path_rows
     where recommendation_id=${lifecycle.recommendation_id}
     order by horizon_index
  `;
  if(rawRows.length!==5)throw new Error('BUILD3_STOCK_G5_PATH_COUNT_INVALID');
  const rows:Build3StockPathRow[]=rawRows.map((row:any,index:number)=>{
    if(Number(row.horizon_index)!==index)throw new Error('BUILD3_STOCK_G5_PATH_ORDER_INVALID');
    if(!isObject(row.lineage))throw new Error('BUILD3_STOCK_G5_LINEAGE_INVALID');
    return {
      horizon_label:String(row.horizon_label),
      target_trading_date:dateOnly(row.target_trading_date),
      direction:String(row.direction),
      bull_probability:finite(row.bull_probability),
      base_probability:finite(row.base_probability),
      bear_probability:finite(row.bear_probability),
      expected_centre:row.expected_centre===null?null:finite(row.expected_centre),
      outer_expected_zone_low:finite(row.outer_expected_zone_low),
      outer_expected_zone_high:finite(row.outer_expected_zone_high),
      evidence_basis:String(row.evidence_basis??''),
      regime_context:String(row.regime_context??''),
      verification_state:String(row.verification_state??''),
      lineage:row.lineage as Record<string,unknown>,
    };
  });

  const forecast=buildStockBuild3Forecast({
    ticker:lifecycle.ticker,
    source_id:lifecycleId,
    path_version:String(header.path_version),
    issued_at:new Date(String(header.issued_at)).toISOString(),
    target_sessions:resolveBuild3TargetSessions(new Date(String(header.issued_at)).toISOString()),
    rows,
    evidence_snapshot_id:evidence.snapshot_id,
    evidence_hash:evidence.evidence_hash,
  });
  return persistBuild3Forecast(env.DATABASE_URL,forecast);
}


export async function materializePendingBuild3StockForecasts(
  env:Env,
  limit=12,
):Promise<Record<string,unknown>[]>{
  if(!env.EDGE_DATABASE_URL?.trim()||!env.DATABASE_URL?.trim())return [];
  const edge=neon(env.EDGE_DATABASE_URL);
  const rows=await edge`
    select lifecycle_id,ticker,recommendation_id,stage,updated_at
      from edge_run_lifecycles
     where stage in ('PERSISTED','PRESENTED')
       and recommendation_id is not null
     order by updated_at desc
     limit ${Math.max(1,Math.min(50,limit))}
  `;
  const results:Record<string,unknown>[]=[];
  for(const row of rows){
    const lifecycleId=String(row.lifecycle_id);
    try{
      const forecast=await materializePersistedStockBuild3Forecast(env,lifecycleId);
      results.push({
        lifecycle_id:lifecycleId,ticker:String(row.ticker).toUpperCase(),
        recommendation_id:String(row.recommendation_id),status:'MATERIALIZED',
        forecast_version:forecast.forecast_version,horizon_count:forecast.horizons.length
      });
    }catch(error){
      const detail=error instanceof Error?error.message:String(error);
      results.push({
        lifecycle_id:lifecycleId,ticker:String(row.ticker).toUpperCase(),
        recommendation_id:String(row.recommendation_id),
        status:detail==='BUILD3_STOCK_RUN_REGISTRY_MISSING'?'LEGACY_NOT_APPLICABLE':'BLOCKED',
        detail
      });
    }
  }
  return results;
}
