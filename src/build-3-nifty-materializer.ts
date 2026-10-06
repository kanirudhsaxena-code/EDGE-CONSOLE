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
  const decision=buildNiftyBuild3Decision(forecast,row.result as Record<string,unknown>);
  await persistBuild3Decision(databaseUrl,decision);
  return forecast;
}
