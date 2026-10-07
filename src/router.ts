import { neon } from '@neondatabase/serverless';
import app from './index';
import { assessCompleteness, isNonEmptyString, isObject, validateNormalizedEvidence, type JsonRecord } from './normalization';
import { assessEvidenceReadiness, REQUIRED_5DR_EVIDENCE_CATEGORIES } from './evidence-readiness';
import { componentVerificationStatus, validateEdgeStocksResult } from './edge-stocks';
import { checkEdgeAuctionWorkflowAccess, checkEdgeDataWorkflowAccess, checkEdgeWorkflowAccess, dispatchEdgeDataWorkflow, dispatchEdgeWorkflow, normalizeTickerCandidate, parseEdgeCommand } from './edge-command';
import { EDGE_RESEARCH_BUNDLE_VERSION, researchBundleCanPublish, validateEdgeResearchBundle } from './edge-research';
import { actorCanUseCanonicalEdge, isAccessIdentityEnforced, resolveAccessActor, type AccessIdentityEnv } from './access-identity';
import { buildFiveDrAssessmentFromDatabase } from './five-dr-assessment-builder';
import {
  ensureStockLifecycle,
  getStockLifecycle,
  markStockComputeDispatched,
  markStockDataBlocked,
  markStockResearchBlocked,
  markStockResearchPending,
  readMarketSnapshotPayload,
} from './stock-lifecycle';
import { produceStockSystemResearch } from './stock-system-research';
import { buildBuild3RunRegistryRecord, classifyBuild3MarketPhase, persistBuild3RunRegistryRecord, readBuild3RunRegistryRecord } from './build-3-run-registry';
import { build3EvidenceSnapshotRef, freezeBuild3StockEvidence } from './build-3-stock-evidence';
import { assessBuild3StockDataQuality, build3DataQualityRef, persistBuild3DataQuality } from './build-3-data-quality';
import { materializePersistedStockBuild3Forecast } from './build-3-stock-materializer';
import { build3PrecisionOutput, readBuild3NiftyPrecisionByRunId, readBuild3OutputPrecision } from './build-3-output-read';

type AiBinding={run:(model:string,input:Record<string,unknown>)=>Promise<unknown>};
type Env = AccessIdentityEnv & {
  ASSETS: Fetcher;
  AI:AiBinding;
  EVIDENCE_BUCKET: R2Bucket;
  DATABASE_URL?: string;
  EDGE_DATABASE_URL?: string;
  EDGE_GITHUB_TOKEN?: string;
  APP_ENV: string;
  OUTPUT_CONTRACT_VERSION: string;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' }
});

const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const integerOrZero = (value: unknown): number => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};


const dateOnly = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
};

async function testerEdgeSandboxGate(request:Request,env:Env):Promise<Response|null>{
  if(!isAccessIdentityEnforced(env))return null;
  const actor=await resolveAccessActor(request,env);
  if(!actor.authenticated)return json({error:'Authenticated Console identity is required'},401);
  if(actorCanUseCanonicalEdge(actor,env))return null;
  return json({
    error:'EDGE Stocks tester sandbox is not enabled yet',
    code:'EDGE_TESTER_SANDBOX_NOT_READY',
    detail:'Tester access is blocked from the canonical EDGE Stocks ledger until isolated sandbox persistence is available.'
  },403);
}

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('');
};


const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (isObject(value)) {
    return '{' + Object.keys(value).sort().map(
      key => JSON.stringify(key) + ':' + stableJson((value as JsonRecord)[key])
    ).join(',') + '}';
  }
  return JSON.stringify(value);
};

export async function persistEdgeResearchBundle(env: Env, body: unknown, expectedTicker?: string): Promise<{ bundleId?: string; error?: string; status?: number; contractVersion?: string }> {
  if (!env.EDGE_DATABASE_URL) return { error: 'EDGE database is not configured', status: 503 };
  const assessment = researchBundleCanPublish(body);
  if (!assessment.ready || !isObject(body)) return { error: 'EDGE research bundle validation failed: ' + assessment.errors.join('; '), status: 422 };

  const ticker = String(body.ticker).toUpperCase();
  if (expectedTicker && ticker !== expectedTicker.toUpperCase()) return { error: 'research bundle ticker does not match resolved EDGE ticker', status: 422 };

  const bundleId = String(body.bundle_id);
  const contractVersion = String(body.contract_version);
  const authority = String(body.research_authority);
  const lifecycleId = isNonEmptyString(body.lifecycle_id) ? String(body.lifecycle_id) : null;
  const marketSnapshotId = isNonEmptyString(body.market_snapshot_id) ? String(body.market_snapshot_id) : null;
  const researchFreshAt = String(body.research_fresh_at);
  const payloadText = JSON.stringify(body);
  const payloadHash = await sha256Hex(payloadText);
  const sql = neon(env.EDGE_DATABASE_URL);

  if (contractVersion === EDGE_RESEARCH_BUNDLE_VERSION) {
    if (!lifecycleId || !marketSnapshotId) return { error: 'V2 research lifecycle identity is missing', status: 422 };
    const lineage = await sql`
      select l.ticker,l.stage,l.market_snapshot_id,s.captured_at,s.status
        from edge_run_lifecycles l
        join edge_market_snapshots s
          on s.lifecycle_id=l.lifecycle_id
         and s.snapshot_id=${marketSnapshotId}
       where l.lifecycle_id=${lifecycleId}
       limit 1
    `;
    if (!lineage.length) return { error: 'V2 research market snapshot lineage was not found', status: 409 };
    const row=lineage[0];
    if (String(row.ticker).toUpperCase() !== ticker) return { error: 'V2 research lifecycle ticker mismatch', status: 409 };
    if (String(row.market_snapshot_id ?? '') !== marketSnapshotId || String(row.status) !== 'DATA_READY') {
      return { error: 'V2 research market snapshot is not DATA_READY', status: 409 };
    }
    if (!['DATA_READY','RESEARCH_PENDING','RESEARCH_READY'].includes(String(row.stage))) {
      return { error: 'V2 research lifecycle is not eligible for research', status: 409 };
    }
    const capturedAt=Date.parse(String(row.captured_at));
    const researchedAt=Date.parse(researchFreshAt);
    if (!Number.isFinite(capturedAt) || !Number.isFinite(researchedAt) || researchedAt < capturedAt) {
      return { error: 'V2 research must be produced after its immutable DATA snapshot', status: 409 };
    }
  }

  const existing = await sql`
    select payload_hash,contract_version,lifecycle_id,market_snapshot_id
      from edge_research_bundles
     where bundle_id=${bundleId}
     limit 1
  `;
  if (existing.length) {
    if (String(existing[0].payload_hash) !== payloadHash) return { error: 'research bundle_id already exists with different immutable content', status: 409 };
    if (contractVersion === EDGE_RESEARCH_BUNDLE_VERSION) {
      if (String(existing[0].lifecycle_id ?? '') !== lifecycleId || String(existing[0].market_snapshot_id ?? '') !== marketSnapshotId) {
        return { error: 'existing V2 research bundle lineage mismatch', status: 409 };
      }
      await sql`
        update edge_run_lifecycles
           set stage='RESEARCH_READY',
               research_bundle_id=${bundleId},
               stage_detail='Lifecycle-bound independent web research ready',
               updated_at=now()
         where lifecycle_id=${lifecycleId}
           and market_snapshot_id=${marketSnapshotId}
           and stage in ('DATA_READY','RESEARCH_PENDING','RESEARCH_READY')
      `;
    }
    return { bundleId, contractVersion };
  }

  await sql`
    insert into edge_research_bundles(
      bundle_id,ticker,contract_version,research_authority,research_fresh_at,created_at,
      payload,payload_hash,status,lifecycle_id,market_snapshot_id
    ) values(
      ${bundleId},${ticker},${contractVersion},${authority},
      ${researchFreshAt},${String(body.created_at)},
      ${payloadText}::jsonb,${payloadHash},'READY',${lifecycleId},${marketSnapshotId}
    )
  `;

  if (contractVersion === EDGE_RESEARCH_BUNDLE_VERSION && lifecycleId && marketSnapshotId) {
    const updated=await sql`
      update edge_run_lifecycles
         set stage='RESEARCH_READY',
             research_bundle_id=${bundleId},
             stage_detail='Lifecycle-bound independent web research ready',
             updated_at=now()
       where lifecycle_id=${lifecycleId}
         and market_snapshot_id=${marketSnapshotId}
         and stage in ('DATA_READY','RESEARCH_PENDING')
       returning lifecycle_id
    `;
    if (!updated.length) return { error: 'research bundle stored but lifecycle did not transition to RESEARCH_READY', status: 409 };
  }

  return { bundleId, contractVersion };
}

async function saveEdgeResearchBundle(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const errors = validateEdgeResearchBundle(body);
  if (errors.length) return json({ error: 'EDGE research bundle validation failed', details: errors }, 422);
  const saved = await persistEdgeResearchBundle(env, body);
  if (!saved.bundleId) return json({ error: saved.error }, saved.status ?? 422);
  return json({ ok: true, status: 'READY', contract_version: saved.contractVersion, bundle_id: saved.bundleId });
}

async function getEdgeResearchBundle(env: Env, bundleId: string): Promise<Response> {
  if (!env.EDGE_DATABASE_URL) return json({ error: 'EDGE database is not configured' }, 503);
  if (!/^[A-Za-z0-9._:-]{3,160}$/.test(bundleId)) return json({ error: 'Invalid research bundle id' }, 422);
  const sql = neon(env.EDGE_DATABASE_URL);
  const rows = await sql`
    select bundle_id,ticker,contract_version,research_authority,research_fresh_at,created_at,
           payload_hash,status,payload,lifecycle_id,market_snapshot_id,inserted_at
      from edge_research_bundles
     where bundle_id=${bundleId}
     limit 1
  `;
  if (!rows.length) return json({ error: 'Research bundle not found' }, 404);
  return json({ research_bundle: rows[0] });
}

async function readinessGate(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try { body = await request.clone().json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!isObject(body)) return json({ error: 'request body must be a JSON object' }, 422);
  const assessment = assessEvidenceReadiness(body.evidence_categories);
  if (assessment.invalid.length) return json({ error: 'Unknown 5DR evidence categories', invalid_categories: assessment.invalid, required_categories: REQUIRED_5DR_EVIDENCE_CATEGORIES }, 422);
  if (!assessment.ready) return json({ error: '5DR evidence readiness gate blocked', missing_categories: assessment.missing, required_categories: REQUIRED_5DR_EVIDENCE_CATEGORIES }, 409);
  return app.fetch(request, env);
}

async function saveNormalizedEvidence(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured' }, 503);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const errors = validateNormalizedEvidence(body);
  if (errors.length) return json({ error: 'Normalized evidence validation failed', details: errors }, 422);
  const payload = body as JsonRecord;
  const evidence = payload.evidence as unknown[];
  const assessment = assessCompleteness(evidence);
  const executable = assessment.missing.length === 0 && assessment.conflicts.length === 0;

  const sql = neon(env.DATABASE_URL);
  const rows = await sql`select request_id, status, metadata from analysis_requests where request_id = ${requestId} and engine = '5DR' limit 1`;
  if (!rows.length) return json({ error: 'request_id not found' }, 404);
  if (!['READY_FOR_ENGINE', 'PROCESSING'].includes(String(rows[0].status))) return json({ error: 'request_id is not eligible for normalization' }, 409);
  const current = isObject(rows[0].metadata) ? rows[0].metadata as JsonRecord : {};
  const metadata = { ...current, normalized_evidence: evidence, normalized_at: new Date().toISOString(), normalization_assessment: assessment, adapter_stage: executable ? 'NORMALIZED_READY' : 'NORMALIZATION_BLOCKED' };
  await sql`update analysis_requests set metadata = ${JSON.stringify(metadata)}::jsonb, error = null, updated_at = now() where request_id = ${requestId}`;
  return json({ ok: executable, request_id: requestId, normalized_items: evidence.length, adapter_stage: metadata.adapter_stage, blockers: assessment, next_step: executable ? 'Execute governed 5DR runner' : 'Supply missing or resolve conflicting normalized inputs' }, executable ? 200 : 409);
}

const FIVE_DR_ASSESSMENT_HANDOFF_URL='https://raw.githubusercontent.com/kanirudhsaxena-code/5DR-V2/state/assessment-handoff/runtime/5dr-assessment-handoff.json';
const FIVE_DR_ASSESSMENT_SNAPSHOT_MAX_AGE_MS=2*60*60_000;

