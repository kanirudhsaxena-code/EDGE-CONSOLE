import { neon } from '@neondatabase/serverless';
import { readBuild3DataQuality } from './build-3-data-quality';
import { buildNiftyBuild3Decision, persistBuild3Decision } from './build-3-decision';
import { readBuild3EvidenceSnapshot } from './build-3-evidence-snapshot';
import { persistBuild3Forecast, type Build3Forecast } from './build-3-forecast-contract';
import { buildNiftyBuild3Forecast, extractNiftyReferencePrice } from './build-3-nifty-forecast';
import { buildNiftyPrecisionPlan, persistBuild3PrecisionIssuance } from './build-3-precision';
import { readBuild3RunRegistryRecord } from './build-3-run-registry';
import { resolveBuild3TargetSessions } from './build-3-session-resolver';

const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

const finiteNumber=(value:unknown):number|null=>{
  const n=Number(value);
  return Number.isFinite(n)?n:null;
};
const text=(value:unknown):string|null=>{
  const out=String(value??'').trim();
  return out?out:null;
};

export function resolveFrozenNiftyProviderInstrumentKey(
  evidence:unknown,
  result:Record<string,unknown>,
):string|null{
  const execution=isObject(result.execution_snapshot)
    ?result.execution_snapshot
    :isObject(result.execution_plan)?result.execution_plan:{};
  const supplied=text(execution.provider_instrument_key??execution.instrument_key);
  if(supplied)return supplied;

  const recommendation=String(result.recommendation??'').trim().toUpperCase();
  const side=recommendation==='BUY_CE'?'CE':recommendation==='BUY_PE'?'PE':null;
  if(!side)return null;
  const strike=finiteNumber(execution.strike_price??execution.strike);
  if(strike===null)return null;
  const expiry=text(execution.expiry??execution.time_exit)?.slice(0,10)??null;

  const root=isObject(evidence)?evidence:{};
  const context=isObject(root.issuance_context)?root.issuance_context:{};
  const market=isObject(context.automated_market_evidence)?context.automated_market_evidence:{};
  const observations=Array.isArray(market.observations)?market.observations.filter(isObject):[];
  const keys:string[]=[];
  for(const observation of observations){
    if(String(observation.category??'').toUpperCase()!=='EXECUTION_RISK')continue;
    const data=isObject(observation.structured_data)?observation.structured_data:{};
    const selectedExpiry=text(data.selected_expiry)?.slice(0,10)??null;
    if(expiry&&selectedExpiry&&expiry!==selectedExpiry)continue;
    const rows=Array.isArray(data.sample_strikes)?data.sample_strikes.filter(isObject):[];
    for(const row of rows){
      const rowStrike=finiteNumber(row.strike??row.strike_price);
      if(rowStrike===null||Math.abs(rowStrike-strike)>1e-9)continue;
      const leg=isObject(row[side])?row[side] as Record<string,unknown>:{};
      const key=text(leg.instrument_key??leg.provider_instrument_key);
      if(key)keys.push(key);
    }
  }
  const unique=[...new Set(keys)];
  return unique.length===1?unique[0]:null;
}

function bindFrozenProviderInstrumentKey(
  evidence:unknown,
  result:Record<string,unknown>,
):Record<string,unknown>{
  const key=resolveFrozenNiftyProviderInstrumentKey(evidence,result);
  if(!key)return result;
  const hasSnapshot=isObject(result.execution_snapshot);
  const field=hasSnapshot?'execution_snapshot':'execution_plan';
  const current=isObject(result[field])?result[field] as Record<string,unknown>:{};
  return {...result,[field]:{...current,provider_instrument_key:key}};
}

export async function materializePersistedNiftyBuild3Forecast(
  databaseUrl:string|undefined,
  requestId:string,
):Promise<Build3Forecast>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_NIFTY_MATERIALIZE_DATABASE_NOT_CONFIGURED');
  if(!requestId.trim())throw new Error('BUILD3_NIFTY_MATERIALIZE_SOURCE_ID_REQUIRED');

  const registry=await readBuild3RunRegistryRecord(databaseUrl,'5DR',requestId);
  if(!registry)throw new Error('BUILD3_NIFTY_RUN_REGISTRY_MISSING');
  const evidence=await readBuild3EvidenceSnapshot(databaseUrl,'5DR',requestId);
  if(!evidence)throw new Error('BUILD3_NIFTY_EVIDENCE_SNAPSHOT_MISSING');
  const quality=await readBuild3DataQuality(databaseUrl,'5DR',requestId);
  if(!quality||!quality.valid_for_forecast||quality.overall_state!=='VERIFIED'){
    throw new Error('BUILD3_NIFTY_DATA_QUALITY_NOT_VERIFIED');
  }
  if(
    quality.evidence_snapshot_id!==evidence.snapshot_id||
    quality.evidence_hash!==evidence.evidence_hash||
    registry.instrument!==evidence.instrument
  )throw new Error('BUILD3_NIFTY_LINEAGE_MISMATCH');

  const sql=neon(databaseUrl);
  const rows=await sql`
    select req.run_id,req.status,ar.generated_at,ar.framework_version,ar.result
      from analysis_requests req
      join analysis_runs ar on ar.run_id=req.run_id and ar.engine='5DR'
     where req.engine='5DR' and req.request_id=${requestId}
     limit 1
  `;
  if(!rows.length)throw new Error('BUILD3_NIFTY_COMPLETED_RUN_MISSING');
  const row=rows[0];
  if(String(row.status)!=='COMPLETED')throw new Error('BUILD3_NIFTY_RUN_NOT_COMPLETED');
  if(!isObject(row.result))throw new Error('BUILD3_NIFTY_RESULT_INVALID');
  if(String(row.framework_version)!==registry.model_version)throw new Error('BUILD3_NIFTY_MODEL_VERSION_MISMATCH');

  const referencePrice=extractNiftyReferencePrice(evidence);
  if(referencePrice===null||!Number.isFinite(referencePrice)||referencePrice<=0){
    throw new Error('BUILD3_NIFTY_REFERENCE_PRICE_MISSING');
  }

  let forecast=buildNiftyBuild3Forecast({
    source_id:requestId,
    model_version:registry.model_version,
    issued_at:new Date(String(row.generated_at)).toISOString(),
    result:row.result as Record<string,unknown>,
    target_sessions:resolveBuild3TargetSessions(new Date(String(row.generated_at)).toISOString()),
    reference_price_p0:referencePrice,
    evidence_snapshot_id:evidence.snapshot_id,
    evidence_hash:evidence.evidence_hash,
  });
  const precision=buildNiftyPrecisionPlan(forecast);
  forecast=precision.forecast;
  forecast=await persistBuild3Forecast(databaseUrl,forecast);
  await persistBuild3PrecisionIssuance(databaseUrl,precision.issuance);
  const resultWithFrozenInstrument=bindFrozenProviderInstrumentKey(evidence.evidence,row.result as Record<string,unknown>);
  const decision=buildNiftyBuild3Decision(forecast,resultWithFrozenInstrument);
  await persistBuild3Decision(databaseUrl,decision);
  return forecast;
}