function fiveDrAssessmentMetricsComplete(value:unknown):boolean{
  if(!isObject(value))return false;
  const metrics=value as JsonRecord;
  const day=isObject(metrics.day_metrics)?metrics.day_metrics as JsonRecord:{};
  const labels=['D','D+1','D+2','D+3','D+4'];
  const ledger=Array.isArray(metrics.recommendation_ledger)?metrics.recommendation_ledger:[];
  const expectedCount=Number(metrics.all_recommendations_count??ledger.length);
  return metrics.assessment_snapshot_complete===true
    && labels.every(label=>isObject(day[label]))
    && metrics.recommendation_ledger_complete===true
    && Number.isFinite(expectedCount)
    && expectedCount>=0
    && ledger.length===expectedCount;
}

async function persistFiveDrAssessment(sql:any,assessment:JsonRecord):Promise<void>{
  const sourceId=String(assessment.forecast_id);
  const assessedAt=String(assessment.assessed_at);
  await sql`
    insert into assessment_rollups (engine,source_id,assessed_at,headline,score,metrics)
    values (
      '5DR',${sourceId},${assessedAt}::timestamptz,
      ${isNonEmptyString(assessment.outcome)?String(assessment.outcome):null},
      ${typeof assessment.score==='number'?assessment.score:null},
      ${JSON.stringify(assessment.metrics)}::jsonb
    )
    on conflict (engine,source_id,assessed_at) do update
    set headline=excluded.headline,
        score=excluded.score,
        metrics=excluded.metrics,
        created_at=now()
  `;
}

async function refreshFiveDrAssessmentState(sql:any):Promise<{ok:boolean;refreshed:boolean;source?:string;detail?:string}>{
  try{
    // First trust a complete assessment already refreshed inside the Console DB.
    const latest=await sql`select created_at,metrics from assessment_rollups where engine='5DR' order by created_at desc,id desc limit 1`;
    if(latest.length&&isObject(latest[0].metrics)&&fiveDrAssessmentMetricsComplete(latest[0].metrics)){
      const createdAt=String(latest[0].created_at??'');
      const age=createdAt&&!Number.isNaN(Date.parse(createdAt))?Date.now()-Date.parse(createdAt):Number.POSITIVE_INFINITY;
      if(age>=-5*60_000&&age<=FIVE_DR_ASSESSMENT_SNAPSHOT_MAX_AGE_MS){
        return {ok:true,refreshed:false,source:'ASSESSMENT_ROLLUP'};
      }
    }

    // Rebuild locally only when this database actually carries the governed
    // 5DR canonical lifecycle schema. Console persistence and 5DR canonical
    // persistence are separate databases in production, so schema absence is
    // an expected fallback condition rather than a fatal execution error.
    let localDetail='local 5DR canonical schema is unavailable';
    try{
      const schemaRows=await sql`
        select to_regclass('public.canonical_selections') as canonical_selections,
               to_regclass('public.forecasts') as forecasts,
               to_regclass('public.outcome_checkpoints') as outcome_checkpoints
      `;
      const schema=schemaRows[0]??{};
      const localSchemaReady=Boolean(schema.canonical_selections&&schema.forecasts&&schema.outcome_checkpoints);
      if(localSchemaReady){
        const local=await buildFiveDrAssessmentFromDatabase(sql);
        if(local.ok){
          const assessment=local.assessment as JsonRecord;
          if(
            assessment.engine==='5DR'&&
            isNonEmptyString(assessment.forecast_id)&&
            isNonEmptyString(assessment.assessed_at)&&
            isObject(assessment.metrics)&&
            fiveDrAssessmentMetricsComplete(assessment.metrics)
          ){
            await persistFiveDrAssessment(sql,assessment);
            return {ok:true,refreshed:true,source:'LOCAL_CANONICAL_DB_REBUILD'};
          }
          localDetail='local 5DR canonical assessment payload is incomplete';
        }else{
          localDetail=`local 5DR canonical assessment rebuild unavailable (${local.detail})`;
        }
      }
    }catch(error){
      localDetail=`local 5DR canonical assessment rebuild failed: ${error instanceof Error?error.message:String(error)}`;
    }

    // Authoritative cross-database fallback: 5DR-V2 publishes a complete
    // immutable handoff three times per hour. Accept it only inside the same
    // two-hour freshness window and only with an exact complete ledger.
    const response=await fetch(FIVE_DR_ASSESSMENT_HANDOFF_URL,{headers:{'Accept':'application/json','Cache-Control':'no-cache'}});
    if(!response.ok)return {ok:false,refreshed:false,detail:`${localDetail}; handoff fetch failed: HTTP ${response.status}`};
    const handoff:unknown=await response.json();
    if(!isObject(handoff)||handoff.schema_version!=='5DR_ASSESSMENT_HANDOFF_V1')return {ok:false,refreshed:false,detail:`${localDetail}; assessment handoff schema mismatch`};
    const generatedAt=String(handoff.generated_at??'');
    if(!generatedAt||Number.isNaN(Date.parse(generatedAt)))return {ok:false,refreshed:false,detail:`${localDetail}; assessment handoff generated_at is invalid`};
    const handoffAge=Date.now()-Date.parse(generatedAt);
    if(handoffAge < -5*60_000||handoffAge > FIVE_DR_ASSESSMENT_SNAPSHOT_MAX_AGE_MS)return {ok:false,refreshed:false,detail:`${localDetail}; assessment handoff is stale`};
    const assessment=isObject(handoff.assessment)?handoff.assessment as JsonRecord:null;
    if(!assessment||assessment.engine!=='5DR'||!isNonEmptyString(assessment.forecast_id)||!isNonEmptyString(assessment.assessed_at)||!isObject(assessment.metrics))return {ok:false,refreshed:false,detail:`${localDetail}; assessment handoff payload is invalid`};
    if(!fiveDrAssessmentMetricsComplete(assessment.metrics))return {ok:false,refreshed:false,detail:`${localDetail}; assessment handoff snapshot or recommendation ledger is incomplete`};
    await persistFiveDrAssessment(sql,assessment);
    return {ok:true,refreshed:true,source:'IMMUTABLE_HANDOFF_FALLBACK'};
  }catch(error){
    return {ok:false,refreshed:false,detail:error instanceof Error?error.message:String(error)};
  }
}

async function fiveDrExecutionContext(sql:any):Promise<{assessment_context:JsonRecord;predecessor:JsonRecord|null}|null>{
  const assessmentRows=await sql`select source_id,assessed_at,headline,metrics,created_at from assessment_rollups where engine='5DR' order by created_at desc,id desc limit 1`;
  if(!assessmentRows.length||!isObject(assessmentRows[0].metrics))return null;
  const metrics=assessmentRows[0].metrics as JsonRecord;
  if(!fiveDrAssessmentMetricsComplete(metrics))return null;
  const assessedAt=String(assessmentRows[0].assessed_at||'');
  if(!assessedAt||Number.isNaN(Date.parse(assessedAt)))return null;
  const snapshotCreatedAt=String(assessmentRows[0].created_at||'');
  if(!snapshotCreatedAt||Number.isNaN(Date.parse(snapshotCreatedAt)))return null;
  const ageMs=Date.now()-Date.parse(snapshotCreatedAt);
  if(ageMs < -5*60_000||ageMs > FIVE_DR_ASSESSMENT_SNAPSHOT_MAX_AGE_MS)return null;
  const predecessorRows=await sql`select run_id,generated_at,result from analysis_runs where engine='5DR' and published=true and status='SUCCESS' order by generated_at desc limit 1`;
  const predecessor=predecessorRows.length&&isObject(predecessorRows[0].result)
    ? {run_id:String(predecessorRows[0].run_id),generated_at:predecessorRows[0].generated_at,result:predecessorRows[0].result as JsonRecord}
    : null;
  return {assessment_context:{source_id:String(assessmentRows[0].source_id),assessed_at:assessedAt,headline:isNonEmptyString(assessmentRows[0].headline)?String(assessmentRows[0].headline):null,snapshot_complete:true,recommendation_ledger_complete:true,metrics},predecessor};
}

async function executionPacket(env: Env, requestId: string): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured' }, 503);
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`select request_id, provenance_mode, framework_version, output_contract_version, status, metadata from analysis_requests where request_id = ${requestId} and engine = '5DR' limit 1`;
  if (!rows.length) return json({ error: 'request_id not found' }, 404);
  if (!['READY_FOR_ENGINE', 'PROCESSING'].includes(String(rows[0].status))) return json({ error: 'request_id is not eligible for execution' }, 409);
  const metadata = isObject(rows[0].metadata) ? rows[0].metadata as JsonRecord : {};
  if (metadata.adapter_stage !== 'NORMALIZED_READY' || !Array.isArray(metadata.normalized_evidence) || !metadata.normalized_evidence.length) return json({ error: 'request is not normalization-ready', blockers: metadata.normalization_assessment ?? null, next_step: 'Complete normalized evidence before execution' }, 409);
  const assessmentRefresh=await refreshFiveDrAssessmentState(sql);
  const context=await fiveDrExecutionContext(sql);
  if(!context)return json({error:'5DR assessment-first release gate blocked: canonical assessment snapshot or recommendation ledger is missing/incomplete/stale',assessment_refresh:assessmentRefresh,next_step:'Refresh canonical lifecycle assessment handoff before engine execution'},409);
  return json({ request_id: String(rows[0].request_id), provenance_mode: String(rows[0].provenance_mode), framework_version: String(rows[0].framework_version), output_contract_version: String(rows[0].output_contract_version), evidence: metadata.normalized_evidence, ...context });
}

async function failRequest(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured' }, 503);
  let body: unknown = {}; try { body = await request.json(); } catch { /* optional */ }
  const detail = isObject(body) && isNonEmptyString(body.error) ? body.error.slice(0, 2000) : '5DR execution failed';
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`select request_id, status from analysis_requests where request_id = ${requestId} and engine = '5DR' limit 1`;
  if (!rows.length) return json({ error: 'request_id not found' }, 404);
  if (String(rows[0].status) === 'COMPLETED') return json({ error: 'completed request cannot be failed' }, 409);
  await sql`update analysis_requests set status = 'FAILED', error = ${JSON.stringify({ stage: 'EXECUTION', detail })}::jsonb, updated_at = now() where request_id = ${requestId}`;
  return json({ ok: true, request_id: requestId, status: 'FAILED' });
}


async function fiveDrCanonicalHandoff(env: Env): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured', code: 'DATABASE_NOT_CONFIGURED' }, 503);
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`
    select ar.run_id,ar.generated_at,ar.freshness_at,ar.framework_version,ar.contract_version,
           ar.status,ar.provenance_mode,ar.published,ar.result,
           req.request_id,req.provenance_mode as request_provenance_mode,req.metadata
      from analysis_runs ar
      left join lateral (
        select request_id,provenance_mode,metadata
          from analysis_requests
         where engine='5DR' and run_id=ar.run_id
         order by updated_at desc
         limit 1
      ) req on true
     where ar.engine='5DR' and ar.published=true
     order by ar.generated_at desc
     limit 20
  `;
  const runs = rows.map((row:any) => {
    const metadata = isObject(row.metadata) ? row.metadata as JsonRecord : {};
    const intelligence = isObject(metadata.intelligence_handoff) ? metadata.intelligence_handoff as JsonRecord : {};
    const normalized = isObject(intelligence.normalized) ? intelligence.normalized : null;
    const market = isObject(metadata.automated_market_evidence) ? metadata.automated_market_evidence : {};
    return {
      run: {
        run_id: row.run_id,
        generated_at: row.generated_at,
        freshness_at: row.freshness_at,
        framework_version: row.framework_version,
        contract_version: row.contract_version,
        status: row.status,
        provenance_mode: row.provenance_mode,
        published: row.published === true,
        result: row.result,
      },
      request: {
        request_id: row.request_id ?? null,
        provenance_mode: row.request_provenance_mode ?? null,
        metadata: {
          intelligence_handoff: normalized ? { normalized } : {},
          automated_market_evidence: market,
          invocation: isObject(metadata.invocation) ? metadata.invocation : {},
          run_provenance: isObject(metadata.run_provenance) ? metadata.run_provenance : {},
          canonical_attempt: isObject(metadata.canonical_attempt) ? metadata.canonical_attempt : null,
        },
      },
    };
  });
  return json({
    schema_version: '5DR_CONSOLE_HANDOFF_V1',
    generated_at: new Date().toISOString(),
    source: 'EDGE_CONSOLE_PUBLISHED_RUNS',
    runs,
  });
}


async function fiveDrAssessmentImport(request: Request, env: Env): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured' }, 503);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (
    !isObject(body) || String(body.engine || '') !== '5DR' ||
    !isNonEmptyString(body.forecast_id) || !isNonEmptyString(body.assessed_at) ||
    !isObject(body.metrics)
  ) return json({ error: 'Invalid assessment import payload' }, 422);

  const sql = neon(env.DATABASE_URL);
  const sourceId = String(body.forecast_id);
  const assessedAt = String(body.assessed_at);
  const existing = await sql`
    select id,metrics
      from assessment_rollups
     where engine='5DR'
       and source_id=${sourceId}
       and assessed_at=${assessedAt}::timestamptz
     order by created_at desc,id desc
     limit 1
  `;
  if (existing.length && isObject(existing[0].metrics) && fiveDrAssessmentMetricsComplete(existing[0].metrics)) {
    return json({ ok: true, duplicate: true, source_id: sourceId });
  }

  await sql`
    insert into assessment_rollups (engine,source_id,assessed_at,headline,score,metrics)
    values (
      '5DR',${sourceId},${assessedAt}::timestamptz,
      ${isNonEmptyString(body.outcome) ? String(body.outcome) : null},
      ${typeof body.score === 'number' ? body.score : null},
      ${JSON.stringify(body.metrics)}::jsonb
    )
      on conflict (engine,source_id,assessed_at) do update
      set headline=excluded.headline,
          score=excluded.score,
          metrics=excluded.metrics,
          created_at=now()
  `;
  return json({ ok: true, source_id: sourceId }, 201);
}

async function edgeStocksDispatchHealth(env: Env): Promise<Response> {
  const token=env.EDGE_GITHUB_TOKEN??'';
  const [data,compute,auction]=await Promise.all([
    checkEdgeDataWorkflowAccess(token),
    checkEdgeWorkflowAccess(token),
    checkEdgeAuctionWorkflowAccess(token),
  ]);
  const ok=data.ok&&compute.ok&&auction.ok;
  const blocked=[data,compute,auction].find(result=>!result.ok);
  const statusCode=ok?200:(blocked?.status===401||blocked?.status===403?502:(blocked?.status??503));
  return json({
    ok,
    status:ok?'READY':'BLOCKED',
    engine:'EDGE_STOCKS',
    workflow:'autonomous-publish.yml',
    workflows:{
      data:{name:'stock-data-snapshot.yml',ok:data.ok,status:data.status,error:data.error??null},
      compute:{name:'autonomous-publish.yml',ok:compute.ok,status:compute.status,error:compute.error??null},
      auction:{name:'stock-auction-snapshot.yml',ok:auction.ok,status:auction.status,error:auction.error??null},
    },
    production_scheduler_authority:'CLOUDFLARE_CRON',
    chat_scheduled_task_dependency:false,
    trading_enabled:false,
    error:blocked?.error??null,
  },statusCode);
}

async function resolveEdgeTicker(env: Env, target: string): Promise<{ ticker?: string; error?: string; status?: number }> {
  const direct = normalizeTickerCandidate(target);
  if (direct) return { ticker: direct };
  if (!env.EDGE_DATABASE_URL) {
    return { error: 'Company-name resolution requires the EDGE database; use an NSE ticker symbol', status: 422 };
  }
  const sql = neon(env.EDGE_DATABASE_URL);
  const rows = await sql`
    select distinct ticker, company_name
      from recommendations
     where company_name is not null
       and lower(trim(company_name)) = lower(trim(${target}))
     order by ticker
     limit 3
  `;
  if (!rows.length) return { error: 'Company name not found in governed EDGE history; use the exact NSE ticker', status: 404 };
  if (rows.length > 1) return { error: 'Company name is ambiguous; use the exact NSE ticker', status: 409 };
  return { ticker: String(rows[0].ticker).toUpperCase() };
}

async function latestEdgeRecommendation(env: Env, ticker: string): Promise<{ id: string; runTimestamp: unknown } | null> {
  if (!env.EDGE_DATABASE_URL) return null;
  const sql = neon(env.EDGE_DATABASE_URL);
  const rows = await sql`
    select recommendation_id, run_timestamp
      from recommendations
     where ticker = ${ticker}
     order by run_timestamp desc
     limit 1
  `;
  return rows.length ? { id: String(rows[0].recommendation_id), runTimestamp: rows[0].run_timestamp } : null;
}

async function todaysAutonomousRecommendation(env: Env, ticker: string): Promise<{ id: string; runTimestamp: unknown } | null> {
  if (!env.EDGE_DATABASE_URL) return null;
  const sql = neon(env.EDGE_DATABASE_URL);
  const pattern = `EDGE-${ticker}-%-AUTO`;
  const rows = await sql`
    select recommendation_id, run_timestamp
      from recommendations
     where ticker = ${ticker}
       and recommendation_id like ${pattern}
       and (run_timestamp at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date
     order by run_timestamp desc
     limit 1
  `;
  return rows.length ? { id: String(rows[0].recommendation_id), runTimestamp: rows[0].run_timestamp } : null;
}


function currentIstDate():string{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function newUserStockLifecycleId(ticker:string):string{
  return `EDGE-LC-${currentIstDate()}-${ticker}-USER-${crypto.randomUUID()}`;
}

async function beginNormalStockLifecycle(env:Env,ticker:string):Promise<{
  ok:boolean;lifecycle_id:string;status:string;dispatch_status?:number;error?:string
}>{
  const lifecycleId=newUserStockLifecycleId(ticker);
  await ensureStockLifecycle(env,{
    lifecycle_id:lifecycleId,
    ticker,
    trigger_type:'USER',
    target_session:currentIstDate(),
  });
  const build3RunTimestamp=new Date();
  const build3Run=buildBuild3RunRegistryRecord({
    engine:'EDGE_STOCKS',instrument:ticker,source_id:lifecycleId,model_version:'EDGE_V1',
    run_timestamp:build3RunTimestamp,trigger_type:'MANUAL',market_phase:classifyBuild3MarketPhase(build3RunTimestamp)
  });
  try{
    await persistBuild3RunRegistryRecord(env.DATABASE_URL,build3Run);
  }catch(error){
    const detail=error instanceof Error?error.message:String(error);
    await markStockDataBlocked(env,lifecycleId,`Build 3.0 run registry blocked: ${detail}`);
    return {ok:false,lifecycle_id:lifecycleId,status:'DATA_BLOCKED',error:detail};
  }
  const dispatched=await dispatchEdgeDataWorkflow(env.EDGE_GITHUB_TOKEN??'',{
    ticker,lifecycle_id:lifecycleId,trigger_type:'USER',target_session:currentIstDate()
  });
  if(!dispatched.ok){
    await markStockDataBlocked(env,lifecycleId,`DATA dispatch failed: ${dispatched.error??dispatched.status}`);
    return {ok:false,lifecycle_id:lifecycleId,status:'DATA_BLOCKED',dispatch_status:dispatched.status,error:dispatched.error};
  }
  return {ok:true,lifecycle_id:lifecycleId,status:'DATA_DISPATCHED',dispatch_status:dispatched.status};
}

export async function progressNormalStockLifecycle(
  env:Env,
  ticker:string,
  lifecycleId:string
):Promise<{
  status:'RUNNING'|'COMPLETE'|'BLOCKED';
  lifecycle_stage:string;
  lifecycle_id:string;
  run_id?:string|null;
  market_snapshot_id?:string|null;
  research_bundle_id?:string|null;
  auction_snapshot_id?:string|null;
  build3_forecast_version?:string;
  build3_forecast_horizons?:number;
  detail?:string|null;
}>{
  let lifecycle=await getStockLifecycle(env,lifecycleId);
  if(!lifecycle)return {status:'BLOCKED',lifecycle_stage:'MISSING',lifecycle_id:lifecycleId,detail:'lifecycle not found'};
  if(lifecycle.ticker!==ticker.toUpperCase())return {status:'BLOCKED',lifecycle_stage:lifecycle.stage,lifecycle_id:lifecycleId,detail:'lifecycle ticker mismatch'};
  if(lifecycle.trigger_type!=='USER')return {status:'BLOCKED',lifecycle_stage:lifecycle.stage,lifecycle_id:lifecycleId,detail:'normal-run progress requires USER lifecycle'};

  if(lifecycle.stage==='DATA_READY'){
    if(!lifecycle.market_snapshot_id)return {status:'BLOCKED',lifecycle_stage:lifecycle.stage,lifecycle_id:lifecycleId,detail:'DATA_READY without market_snapshot_id'};
    const marketSnapshotId=lifecycle.market_snapshot_id;
    await markStockResearchPending(env,lifecycleId,marketSnapshotId);
    const snapshot=await readMarketSnapshotPayload(env,lifecycleId,marketSnapshotId);
    if(!snapshot){
      await markStockResearchBlocked(env,lifecycleId,'immutable DATA snapshot readback failed');
      return {status:'BLOCKED',lifecycle_stage:'RESEARCH_BLOCKED',lifecycle_id:lifecycleId,detail:'immutable DATA snapshot readback failed'};
    }
    try{
      const produced=await produceStockSystemResearch(env,{
        ticker,
        lifecycle_id:lifecycleId,
        market_snapshot_id:marketSnapshotId,
        data_captured_at:snapshot.captured_at,
        market_payload:snapshot.payload,
      },fetch);
      const saved=await persistEdgeResearchBundle(env,produced.bundle,ticker);
      if(!saved.bundleId)throw new Error(saved.error??'research persistence failed');
    }catch(error){
      const detail=error instanceof Error?error.message:String(error);
      await markStockResearchBlocked(env,lifecycleId,detail);
      return {status:'BLOCKED',lifecycle_stage:'RESEARCH_BLOCKED',lifecycle_id:lifecycleId,detail};
    }
    lifecycle=(await getStockLifecycle(env,lifecycleId))??lifecycle;
  }

  if(lifecycle.stage==='RESEARCH_READY'){
    if(!lifecycle.market_snapshot_id||!lifecycle.research_bundle_id){
      return {status:'BLOCKED',lifecycle_stage:lifecycle.stage,lifecycle_id:lifecycleId,detail:'RESEARCH_READY lineage is incomplete'};
    }
    let evidenceSnapshot;
    try{
      evidenceSnapshot=await freezeBuild3StockEvidence(env,{
        ticker,
        lifecycle_id:lifecycleId,
        market_snapshot_id:lifecycle.market_snapshot_id,
        research_bundle_id:lifecycle.research_bundle_id,
      });
    }catch(error){
      return {
        status:'BLOCKED',
        lifecycle_stage:lifecycle.stage,
        lifecycle_id:lifecycleId,
        market_snapshot_id:lifecycle.market_snapshot_id,
        research_bundle_id:lifecycle.research_bundle_id,
        detail:`Build 3.0 evidence freeze failed: ${error instanceof Error?error.message:String(error)}`
      };
    }
    const dataQuality=await persistBuild3DataQuality(
      env.DATABASE_URL,
      assessBuild3StockDataQuality(evidenceSnapshot)
    );
    if(!dataQuality.valid_for_forecast){
      return {
        status:'BLOCKED',
        lifecycle_stage:lifecycle.stage,
        lifecycle_id:lifecycleId,
        market_snapshot_id:lifecycle.market_snapshot_id,
        research_bundle_id:lifecycle.research_bundle_id,
        detail:`Build 3.0 data-quality gate blocked: ${dataQuality.blockers.join(', ')}`
      };
    }
    const dispatch=await dispatchEdgeWorkflow(
      env.EDGE_GITHUB_TOKEN??'',ticker,'UNKNOWN',lifecycle.research_bundle_id,
      undefined,undefined,lifecycleId,lifecycle.market_snapshot_id,undefined
    );
    if(!dispatch.ok){
      return {status:'BLOCKED',lifecycle_stage:lifecycle.stage,lifecycle_id:lifecycleId,detail:dispatch.error??'compute dispatch failed'};
    }
    lifecycle=await markStockComputeDispatched(env,lifecycleId,'RESEARCH_READY');
  }

  if(['PERSISTED','PRESENTED'].includes(lifecycle.stage)){
    let build3Forecast;
    try{
      build3Forecast=await materializePersistedStockBuild3Forecast(env,lifecycleId);
    }catch(error){
      return {
        status:'BLOCKED',
        lifecycle_stage:lifecycle.stage,
        lifecycle_id:lifecycleId,
        run_id:lifecycle.recommendation_id??null,
        market_snapshot_id:lifecycle.market_snapshot_id,
        research_bundle_id:lifecycle.research_bundle_id,
        auction_snapshot_id:lifecycle.auction_snapshot_id,
        detail:`Build 3.0 stock forecast materialization failed: ${error instanceof Error?error.message:String(error)}`
      };
    }
    return {
      status:'COMPLETE',
      lifecycle_stage:lifecycle.stage,
      lifecycle_id:lifecycleId,
      run_id:lifecycle.recommendation_id??null,
      market_snapshot_id:lifecycle.market_snapshot_id,
      research_bundle_id:lifecycle.research_bundle_id,
      auction_snapshot_id:lifecycle.auction_snapshot_id,
      build3_forecast_version:build3Forecast.forecast_version,
      build3_forecast_horizons:build3Forecast.horizons.length
    };
  }
  if(['DATA_BLOCKED','RESEARCH_BLOCKED','COMPUTE_BLOCKED','AUCTION_BLOCKED'].includes(lifecycle.stage)){
    return {
      status:'BLOCKED',
      lifecycle_stage:lifecycle.stage,
      lifecycle_id:lifecycleId,
      market_snapshot_id:lifecycle.market_snapshot_id,
      research_bundle_id:lifecycle.research_bundle_id,
      auction_snapshot_id:lifecycle.auction_snapshot_id,
      detail:lifecycle.stage_detail
    };
  }
  return {
    status:'RUNNING',
    lifecycle_stage:lifecycle.stage,
    lifecycle_id:lifecycleId,
    run_id:lifecycle.recommendation_id??null,
    market_snapshot_id:lifecycle.market_snapshot_id,
    research_bundle_id:lifecycle.research_bundle_id,
    auction_snapshot_id:lifecycle.auction_snapshot_id,
    detail:lifecycle.stage_detail
  };
}

export async function progressPendingNormalStockLifecycles(env:Env,limit=12):Promise<JsonRecord[]>{
  if(!env.EDGE_DATABASE_URL)return [];
  const sql=neon(env.EDGE_DATABASE_URL);
  const rows=await sql`
    select lifecycle_id,ticker
      from edge_run_lifecycles
     where trigger_type='USER'
       and stage in ('RUN_CREATED','DATA_PENDING','DATA_READY','RESEARCH_PENDING','RESEARCH_READY','COMPUTE_DISPATCHED','COMPUTE_PENDING')
     order by created_at asc
     limit ${Math.max(1,Math.min(50,limit))}
  `;
  const results:JsonRecord[]=[];
  for(const row of rows){
    const ticker=String(row.ticker).toUpperCase();
    const lifecycleId=String(row.lifecycle_id);
    try{
      const result=await progressNormalStockLifecycle(env,ticker,lifecycleId);
      results.push({ticker,...result});
    }catch(error){
      results.push({ticker,lifecycle_id:lifecycleId,status:'BLOCKED',detail:error instanceof Error?error.message:String(error)});
    }
  }
  return results;
}

async function invokeEdgeStocks(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!isObject(body)) return json({ error: 'request body must be a JSON object' }, 422);
  if (body.research_only !== undefined && typeof body.research_only !== 'boolean') {
    return json({ error: 'research_only must be boolean' }, 422);
  }
  const researchOnly = body.research_only === true;
  if (researchOnly && !isObject(body.research_bundle)) {
    return json({ error: 'research_only requires a governed research_bundle' }, 422);
  }
  const command = parseEdgeCommand(body.command);
  if (!command) return json({ error: 'Command must be in the form EDGE <stock/company/ticker>' }, 422);

  const resolved = await resolveEdgeTicker(env, command.target);
  if (!resolved.ticker) return json({ error: resolved.error }, resolved.status ?? 422);
  const ticker = resolved.ticker;

  const forceNew = body.force_new === true;
  const canonicalAttempt = body.canonical_attempt === true;
  const canonicalAttemptSlot = typeof body.canonical_attempt_slot === 'string' ? body.canonical_attempt_slot.trim() : null;
  const lifecycleId = isNonEmptyString(body.lifecycle_id) ? String(body.lifecycle_id) : null;
  let marketSnapshotId = isNonEmptyString(body.market_snapshot_id) ? String(body.market_snapshot_id) : null;
  const existingToday = await todaysAutonomousRecommendation(env, ticker);
  if (existingToday && !forceNew && !isObject(body.research_bundle) && !canonicalAttempt) {
    return json({
      ok: true,
      status: 'ALREADY_PUBLISHED_TODAY',
      engine: 'EDGE_STOCKS',
      contract_version: 'EDGE_STOCKS_V1_3',
      ticker,
      command: command.raw,
      run_id: existingToday.id,
      run_timestamp: existingToday.runTimestamp,
      report_url: `/api/edge-stocks/report?ticker=${encodeURIComponent(ticker)}`,
      trading_enabled: false
    });
  }

  let researchBundleId: string | undefined;
  let researchContractVersion: string | undefined;
  let auctionSnapshotIdForDispatch: string | undefined;
  if (isObject(body.research_bundle)) {
    const saved = await persistEdgeResearchBundle(env, body.research_bundle, ticker);
    if (!saved.bundleId) return json({ error: saved.error, code: 'EDGE_RESEARCH_BUNDLE_BLOCKED', ticker }, saved.status ?? 422);
    researchBundleId = saved.bundleId;
    researchContractVersion = saved.contractVersion;

    if (!researchOnly) {
      return json({
        error:'Externally supplied research bundles are compatibility/research-only artifacts and cannot launch a new production computation. Start a fresh lifecycle so DATA is acquired first.',
        code:'EDGE_EXTERNAL_RESEARCH_COMPUTE_PROHIBITED',
        ticker,
        research_bundle_id:researchBundleId,
        trading_enabled:false
      },409);
    }

    if (researchOnly) {
      if (!env.EDGE_DATABASE_URL) return json({ error: 'EDGE database is not configured' }, 503);
      const sql = neon(env.EDGE_DATABASE_URL);
      const rows = await sql`
        select bundle_id,ticker,contract_version,research_authority,research_fresh_at,created_at,
               payload_hash,status,payload,lifecycle_id,market_snapshot_id
          from edge_research_bundles
         where bundle_id=${researchBundleId}
         limit 1
      `;
      if (!rows.length) {
        return json({ error: 'Stored research readback failed', code: 'EDGE_RESEARCH_READBACK_MISSING', ticker }, 500);
      }
      const row = rows[0] as Record<string, unknown>;
      const exactPayloadReadback = isObject(row.payload)
        && stableJson(row.payload) === stableJson(body.research_bundle);
      const expectedVersion=String(body.research_bundle.contract_version);
      const expectedAuthority=String(body.research_bundle.research_authority);
      const exactIdentity =
        String(row.bundle_id) === researchBundleId
        && String(row.ticker).toUpperCase() === ticker
        && String(row.contract_version) === expectedVersion
        && String(row.research_authority) === expectedAuthority
        && String(row.status) === 'READY'
        && isNonEmptyString(row.payload_hash)
        && (expectedVersion!==EDGE_RESEARCH_BUNDLE_VERSION
          || (
            String(row.lifecycle_id??'')===String(body.research_bundle.lifecycle_id??'')
            && String(row.market_snapshot_id??'')===String(body.research_bundle.market_snapshot_id??'')
          ));
      if (!exactPayloadReadback || !exactIdentity) {
        return json({
          error: 'Immutable stored research readback mismatch',
          code: 'EDGE_RESEARCH_READBACK_MISMATCH',
          ticker,
          research_bundle_id: researchBundleId,
        }, 500);
      }
      return json({
        ok: true,
        status: 'READY',
        mode: 'RESEARCH_ONLY',
        engine: 'EDGE_STOCKS',
        research_contract_version: String(row.contract_version),
        ticker,
        command: command.raw,
        research_bundle_id: researchBundleId,
        research_fresh_at: row.research_fresh_at,
        payload_hash: row.payload_hash,
        research_bundle: row.payload,
        exact_payload_readback: true,
        publishing_enabled: false,
        trading_enabled: false,
      }, 201);
    }
  } else {
    if (!canonicalAttempt) {
      try{
        const started=await beginNormalStockLifecycle(env,ticker);
        return json({
          ok:started.ok,
          status:started.status,
          engine:'EDGE_STOCKS',
          contract_version:'EDGE_STOCKS_V1_3',
          research_contract_version:EDGE_RESEARCH_BUNDLE_VERSION,
          ticker,
          command:command.raw,
          lifecycle_id:started.lifecycle_id,
          fresh_run:true,
          reused_output:false,
          data_first:true,
          research_executed_this_run:false,
          trading_enabled:false,
          error:started.error??null,
          next:`/api/edge-stocks/invoke/status?ticker=${encodeURIComponent(ticker)}&lifecycle_id=${encodeURIComponent(started.lifecycle_id)}`
        },started.ok?202:502);
      }catch(error){
        return json({
          error:'Fresh EDGE lifecycle could not start',
          detail:error instanceof Error?error.message:String(error),
          code:'EDGE_LIFECYCLE_START_FAILED',
          ticker,
          trading_enabled:false
        },503);
      }
    }
    if (!lifecycleId) {
      return json({
        error: 'Pre-open canonical EDGE requires its exact production lifecycle_id',
        code: 'EDGE_CANONICAL_LIFECYCLE_REQUIRED',
        ticker,
        canonical_attempt: true,
        canonical_attempt_slot: canonicalAttemptSlot,
        trading_enabled: false,
      }, 409);
    }
    if (!env.EDGE_DATABASE_URL) return json({ error: 'EDGE database is not configured' }, 503);
    const sql=neon(env.EDGE_DATABASE_URL);
    const rows=await sql`
      select ticker,stage,market_snapshot_id,research_bundle_id,auction_snapshot_id
        from edge_run_lifecycles
       where lifecycle_id=${lifecycleId}
       limit 1
    `;
    if(!rows.length){
      return json({error:'Pre-open stock lifecycle was not found',code:'EDGE_CANONICAL_LIFECYCLE_MISSING',ticker,lifecycle_id:lifecycleId,trading_enabled:false},409);
    }
    const lifecycle=rows[0];
    if(String(lifecycle.ticker).toUpperCase()!==ticker||String(lifecycle.stage)!=='AUCTION_READY'){
      return json({
        error:'Pre-open stock lifecycle is not AUCTION_READY',
        code:'EDGE_CANONICAL_AUCTION_NOT_READY',
        ticker,
        lifecycle_id:lifecycleId,
        stage:String(lifecycle.stage),
        trading_enabled:false,
      },409);
    }
    marketSnapshotId=String(lifecycle.market_snapshot_id??'');
    researchBundleId=String(lifecycle.research_bundle_id??'');
    const auctionSnapshotId=String(lifecycle.auction_snapshot_id??'');
    if(!marketSnapshotId||!researchBundleId){
      return json({error:'Pre-open lifecycle lineage is incomplete',code:'EDGE_CANONICAL_LINEAGE_INCOMPLETE',ticker,lifecycle_id:lifecycleId,trading_enabled:false},409);
    }
    const researchRows=await sql`
      select contract_version,lifecycle_id,market_snapshot_id,status
        from edge_research_bundles
       where bundle_id=${researchBundleId}
       limit 1
    `;
    if(
      !researchRows.length
      || String(researchRows[0].contract_version)!==EDGE_RESEARCH_BUNDLE_VERSION
      || String(researchRows[0].lifecycle_id??'')!==lifecycleId
      || String(researchRows[0].market_snapshot_id??'')!==marketSnapshotId
      || String(researchRows[0].status)!=='READY'
    ){
      return json({error:'Lifecycle research bundle identity is not valid for this DATA snapshot',code:'EDGE_CANONICAL_RESEARCH_LINEAGE_MISMATCH',ticker,lifecycle_id:lifecycleId,trading_enabled:false},409);
    }
    researchContractVersion=String(researchRows[0].contract_version);
    if(!auctionSnapshotId){
      return json({
        error:'Pre-open lifecycle does not yet contain a frozen auction snapshot',
        code:'EDGE_CANONICAL_AUCTION_NOT_READY',
        ticker,
        lifecycle_id:lifecycleId,
        trading_enabled:false,
      },409);
    }
    const auctionRows=await sql`
      select auction_snapshot_id,status,captured_at
        from edge_auction_snapshots
       where auction_snapshot_id=${auctionSnapshotId}
         and lifecycle_id=${lifecycleId}
         and ticker=${ticker}
       limit 1
    `;
    if(!auctionRows.length||String(auctionRows[0].status)!=='AUCTION_READY'){
      return json({
        error:'Frozen pre-open auction snapshot identity is invalid',
        code:'EDGE_CANONICAL_AUCTION_LINEAGE_MISMATCH',
        ticker,
        lifecycle_id:lifecycleId,
        auction_snapshot_id:auctionSnapshotId,
        trading_enabled:false,
      },409);
    }
    auctionSnapshotIdForDispatch=auctionSnapshotId;
  }

  const baseline = await latestEdgeRecommendation(env, ticker);
  const baselineRunId = baseline?.id ?? null;
  const dispatchedAt = new Date().toISOString();
  const canonicalRequestedAt = canonicalAttempt
    ? (typeof body.canonical_requested_at === 'string' && !Number.isNaN(Date.parse(body.canonical_requested_at))
        ? new Date(body.canonical_requested_at).toISOString()
        : dispatchedAt)
    : undefined;

  let evidenceSnapshotRef:Record<string,string>|null=null;
  if(lifecycleId&&marketSnapshotId&&researchBundleId){
    try{
      const evidenceSnapshot=await freezeBuild3StockEvidence(env,{
        ticker,
        lifecycle_id:lifecycleId,
        market_snapshot_id:marketSnapshotId,
        research_bundle_id:researchBundleId,
        auction_snapshot_id:auctionSnapshotIdForDispatch??null,
        canonical_requested_at:canonicalRequestedAt??null,
        canonical_attempt_slot:canonicalAttemptSlot,
      });
      evidenceSnapshotRef=build3EvidenceSnapshotRef(evidenceSnapshot);
      const dataQuality=await persistBuild3DataQuality(
        env.DATABASE_URL,
        assessBuild3StockDataQuality(evidenceSnapshot)
      );
      if(!dataQuality.valid_for_forecast){
        return json({
          error:'Build 3.0 data-quality gate blocked forecast dispatch',
          code:'BUILD3_DATA_QUALITY_BLOCKED',
          ticker,lifecycle_id:lifecycleId,
          build3_evidence_snapshot:evidenceSnapshotRef,
          build3_data_quality:build3DataQualityRef(dataQuality),
          trading_enabled:false
        },409);
      }
    }catch(error){
      return json({
        error:'Build 3.0 evidence freeze failed',
        detail:error instanceof Error?error.message:String(error),
        code:'BUILD3_EVIDENCE_SNAPSHOT_BLOCKED',
        ticker,lifecycle_id:lifecycleId,trading_enabled:false
      },409);
    }
  }

  const dispatch = await dispatchEdgeWorkflow(
    env.EDGE_GITHUB_TOKEN ?? '', ticker, 'UNKNOWN', researchBundleId,
    canonicalRequestedAt, canonicalAttemptSlot ?? undefined,
    lifecycleId ?? undefined, marketSnapshotId ?? undefined,
    auctionSnapshotIdForDispatch
  );
  if (!dispatch.ok) {
    return json({
      error: 'EDGE autonomous dispatch failed',
      detail: dispatch.error,
      ticker,
      research_bundle_id: researchBundleId,
      code: dispatch.status === 503 ? 'EDGE_DISPATCH_NOT_CONFIGURED' : 'EDGE_DISPATCH_FAILED',
    }, dispatch.status === 401 || dispatch.status === 403 ? 502 : dispatch.status);
  }

  if(canonicalAttempt&&lifecycleId){
    await markStockComputeDispatched(env,lifecycleId,'AUCTION_READY');
  }

  return json({
    ok: true,
    status: 'DISPATCHED',
    engine: 'EDGE_STOCKS',
    contract_version: 'EDGE_STOCKS_V1_3',
    research_contract_version: researchContractVersion ?? EDGE_RESEARCH_BUNDLE_VERSION,
    ticker,
    command: command.raw,
    research_bundle_id: researchBundleId,
    lifecycle_id: lifecycleId,
    market_snapshot_id: marketSnapshotId,
    auction_snapshot_id: auctionSnapshotIdForDispatch??null,
    build3_evidence_snapshot:evidenceSnapshotRef,
    baseline_run_id: baselineRunId,
    dispatched_at: dispatchedAt,
    fresh_run: true,
    reused_output: false,
    canonical_attempt: canonicalAttempt,
    canonical_attempt_slot: canonicalAttemptSlot,
    canonical_requested_at: canonicalRequestedAt ?? null,
    research_executed_this_run: true,
    trading_enabled: false,
    next: `/api/edge-stocks/invoke/status?ticker=${encodeURIComponent(ticker)}&after=${encodeURIComponent(dispatchedAt)}`,
  }, 202);
}

async function edgeStocksCanonicalTargets(env: Env): Promise<Response> {
  if (!env.EDGE_DATABASE_URL) return json({ error: 'EDGE database is not configured', code: 'EDGE_DATABASE_NOT_CONFIGURED' }, 503);
  const sql = neon(env.EDGE_DATABASE_URL);
  const rows = await sql`
    select distinct r.ticker,r.forecast_horizon,
           max(erb.research_fresh_at) as latest_research_fresh_at
      from recommendations r
      join recommendation_lifecycle l using(recommendation_id)
      left join recommendation_research_bundle rrb using(recommendation_id)
      left join edge_research_bundles erb using(bundle_id)
     where l.status='OPEN'
     group by r.ticker,r.forecast_horizon
     order by r.ticker,r.forecast_horizon
  `;
  return json({
    canonical_targets: rows.map(row => ({
      ticker: String(row.ticker).toUpperCase(),
      forecast_horizon: String(row.forecast_horizon),
      latest_research_fresh_at: row.latest_research_fresh_at ?? null,
    })),
    selection_key: 'ticker + target_trading_date + governed_horizon',
    research_max_age_minutes: 90,
    trading_enabled: false,
  });
}

async function edgeStocksInvocationStatus(env: Env, tickerRaw: string, afterRaw: string, lifecycleIdRaw?:string|null): Promise<Response> {
  if (!env.EDGE_DATABASE_URL) return json({ error: 'EDGE database is not configured', code: 'EDGE_DATABASE_NOT_CONFIGURED' }, 503);
  const ticker = normalizeTickerCandidate(tickerRaw);
  if (!ticker) return json({ error: 'Invalid ticker' }, 422);
  const lifecycleId=isNonEmptyString(lifecycleIdRaw)?String(lifecycleIdRaw):null;
  if(lifecycleId){
    const progressed=await progressNormalStockLifecycle(env,ticker,lifecycleId);
    if(progressed.status==='COMPLETE'){
      return json({
        status:'COMPLETE',ticker,lifecycle_id:lifecycleId,
        lifecycle_stage:progressed.lifecycle_stage,
        run_id:progressed.run_id??null,
        market_snapshot_id:progressed.market_snapshot_id??null,
        research_bundle_id:progressed.research_bundle_id??null,
        auction_snapshot_id:progressed.auction_snapshot_id??null,
        report_url:`/api/edge-stocks/report?ticker=${encodeURIComponent(ticker)}`,
        trading_enabled:false
      });
    }
    if(progressed.status==='BLOCKED'){
      return json({
        status:'BLOCKED',ticker,lifecycle_id:lifecycleId,
        lifecycle_stage:progressed.lifecycle_stage,
        market_snapshot_id:progressed.market_snapshot_id??null,
        research_bundle_id:progressed.research_bundle_id??null,
        auction_snapshot_id:progressed.auction_snapshot_id??null,
        detail:progressed.detail??null,
        trading_enabled:false
      },409);
    }
    return json({
      status:'RUNNING',ticker,lifecycle_id:lifecycleId,
      lifecycle_stage:progressed.lifecycle_stage,
      market_snapshot_id:progressed.market_snapshot_id??null,
      research_bundle_id:progressed.research_bundle_id??null,
      auction_snapshot_id:progressed.auction_snapshot_id??null,
      detail:progressed.detail??null,
      trading_enabled:false
    });
  }
  if (!isNonEmptyString(afterRaw) || Number.isNaN(Date.parse(afterRaw))) return json({ error: 'after or lifecycle_id is required' }, 422);
  const after = new Date(afterRaw).toISOString();
  const sql = neon(env.EDGE_DATABASE_URL);
  const rows = await sql`
    select recommendation_id, run_timestamp
      from recommendations
     where ticker = ${ticker}
       and run_timestamp > ${after}
     order by run_timestamp desc
     limit 1
  `;
  if (!rows.length) {
    return json({
      status: 'RUNNING_OR_BLOCKED',
      ticker,
      after,
      trading_enabled: false,
      note: 'No newer governed recommendation is published yet. The autonomous runner may still be running or may have failed closed.',
    });
  }
  return json({
    status: 'COMPLETE',
    ticker,
    run_id: String(rows[0].recommendation_id),
    run_timestamp: rows[0].run_timestamp,
    report_url: `/api/edge-stocks/report?ticker=${encodeURIComponent(ticker)}`,
    trading_enabled: false,
  });
}

async function edgeStocksReport(env: Env, ticker: string): Promise<Response> {
  if (!env.EDGE_DATABASE_URL) return json({ error: 'EDGE database is not configured', code: 'EDGE_DATABASE_NOT_CONFIGURED' }, 503);
  const symbol = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9._&-]{1,20}$/.test(symbol)) return json({ error: 'Invalid ticker' }, 422);

  const sql = neon(env.EDGE_DATABASE_URL);
  const masterRows = await sql`select * from v_edge_master_report limit 1`;
  const stockRows = await sql`select * from v_edge_stock_report where ticker = ${symbol} limit 1`;
  if (!masterRows.length) return json({ error: 'EDGE master assessment unavailable' }, 409);
  if (!stockRows.length) return json({ error: 'Ticker not found in EDGE stock assessment', ticker: symbol }, 404);

  const activeRows = await sql`
    select r.*, l.expiry_trading_date, p.current_price, p.current_return_pct, p.outcome_verdict,
           mt.evidence_quality_score, mt.freshness_score, mt.completeness_score,
           mt.directional_agreement_score, mt.market_confirmation_score,
           coalesce(mt.market_trust_score, r.market_trust_score) as resolved_market_trust_score,
           coalesce(mt.market_trust_band, r.market_trust_band) as resolved_market_trust_band,
           b.forecast_edge, b.market_trust as bot_market_trust, b.structure_pattern_quality,
           b.pv_pvpo_confirmation, b.catalyst_asymmetry, b.execution_quality,
           coalesce(b.bot_score, r.bot_score) as resolved_bot_score,
           coalesce(b.bot_grade, r.bot_grade) as resolved_bot_grade,
           coalesce(b.decision_ladder, r.decision_ladder) as resolved_decision_ladder,
           e.instrument, e.entry_low, e.entry_high, e.stop_price, e.invalidation_text,
           e.target1, e.target2, e.rr_t1, e.rr_t2, e.risk_unit_category, e.time_exit, e.option_strike, e.option_expiry,
           e.observed_premium, e.option_suitability_status, e.execution_quality_score, e.execution_quality_level
      from recommendations r
      join recommendation_lifecycle l using (recommendation_id)
      left join recommendation_performance p using (recommendation_id)
      left join market_trust mt using (recommendation_id)
      left join bot_scores b using (recommendation_id)
      left join execution_plans e using (recommendation_id)
     where r.ticker = ${symbol}
     order by r.run_timestamp desc
     limit 1
  `;
  if (!activeRows.length) return json({ error: 'No active EDGE call found', ticker: symbol }, 404);

  const allActiveRows = await sql`
    select a.ticker,a.recommendation_id,a.definitive_forecast,a.definitive_recommendation,
           a.expected_price_zone_low,a.expected_price_zone_high,a.expiry_trading_date,
           a.current_price,a.current_return_pct,a.outcome_verdict,a.open_recommendations,
           a.bull_probability,a.base_probability,a.bear_probability,
           r.run_timestamp as call_timestamp
      from v_edge_active_calls a
      left join recommendations r on r.recommendation_id = a.recommendation_id
     order by a.ticker
  `;

  const master = masterRows[0] as Record<string, unknown>;
  const stock = stockRows[0] as Record<string, unknown>;
  const active = activeRows[0] as Record<string, unknown>;

  let currentGovernance: Record<string, unknown> | null = null;
  let allRunMaster: Record<string, unknown> | null = null;
  let allRunStock: Record<string, unknown> | null = null;
  try {
    const governanceRows = await sql`
      select candidate_type,target_trading_date,requested_at,research_fresh_at,
             trigger_type,evidence_mode,market_session_as_of,benchmark_role
        from edge_recommendation_governance
       where recommendation_id=${String(active.recommendation_id)}
       limit 1
    `;
    currentGovernance = governanceRows.length ? governanceRows[0] as Record<string, unknown> : null;
  } catch {
    // Additive G5.1 migration may be staged immediately before Console deployment.
    currentGovernance = null;
  }
  try {
    const allRows = await sql`select * from v_edge_all_run_assessment limit 1`;
    allRunMaster = allRows.length ? allRows[0] as Record<string, unknown> : null;
    const stockAllRows = await sql`select * from v_edge_stock_all_run_assessment where ticker=${symbol} limit 1`;
    allRunStock = stockAllRows.length ? stockAllRows[0] as Record<string, unknown> : null;
  } catch {
    allRunMaster = null;
    allRunStock = null;
  }
  const parentRecommendationId = isNonEmptyString(active.parent_recommendation_id)
    ? String(active.parent_recommendation_id)
    : null;
  let previousRecommendation: Record<string, unknown> | null = null;
  if (parentRecommendationId) {
    const previousRows = await sql`
      select r.recommendation_id,r.run_timestamp,r.definitive_forecast,r.definitive_recommendation,
             r.expected_price_zone_low,r.expected_price_zone_high,
             l.status as lifecycle_status,l.expiry_trading_date,
             p.current_price,p.current_return_pct,p.outcome_verdict,p.last_assessed_at
        from recommendations r
        left join recommendation_lifecycle l using (recommendation_id)
        left join recommendation_performance p using (recommendation_id)
       where r.recommendation_id = ${parentRecommendationId}
       limit 1
    `;
    if (previousRows.length) {
      const previous = previousRows[0] as Record<string, unknown>;
      previousRecommendation = {
        recommendation_id: String(previous.recommendation_id),
        run_timestamp: previous.run_timestamp ?? null,
        definitive_forecast: previous.definitive_forecast ?? null,
        definitive_recommendation: previous.definitive_recommendation ?? null,
        expected_price_zone: {
          low: numberOrNull(previous.expected_price_zone_low),
          high: numberOrNull(previous.expected_price_zone_high),
        },
        lifecycle_status: previous.lifecycle_status ?? null,
        expiry_trading_date: previous.expiry_trading_date ?? null,
        current_price: numberOrNull(previous.current_price),
        current_return_pct: numberOrNull(previous.current_return_pct),
        outcome_verdict: previous.outcome_verdict ?? 'OPEN',
        last_assessed_at: previous.last_assessed_at ?? null,
      };
    }
  }
  const componentRows = await sql`
    select component, original_weight, raw_score, normalized_direction, evidence_quality,
           availability_status, normalized_weight, weighted_contribution, conflict_flag,
           gate_override_flag, notes
      from component_scores
     where recommendation_id = ${String(active.recommendation_id)}
     order by component
  `;
  const researchRows = await sql`
    select erb.payload
      from recommendation_research_bundle rrb
      join edge_research_bundles erb using (bundle_id)
     where rrb.recommendation_id = ${String(active.recommendation_id)}
     order by rrb.linked_at desc
     limit 1
  `;
  const researchPayload = researchRows.length && isObject(researchRows[0].payload)
    ? researchRows[0].payload as Record<string, unknown>
    : {};
  const researchClaims = Array.isArray(researchPayload.claims)
    ? researchPayload.claims.filter(isObject)
    : [];

  const des = numberOrNull(active.des);
  const marketTrust = numberOrNull(active.resolved_market_trust_score);
  const directionalAgreement = numberOrNull(active.directional_agreement_score);
  const botScore = numberOrNull(active.resolved_bot_score);
  const marketTrustBand = active.resolved_market_trust_band;
  const botGrade = active.resolved_bot_grade;
  const decisionLadder = active.resolved_decision_ladder;
  const forecastHorizon = active.forecast_horizon;
  const primaryAction = active.definitive_recommendation;
  const definitiveForecast = active.definitive_forecast;
  if (
    des === null || marketTrust === null || directionalAgreement === null || botScore === null ||
    !isNonEmptyString(marketTrustBand) || !isNonEmptyString(botGrade) ||
    !isNonEmptyString(decisionLadder) || !isNonEmptyString(forecastHorizon) ||
    !isNonEmptyString(primaryAction) || !isNonEmptyString(definitiveForecast)
  ) {
    return json({ error: 'EDGE Stocks V1.3 publication blocked: governed decision fields missing', ticker: symbol }, 409);
  }
  if (!componentRows.length) {
    return json({ error: 'EDGE Stocks V1.3 publication blocked: drill-down is empty', ticker: symbol }, 409);
  }

  const parseNotes = (value: unknown): { key_outcome?: string; interpretation?: string } => {
    if (!isNonEmptyString(value)) return {};
    try {
      const parsed = JSON.parse(value);
      return isObject(parsed) ? {
        key_outcome: isNonEmptyString(parsed.key_outcome) ? String(parsed.key_outcome) : undefined,
        interpretation: isNonEmptyString(parsed.interpretation) ? String(parsed.interpretation) : undefined,
      } : {};
    } catch {
      return { interpretation: String(value) };
    }
  };

  const scoreLabel = (value: unknown): string => {
    const n = Number(value);
    return n === 2 ? 'STRONGLY POSITIVE' : n === 1 ? 'POSITIVE' : n === 0 ? 'NEUTRAL' : n === -1 ? 'NEGATIVE' : n === -2 ? 'STRONGLY NEGATIVE' : 'NOT VERIFIED';
  };
  const legacyInterpretation = (componentRaw: unknown, scoreRaw: unknown): string => {
    const component = String(componentRaw || '').toUpperCase().replace(/[^A-Z0-9]+/g,'_');
    const score = Number(scoreRaw);
    const tone = scoreLabel(scoreRaw).toLowerCase();
    const consequence =
      component.includes('PRICE_STRUCTURE') ? 'Near-term price structure is therefore a material input to the D+5 direction.' :
      component.includes('PV') ? 'Price/volume/options confirmation is therefore influencing directional conviction.' :
      component.includes('RELATIVE_STRENGTH') ? 'Relative performance versus the benchmark is therefore influencing directional conviction.' :
      component.includes('BUSINESS_FUNDAMENTALS') ? 'Business fundamentals are therefore acting as a medium-term support or drag within the five-day framework.' :
      component.includes('VALUATION') ? 'Valuation is therefore acting as a supporting or limiting factor rather than a standalone trigger.' :
      component.includes('INSTITUTIONAL') ? 'Institutional ownership/behaviour evidence is therefore contributing to confirmation quality.' :
      component.includes('NEWS') || component.includes('CATALYST') ? 'Recent catalysts are therefore contributing to the risk/reward balance.' :
      component.includes('EVENT_SHOCK') ? 'Event-risk evidence is therefore affecting the risk overlay rather than creating direction by itself.' :
      component.includes('CHART_PATTERN') ? 'The active chart-pattern signal is therefore contributing to the near-term setup.' :
      'This governed component is contributing to the overall EDGE direction and conviction.';
    return 'Legacy active run: the original narrative field was not persisted. The immutable verified component score is '+(Number.isFinite(score) ? score.toFixed(0) : 'N/A')+' ('+tone+'); '+consequence;
  };
  const componentKey = (value: unknown): string => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g,'_');
  const researchFinding = (componentRaw: unknown): string | undefined => {
    const component = componentKey(componentRaw);
    const statements = researchClaims
      .filter((claim: Record<string, unknown>) =>
        componentKey(claim.evidence_category) === component &&
        String(claim.verification_status || '').toUpperCase() === 'VERIFIED' &&
        isNonEmptyString(claim.statement)
      )
      .map((claim: Record<string, unknown>) => String(claim.statement).trim());
    return [...new Set(statements)].join(' ') || undefined;
  };
  const plainFinding = (
    componentRaw: unknown,
    scoreRaw: unknown,
    verification: string,
    notes: { key_outcome?: string; interpretation?: string },
  ): string => {
    const component = componentKey(componentRaw);
    const fromResearch = researchFinding(component);
    if (fromResearch) return fromResearch;

    if (verification !== 'VERIFIED') {
      if (component.includes('INSTITUTIONAL')) {
        return 'This run did not contain independently verified FII, DII or mutual-fund holding/flow evidence, so EDGE left Institutional Behaviour unscored.';
      }
      if (component.includes('VALUATION')) {
        return 'This run did not contain independently verified valuation evidence that met the EDGE evidence gate, so valuation was left unscored.';
      }
      return 'This run did not contain enough verified evidence to score this factor.';
    }

    const n = Number(scoreRaw);
    const raw = String(notes.interpretation || '');
    const patternMatch = raw.match(/(?:pattern is|pattern as)\s+([A-Z0-9_ -]+)/i);
    const pattern = patternMatch ? patternMatch[1].trim().replace(/_/g,' ').toLowerCase() : '';

    if (component.includes('PRICE_STRUCTURE')) {
      if (pattern === 'range' || n === 0) return 'The latest price structure is range-bound, with no confirmed directional break.';
      if (n > 0) return 'The latest price structure is trending higher and supports the five-day setup.';
      return 'The latest price structure is trending lower and weakens the five-day setup.';
    }
    if (component.includes('SPECIFIC_CHART_PATTERN') || component.includes('CHART_PATTERN')) {
      if (pattern === 'range' || n === 0) return 'Daily candles are still range-bound; no breakout or breakdown pattern is confirmed.';
      return pattern
        ? 'Daily candles show a '+pattern+' pattern.'
        : 'Daily candles show a verified directional chart pattern.';
    }
    if (component.includes('PV_PVPO') || component === 'PVPO' || component === 'PV') {
      if (n > 0) return 'Price and volume are confirming the current move; options open interest is used only as secondary confirmation when available.';
      if (n < 0) return 'Price and volume are weakening the current move; options open interest is used only as secondary confirmation when available.';
      return 'Price and volume are not giving a clear directional confirmation; options open interest is secondary confirmation only.';
    }
    if (component.includes('RELATIVE_STRENGTH')) {
      if (n > 0) return 'The stock is outperforming NIFTY 50 over the EDGE comparison window.';
      if (n < 0) return 'The stock is underperforming NIFTY 50 over the EDGE comparison window.';
      return 'The stock is showing no meaningful relative-performance edge versus NIFTY 50.';
    }
    return notes.interpretation || notes.key_outcome || scoreLabel(scoreRaw);
  };

  const drilldown = componentRows.map((row: Record<string, unknown>) => {
    const verification = componentVerificationStatus(row.availability_status, row.evidence_quality);
    const notes = parseNotes(row.notes);
    const persistedKeyOutcome = isNonEmptyString(notes.key_outcome) ? String(notes.key_outcome).trim() : '';
    const persistedInterpretation = isNonEmptyString(notes.interpretation) ? String(notes.interpretation).trim() : '';
    // G5.1 presentation closure: VERIFIED semantics must come from persisted governed
    // evidence. Do not reconstruct or infer a narrative from the numeric score.
    const keyOutcome = verification === 'VERIFIED'
      ? persistedKeyOutcome
      : (persistedKeyOutcome || (row.conflict_flag ? 'MATERIAL CONFLICT' : String(row.availability_status ?? 'NOT_VERIFIED')));
    const interpretation = verification === 'VERIFIED'
      ? persistedInterpretation
      : (persistedInterpretation || 'Evidence not verified; no interpretation inferred.');
    return {
      component: String(row.component),
      score_or_level: row.raw_score ?? 'N/A',
      original_weight: numberOrNull(row.original_weight),
      normalized_direction: numberOrNull(row.normalized_direction),
      normalized_weight: numberOrNull(row.normalized_weight),
      weighted_contribution: numberOrNull(row.weighted_contribution),
      evidence_quality: row.evidence_quality ?? null,
      conflict_flag: row.conflict_flag === true,
      gate_override_flag: row.gate_override_flag ?? null,
      verification_status: verification,
      key_outcome: keyOutcome,
      finding: plainFinding(row.component,row.raw_score,verification,notes),
      interpretation,
      narrative_source: verification === 'VERIFIED' ? 'PERSISTED_EVIDENCE_NARRATIVE' : 'UNVERIFIED_EVIDENCE_STATE',
    };
  });

  const effectiveConviction = Math.min(Math.abs(des) / 100, 1) * (marketTrust / 100);
  const overrideCode = active.active_override == null ? null : String(active.active_override);

  const forecastPathHeaderRows = await sql`
    select path_version,source_run_id,issued_at,payload_hash
      from edge_stock_forecast_paths
     where recommendation_id=${String(active.recommendation_id)}
     limit 1
  `;

  let forecastPath: Record<string, unknown> | null = null;
  let forecastSessions: Record<string, unknown>[] | null = null;

  if (forecastPathHeaderRows.length) {
    const header = forecastPathHeaderRows[0] as Record<string, unknown>;
    const pathRows = await sql`
      select horizon_index,horizon_label,target_trading_date,direction,
             bull_probability,base_probability,bear_probability,expected_centre,
             outer_expected_zone_low,outer_expected_zone_high,evidence_basis,
             regime_context,verification_state,lineage
        from edge_stock_forecast_path_rows
       where recommendation_id=${String(active.recommendation_id)}
       order by horizon_index asc
    `;
    const expectedLabels=['D','D+1','D+2','D+3','D+4'];
    const labels=pathRows.map((row:Record<string,unknown>)=>String(row.horizon_label));
    const indices=pathRows.map((row:Record<string,unknown>)=>Number(row.horizon_index));
    if (
      pathRows.length !== 5
      || labels.some((label:string,index:number)=>label!==expectedLabels[index])
      || indices.some((index:number,position:number)=>index!==position)
    ) {
      return json({
        error:'EDGE Stocks G5 publication blocked: stored forecast path is incomplete or misordered',
        code:'EDGE_G5_FORECAST_PATH_INCOMPLETE',
        ticker:symbol,
        recommendation_id:String(active.recommendation_id),
        labels,
        indices,
      },409);
    }

    const sessions=pathRows.map((row:Record<string,unknown>,index:number)=>{
      const tradingDate=dateOnly(row.target_trading_date);
      const bull=numberOrNull(row.bull_probability);
      const base=numberOrNull(row.base_probability);
      const bear=numberOrNull(row.bear_probability);
      const low=numberOrNull(row.outer_expected_zone_low);
      const high=numberOrNull(row.outer_expected_zone_high);
      const lineage=isObject(row.lineage) ? row.lineage as JsonRecord : null;
      if (
        !tradingDate || bull===null || base===null || bear===null
        || low===null || high===null || low>high || !lineage
        || Math.abs(bull+base+bear-100)>0.01
      ) {
        throw new Error('EDGE_G5_FORECAST_PATH_ROW_INVALID:'+expectedLabels[index]);
      }
      const direction=String(row.direction||'');
      const leaders=[
        ['BULL',bull],['BASE',base],['BEAR',bear]
      ].sort((a,b)=>Number(b[1])-Number(a[1]));
      if (!direction || direction!==leaders[0][0]) {
        throw new Error('EDGE_G5_FORECAST_PATH_DIRECTION_INVALID:'+expectedLabels[index]);
      }
      return {
        session_label:expectedLabels[index],
        trading_date:tradingDate,
        direction,
        probabilities:{bull,base,bear},
        expected_centre:numberOrNull(row.expected_centre),
        expected_zone:{low,high},
        evidence_basis:String(row.evidence_basis||''),
        regime_context:String(row.regime_context||''),
        verification_state:String(row.verification_state||''),
        lineage,
      };
    });

    const generatedAt = new Date(String(header.issued_at)).toISOString();
    const payloadHash=String(header.payload_hash||'');
    if (!payloadHash) {
      return json({
        error:'EDGE Stocks G5 publication blocked: forecast path hash missing',
        code:'EDGE_G5_FORECAST_PATH_HASH_MISSING',
        ticker:symbol,
        recommendation_id:String(active.recommendation_id),
      },409);
    }
    forecastSessions=sessions;
    forecastPath={
      version:String(header.path_version),
      source_run_id:String(header.source_run_id),
      generated_at:generatedAt,
      payload_hash:payloadHash,
      sessions:sessions.map(row=>({
        label:row.session_label,
        target_session:row.trading_date,
        probabilities:row.probabilities,
        expected_price_zone:row.expected_zone,
        lineage_id:payloadHash+':'+String(row.session_label),
      })),
    };
  }

  let build3Precision: ReturnType<typeof build3PrecisionOutput> = null;
  if (env.DATABASE_URL && forecastSessions) {
    try {
      const lifecycleRows = await sql`
        select lifecycle_id
          from edge_run_lifecycles
         where recommendation_id=${String(active.recommendation_id)}
         order by updated_at desc
         limit 1
      `;
      if (lifecycleRows.length) {
        const lifecycleId=String(lifecycleRows[0].lifecycle_id);
        const registry=await readBuild3RunRegistryRecord(env.DATABASE_URL,'EDGE_STOCKS',lifecycleId);
        if(registry){
          const precisionRows=await readBuild3OutputPrecision(env.DATABASE_URL,'EDGE_STOCKS',lifecycleId);
          if(!precisionRows.length)throw new Error('BUILD3_OUTPUT_STOCK_PRECISION_MISSING');
          const byHorizon=new Map(precisionRows.map(row=>[row.horizon,row]));
          forecastSessions=forecastSessions.map((session:Record<string,unknown>)=>{
            const label=String(session.session_label);
            const precision=byHorizon.get(label as 'D'|'D+1'|'D+2'|'D+3'|'D+4');
            if(!precision)throw new Error('BUILD3_OUTPUT_STOCK_PRECISION_HORIZON_MISSING:'+label);
            const expectedZone=isObject(session.expected_zone)?session.expected_zone as JsonRecord:{};
            const same=(a:unknown,b:number)=>{
              const n=Number(a);
              return Number.isFinite(n)&&Math.abs(n-b)<=Math.max(1e-6,Math.abs(b)*1e-9);
            };
            if(String(session.trading_date)!==precision.target_session){
              throw new Error('BUILD3_OUTPUT_STOCK_SESSION_PARITY_MISMATCH:'+label);
            }
            if(!same(expectedZone.low,precision.outer_low)||!same(expectedZone.high,precision.outer_high)){
              throw new Error('BUILD3_OUTPUT_STOCK_OUTER_ZONE_PARITY_MISMATCH:'+label);
            }
            return {
              ...session,
              core_zone:{low:precision.core_low,high:precision.core_high},
              core_zone_width_points:precision.core_width_points,
              core_zone_width_percent:precision.core_width_percent,
              core_zone_calibration:{
                version:precision.calibration_version,
                state:precision.calibration_state,
                normalization_basis:precision.normalization_basis,
                shadow_only:true,
                production_methodology_changed:false,
              },
            };
          });
          build3Precision=build3PrecisionOutput(precisionRows);
        }
      }
    } catch(error) {
      return json({
        error:'Build 3.0 stock precision readback blocked',
        code:'BUILD3_OUTPUT_STOCK_PRECISION_BLOCKED',
        detail:error instanceof Error?error.message:String(error),
        ticker:symbol,
        recommendation_id:String(active.recommendation_id),
      },409);
    }
  }

  const canonicalRows = await sql`
    select canonical_key,target_trading_date,forecast_horizon,selection_status,canonical_type,
           selected_recommendation_id,selected_at,selection_reason
      from edge_canonical_selections
     where ticker = ${symbol}
     order by target_trading_date desc, selected_at desc
     limit 1
  `;
  const canonical = canonicalRows.length ? canonicalRows[0] as Record<string, unknown> : null;

  const payload = {
    contract_version: 'EDGE_STOCKS_V1_3',
    presentation_contract: 'EFFICACY_V2',
    engine: 'EDGE_STOCKS',
    framework_version: 'EDGE_V1',
    ticker: symbol,
    run_id: String(active.recommendation_id),
    generated_at: new Date(String(active.run_timestamp ?? new Date().toISOString())).toISOString(),
    build3_precision: build3Precision,
    run_provenance: currentGovernance ? {
      trigger_type: currentGovernance.trigger_type ?? null,
      evidence_mode: currentGovernance.evidence_mode ?? null,
      market_session_as_of: currentGovernance.market_session_as_of ?? null,
      research_as_of: currentGovernance.research_fresh_at ?? null,
      target_session: currentGovernance.target_trading_date ?? null,
      benchmark_role: currentGovernance.benchmark_role ?? null,
      candidate_type: currentGovernance.candidate_type ?? null,
      requested_at: currentGovernance.requested_at ?? null,
    } : null,
    forecast_path: forecastPath,
    canonical_governance: canonical ? {
      canonical_key: canonical.canonical_key,
      target_trading_date: canonical.target_trading_date,
      forecast_horizon: canonical.forecast_horizon,
      selection_status: canonical.selection_status,
      canonical_type: canonical.canonical_type,
      selected_recommendation_id: canonical.selected_recommendation_id,
      selected_at: canonical.selected_at,
      selection_reason: canonical.selection_reason,
      current_run_is_selected: String(canonical.selected_recommendation_id ?? '') === String(active.recommendation_id),
    } : {
      selection_status: 'NOT_AVAILABLE',
      canonical_type: 'NOT_AVAILABLE',
      current_run_is_selected: false,
    },
    presentation: {
      standard_table_count: 4,
      table_1: 'EDGE_MASTER_ASSESSMENT',
      table_2: 'ACTIVE_CALLS',
      table_3: 'CURRENT_STOCK_OUTCOME',
      table_4: 'DRILLDOWN'
    },
    master_assessment: {
      all_run_efficacy: allRunMaster ? {
        recommendations: integerOrZero(allRunMaster.recommendations),
        unique_stocks: integerOrZero(allRunMaster.unique_stocks),
        open_recommendations: integerOrZero(allRunMaster.open_recommendations),
        closed_recommendations: integerOrZero(allRunMaster.closed_recommendations),
        scorable_recommendations: integerOrZero(allRunMaster.scorable_recommendations),
        recommendation_hit_rate_pct: numberOrNull(allRunMaster.recommendation_hit_rate_pct),
        direction_hit_rate_pct: numberOrNull(allRunMaster.direction_hit_rate_pct),
        target_hit_rate_pct: numberOrNull(allRunMaster.target_hit_rate_pct),
      } : null,
      recommendations: integerOrZero(master.recommendations),
      unique_stocks: integerOrZero(master.unique_stocks),
      open_recommendations: integerOrZero(master.open_recommendations),
      closed_recommendations: integerOrZero(master.closed_recommendations),
      official_scorable_recommendations: integerOrZero(master.official_scorable_recommendations),
      recommendation_hit_rate_pct: numberOrNull(master.recommendation_hit_rate_pct),
      direction_hit_rate_pct: numberOrNull(master.direction_hit_rate_pct),
      target_hit_rate_pct: numberOrNull(master.target_hit_rate_pct),
      avg_gain_pct: numberOrNull(master.avg_gain_pct),
      avg_loss_pct: numberOrNull(master.avg_loss_pct),
      avg_mfe_pct: numberOrNull(master.avg_mfe_pct),
      avg_mae_pct: numberOrNull(master.avg_mae_pct),
      cumulative_model_pnl_units: numberOrNull(master.cumulative_model_pnl_units),
      provisional_captured_checkpoints: integerOrZero(master.provisional_captured_checkpoints),
      provisional_due_checkpoints: integerOrZero(master.provisional_due_checkpoints),
      provisional_forecast_scorable: integerOrZero(master.provisional_forecast_scorable),
      provisional_forecast_hits: integerOrZero(master.provisional_forecast_hits),
      provisional_forecast_misses: integerOrZero(master.provisional_forecast_misses),
      provisional_forecast_accuracy_pct: numberOrNull(master.provisional_forecast_accuracy_pct),
      provisional_zone_scorable: integerOrZero(master.provisional_zone_scorable),
      provisional_zone_hits: integerOrZero(master.provisional_zone_hits),
      provisional_zone_misses: integerOrZero(master.provisional_zone_misses),
      provisional_zone_accuracy_pct: numberOrNull(master.provisional_zone_accuracy_pct),
      stock_assessment: {
        ticker: symbol,
        all_run_efficacy: allRunStock ? {
          recommendations: integerOrZero(allRunStock.recommendations),
          open_recommendations: integerOrZero(allRunStock.open_recommendations),
          closed_recommendations: integerOrZero(allRunStock.closed_recommendations),
          scorable_recommendations: integerOrZero(allRunStock.scorable_recommendations),
          recommendation_hit_rate_pct: numberOrNull(allRunStock.recommendation_hit_rate_pct),
          direction_hit_rate_pct: numberOrNull(allRunStock.direction_hit_rate_pct),
          target_hit_rate_pct: numberOrNull(allRunStock.target_hit_rate_pct),
        } : null,
        recommendations: integerOrZero(stock.recommendations),
        open_recommendations: integerOrZero(stock.open_recommendations),
        closed_recommendations: integerOrZero(stock.closed_recommendations),
        official_scorable_recommendations: integerOrZero(stock.official_scorable_recommendations),
        recommendation_hit_rate_pct: numberOrNull(stock.recommendation_hit_rate_pct),
        direction_hit_rate_pct: numberOrNull(stock.direction_hit_rate_pct),
        target_hit_rate_pct: numberOrNull(stock.target_hit_rate_pct),
        avg_gain_pct: numberOrNull(stock.avg_gain_pct),
        avg_loss_pct: numberOrNull(stock.avg_loss_pct),
        avg_mfe_pct: numberOrNull(stock.avg_mfe_pct),
        avg_mae_pct: numberOrNull(stock.avg_mae_pct),
        cumulative_model_pnl_units: numberOrNull(stock.cumulative_model_pnl_units),
        provisional_captured_checkpoints: integerOrZero(stock.provisional_captured_checkpoints),
        provisional_due_checkpoints: integerOrZero(stock.provisional_due_checkpoints),
        provisional_forecast_scorable: integerOrZero(stock.provisional_forecast_scorable),
        provisional_forecast_hits: integerOrZero(stock.provisional_forecast_hits),
        provisional_forecast_misses: integerOrZero(stock.provisional_forecast_misses),
        provisional_forecast_accuracy_pct: numberOrNull(stock.provisional_forecast_accuracy_pct),
        provisional_zone_scorable: integerOrZero(stock.provisional_zone_scorable),
        provisional_zone_hits: integerOrZero(stock.provisional_zone_hits),
        provisional_zone_misses: integerOrZero(stock.provisional_zone_misses),
        provisional_zone_accuracy_pct: numberOrNull(stock.provisional_zone_accuracy_pct),
        latest_checkpoint_observed_at: stock.latest_checkpoint_observed_at ?? null,
        previous_recommendation: previousRecommendation,
      }
    },
    active_calls: allActiveRows.map((row: Record<string, unknown>) => ({
      ticker: String(row.ticker),
      recommendation_id: String(row.recommendation_id),
      definitive_forecast: row.definitive_forecast,
      definitive_recommendation: row.definitive_recommendation,
      expected_price_zone: { low: numberOrNull(row.expected_price_zone_low), high: numberOrNull(row.expected_price_zone_high) },
      call_timestamp: row.call_timestamp ?? null,
      expiry_trading_date: row.expiry_trading_date ?? null,
      current_price: numberOrNull(row.current_price),
      current_return_pct: numberOrNull(row.current_return_pct),
      outcome_verdict: row.outcome_verdict ?? 'OPEN',
      probabilities: { bull: numberOrNull(row.bull_probability), base: numberOrNull(row.base_probability), bear: numberOrNull(row.bear_probability) }
    })),
    current_stock_outcome: {
      des,
      market_trust: {
        score: marketTrust,
        band: marketTrustBand,
        subscores: {
          evidence_quality: numberOrNull(active.evidence_quality_score),
          freshness: numberOrNull(active.freshness_score),
          completeness: numberOrNull(active.completeness_score),
          directional_agreement: directionalAgreement,
          market_confirmation: numberOrNull(active.market_confirmation_score)
        },
        weights: { evidence_quality:30, freshness:20, completeness:15, directional_agreement:20, market_confirmation:15 }
      },
      directional_agreement: directionalAgreement,
      effective_conviction: Number(effectiveConviction.toFixed(6)),
      probabilities: {
        bull: numberOrNull(active.bull_probability),
        base: numberOrNull(active.base_probability),
        bear: numberOrNull(active.bear_probability)
      },
      definitive_forecast: definitiveForecast,
      expected_price_zone: { low: numberOrNull(active.expected_price_zone_low), high: numberOrNull(active.expected_price_zone_high) },
      forecast_horizon: forecastPath ? 'D:D+4' : forecastHorizon,
      forecast_sessions: forecastSessions,
      risk_override: { status: overrideCode ? 'ACTIVE' : 'CLEAR', code: overrideCode },
      primary_action: primaryAction,
      decision_ladder: decisionLadder,
      bot: {
        score: botScore,
        grade: botGrade,
        subscores: {
          forecast_edge: numberOrNull(active.forecast_edge),
          market_trust: numberOrNull(active.bot_market_trust),
          structure_pattern_quality: numberOrNull(active.structure_pattern_quality),
          pv_pvpo_confirmation: numberOrNull(active.pv_pvpo_confirmation),
          catalyst_asymmetry: numberOrNull(active.catalyst_asymmetry),
          execution_quality: numberOrNull(active.execution_quality)
        },
        weights: { forecast_edge:25, market_trust:20, structure_pattern_quality:20, pv_pvpo_confirmation:15, catalyst_asymmetry:10, execution_quality:10 }
      },
      execution: {
        instrument: active.instrument ?? 'NONE',
        entry_low: numberOrNull(active.entry_low),
        entry_high: numberOrNull(active.entry_high),
        stop_price: numberOrNull(active.stop_price),
        invalidation: active.invalidation_text ?? null,
        target1: numberOrNull(active.target1),
        target2: numberOrNull(active.target2),
        rr_t1: numberOrNull(active.rr_t1),
        rr_t2: numberOrNull(active.rr_t2),
        risk_unit_category: active.risk_unit_category ?? null,
        time_exit: active.time_exit ?? null,
        option_strike: numberOrNull(active.option_strike),
        option_expiry: active.option_expiry ?? null,
        observed_premium: numberOrNull(active.observed_premium),
        option_suitability_status: active.option_suitability_status ?? null,
        execution_quality_score: numberOrNull(active.execution_quality_score),
        execution_quality_level: active.execution_quality_level ?? null
      },
      current_price: numberOrNull(active.current_price),
      current_return_pct: numberOrNull(active.current_return_pct),
      expiry_trading_date: active.expiry_trading_date ?? null,
      outcome_status: active.outcome_verdict ?? 'OPEN'
    },
    drilldown
  };

  // G5.1 presentation closure: the genuine D:D+4 producer is promoted.
  // A standard production report without the immutable five-row path is incomplete
  // and must fail closed rather than falling back to the aggregate forecast.
  const errors = validateEdgeStocksResult(payload, { requireForecastPath: true });
  if (errors.length) return json({ error: 'EDGE Stocks V1.3 semantic contract validation failed', details: errors, ticker: symbol }, 409);
  return json({ report: payload });
}

async function ipoEdgeSnapshot(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  try {
    const live = await fetch('https://raw.githubusercontent.com/kanirudhsaxena-code/IPO-EDGE/main/runtime/console_snapshot.json', {
      headers: { 'accept': 'application/json', 'user-agent': 'EDGE-CONSOLE-IPO-SNAPSHOT/1.0' },
      cf: { cacheTtl: 60, cacheEverything: true }
    } as RequestInit);
    if (live.ok) {
      const payload = await live.json();
      if (isObject(payload) && Array.isArray(payload.issues)) {
        return json({ snapshot: { captured_at: payload.captured_at ?? null, payload }, source: 'IPO_EDGE_REPO' });
      }
    }
  } catch {}
  if (!env.DATABASE_URL) return json({ error: 'IPO snapshot unavailable' }, 503);
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`select captured_at,payload from ipo_console_snapshots order by captured_at desc,id desc limit 1`;
  return json({ snapshot: rows[0] ?? null, source: 'CONSOLE_FALLBACK' });
}

async function edgeStocksHistory(env: Env, tickerRaw: string): Promise<Response> {
  if (!env.EDGE_DATABASE_URL) return json({ error: 'EDGE database is not configured', code: 'EDGE_DATABASE_NOT_CONFIGURED' }, 503);
  const ticker = normalizeTickerCandidate(tickerRaw);
  if (!ticker) return json({ error: 'Invalid ticker' }, 422);
  const sql = neon(env.EDGE_DATABASE_URL);
  const rows = await sql`
    select r.recommendation_id,r.run_timestamp,r.definitive_forecast,r.definitive_recommendation,
           r.expected_price_zone_low,r.expected_price_zone_high,r.bull_probability,r.base_probability,r.bear_probability,
           p.current_return_pct,p.outcome_verdict,l.status,l.expiry_trading_date
      from recommendations r
      left join recommendation_performance p using(recommendation_id)
      left join recommendation_lifecycle l using(recommendation_id)
     where r.ticker=${ticker}
     order by r.run_timestamp desc
     limit 8
  `;
  return json({ ticker, recommendations: rows });
}

async function edgeStocksMaster(env: Env): Promise<Response> {
  if (!env.EDGE_DATABASE_URL) return json({ error: 'EDGE database is not configured', code: 'EDGE_DATABASE_NOT_CONFIGURED' }, 503);
  const sql = neon(env.EDGE_DATABASE_URL);
  const rows = await sql`select * from v_edge_master_report limit 1`;
  return json({ master: rows[0] ?? null, labels: { official: 'OFFICIAL', provisional: 'PROVISIONAL' } });
}

async function edgeStocksPreopenStatus(env:Env,tickerRaw:string,dateRaw:string):Promise<Response>{
  if(!env.EDGE_DATABASE_URL)return json({error:'EDGE database is not configured'},503);
  const ticker=tickerRaw.trim().toUpperCase();
  const targetDate=dateRaw.trim();
  if(!/^[A-Z0-9._&-]{1,20}$/.test(ticker))return json({error:'ticker is invalid'},422);
  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(targetDate))return json({error:'date=YYYY-MM-DD is mandatory'},422);
  const parsed=new Date(targetDate+'T00:00:00Z');
  if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==targetDate)return json({error:'date is invalid'},422);
  const sql=neon(env.EDGE_DATABASE_URL);
  const rows=await sql`
    select g.recommendation_id,g.canonical_key,g.candidate_type,g.target_trading_date,
           g.requested_at,g.completed_at,g.research_fresh_at,g.fallback_reason,
           g.trigger_type,g.evidence_mode,g.market_session_as_of,g.benchmark_role,
           r.run_timestamp,r.forecast_horizon
      from edge_recommendation_governance g
      join recommendations r using(recommendation_id)
     where g.ticker=${ticker}
       and g.target_trading_date=${targetDate}::date
     order by g.requested_at desc
  `;
  const bounded=rows.map((row:any)=>({
    recommendation_id:String(row.recommendation_id),
    canonical_key:row.canonical_key,
    candidate_type:row.candidate_type,
    target_trading_date:row.target_trading_date,
    requested_at:row.requested_at,
    completed_at:row.completed_at,
    research_fresh_at:row.research_fresh_at,
    trigger_type:row.trigger_type,
    evidence_mode:row.evidence_mode,
    market_session_as_of:row.market_session_as_of,
    benchmark_role:row.benchmark_role,
    forecast_horizon:row.forecast_horizon,
    fallback_reason:row.fallback_reason??null
  }));
  const preopen=bounded.find((row:any)=>
    row.candidate_type==='PREOPEN_CANONICAL'&&
    row.trigger_type==='SCHEDULED'&&
    row.evidence_mode==='PREOPEN'&&
    row.benchmark_role==='SESSION_PREOPEN'
  )??null;
  let selection:any=null;
  if(preopen?.canonical_key){
    const selected=await sql`
      select selection_status,canonical_type,selected_recommendation_id,selected_at,selection_reason
        from edge_canonical_selections
       where canonical_key=${preopen.canonical_key}
       limit 1
    `;
    selection=selected.length?selected[0]:null;
  }
  return json({
    status:preopen?'PREOPEN_CANDIDATE_COMPLETE':'MISSING',
    ticker,
    target_date:targetDate,
    preopen,
    canonical_selection:selection,
    observed_candidates:bounded,
    trading_enabled:false
  },preopen?200:404);
}


export default { async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/5dr/run-requests' && request.method === 'POST') return readinessGate(request, env);
  const normalized = url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/normalized$/);
  if (normalized && request.method === 'POST') return saveNormalizedEvidence(request, env, decodeURIComponent(normalized[1]));
  const packet = url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/execution-packet$/);
  if (packet && request.method === 'GET') return executionPacket(env, decodeURIComponent(packet[1]));
  const failed = url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/fail$/);
  if (failed && request.method === 'POST') return failRequest(request, env, decodeURIComponent(failed[1]));
  if (url.pathname === '/api/5dr/latest' && request.method === 'GET') {
    if(!env.DATABASE_URL)return json({run:null,note:'DATABASE_URL not configured yet'},503);
    const sql=neon(env.DATABASE_URL);
    const rows=await sql`
      select run_id,contract_version,framework_version,status,provenance_mode,sources,
             freshness_at,generated_at,result,warnings,published
        from analysis_runs
       where engine='5DR' and published=true
       order by generated_at desc
       limit 1
    `;
    if(!rows.length)return json({run:null,note:'No published 5DR run yet'});
    const run=rows[0] as Record<string,unknown>;
    const precision=await readBuild3NiftyPrecisionByRunId(env.DATABASE_URL,String(run.run_id));
    return json({
      run:{...run,build3_precision:precision?build3PrecisionOutput(precision.rows):null},
      note:undefined
    });
  }
  if (url.pathname === '/api/5dr/canonical-handoff' && request.method === 'GET') return fiveDrCanonicalHandoff(env);
  if (url.pathname === '/api/5dr/assessment-import' && request.method === 'POST') return fiveDrAssessmentImport(request, env);
  if (url.pathname.startsWith('/api/edge-stocks/') && isAccessIdentityEnforced(env)) {
    const testerGate=await testerEdgeSandboxGate(request,env);
    if(testerGate)return testerGate;
  }
  if (url.pathname === '/api/edge-stocks/research-bundles' && request.method === 'POST') return saveEdgeResearchBundle(request, env);
  const researchBundle = url.pathname.match(/^\/api\/edge-stocks\/research-bundles\/([^/]+)$/);
  if (researchBundle && request.method === 'GET') return getEdgeResearchBundle(env, decodeURIComponent(researchBundle[1]));
  if (url.pathname === '/api/edge-stocks/dispatch-health' && request.method === 'GET') return edgeStocksDispatchHealth(env);
  if (url.pathname === '/api/edge-stocks/preopen-status' && request.method === 'GET') return edgeStocksPreopenStatus(env, url.searchParams.get('ticker') || '', url.searchParams.get('date') || '');
  if (url.pathname === '/api/edge-stocks/canonical-targets' && request.method === 'GET') return edgeStocksCanonicalTargets(env);
  if (url.pathname === '/api/edge-stocks/invoke' && request.method === 'POST') return invokeEdgeStocks(request, env);
  if (url.pathname === '/api/edge-stocks/invoke/status' && request.method === 'GET') return edgeStocksInvocationStatus(env, url.searchParams.get('ticker') || '', url.searchParams.get('after') || '', url.searchParams.get('lifecycle_id'));
  if (url.pathname === '/api/edge-stocks/report' && request.method === 'GET') return edgeStocksReport(env, url.searchParams.get('ticker') || '');
  if (url.pathname === '/api/edge-stocks/history' && request.method === 'GET') return edgeStocksHistory(env, url.searchParams.get('ticker') || '');
  if (url.pathname === '/api/edge-stocks/master' && request.method === 'GET') return edgeStocksMaster(env);
  if (url.pathname === '/api/ipo-edge/snapshot' && request.method === 'GET') return ipoEdgeSnapshot(request, env);
  return app.fetch(request, env);
}};