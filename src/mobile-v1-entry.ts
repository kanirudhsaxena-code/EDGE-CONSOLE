import { neon } from '@neondatabase/serverless';
import router from './router';
import { uploadCategorizedEvidence } from './categorized-evidence-upload';
import { analyzeScreenshot, probeVisionReadiness, type ScreenshotCategory } from './vision-producer';
import { check5drWorkflowAccess, dispatch5drAcquisition, dispatch5drPreopenAcquisition, dispatch5drAssessmentRefresh, dispatch5drEngine, type EngineDispatchEnv } from './engine-dispatch';
import { sync5drAcquisitionResult, sync5drEngineResult } from './engine-result-sync';
import { acquireSystemResearch } from './system-research';
import { produceIntelligence } from './intelligence-producer';
import { assessAutomatedMarketEvidence } from './automated-market-evidence';
import { canAdvanceIntelligenceHandoff } from './intelligence-contract';
import { actorCanAccessStored, actorMetadata, isAccessIdentityEnforced, resolveAccessActor, type AccessIdentityEnv } from './access-identity';
import { buildBuild3RunRegistryRecord, classifyBuild3MarketPhase, persistBuild3RunRegistryRecord } from './build-3-run-registry';
import { build3EvidenceSnapshotRef, freezeBuild3EvidenceSnapshot } from './build-3-evidence-snapshot';
import { assessBuild3FiveDrDataQuality, build3DataQualityRef, persistBuild3DataQuality } from './build-3-data-quality';
import { materializePersistedNiftyBuild3Forecast } from './build-3-nifty-materializer';

type AiBinding={run:(model:string,input:Record<string,unknown>)=>Promise<unknown>};
type Env=EngineDispatchEnv&AccessIdentityEnv&{ASSETS:Fetcher;EVIDENCE_BUCKET:R2Bucket;DATABASE_URL?:string;EDGE_DATABASE_URL?:string;EDGE_GITHUB_TOKEN?:string;APP_ENV:string;OUTPUT_CONTRACT_VERSION:string;AI:AiBinding};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}});
const allowed=new Set<ScreenshotCategory>(['PRICE_TECHNICALS','DERIVATIVES_OI']);
const REQUIRED_FAMILIES=['PRICE_TECHNICALS','DERIVATIVES_OI','MARKET_TRUST','EVENT_SHOCK','EXECUTION_RISK'] as const;
const SYSTEM_FAMILIES=['MARKET_TRUST','EVENT_SHOCK','EXECUTION_RISK'] as const;
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const responseJson=async(response:Response):Promise<Record<string,unknown>>=>{try{const body=await response.clone().json();return isObject(body)?body:{}}catch{return {}}};

function decisionSetup(body:unknown):{value?:Record<string,unknown>;error?:string}{
  const assessment=isObject(body)&&isObject(body.assessment)?body.assessment:{};
  const allowedObjectives=['MARKET_VIEW','OPTIONS_SETUP','BOTH'];
  const allowedRisk=['CONSERVATIVE','BALANCED','OPPORTUNISTIC'];
  const allowedPriority=['CAPITAL_PROTECTION','BALANCED','GROWTH'];
  const objective=String(assessment.objective??'BOTH');
  const risk_posture=String(assessment.risk_posture??'CONSERVATIVE');
  const capital_priority=String(assessment.capital_priority??'CAPITAL_PROTECTION');
  if(!allowedObjectives.includes(objective))return {error:'Unknown decision objective'};
  if(!allowedRisk.includes(risk_posture))return {error:'Unknown risk posture'};
  if(!allowedPriority.includes(capital_priority))return {error:'Unknown capital priority'};
  return {value:{horizon:'D+1_TO_D+5',objective,risk_posture,capital_priority,assessed_at:new Date().toISOString()}};
}

function automatedRunProvenance(body:Record<string,unknown>):Record<string,unknown>{
  return {
    trigger_type:body.trigger_type??null,
    evidence_mode:body.evidence_mode??null,
    market_session_as_of:body.market_session_as_of??null,
    research_as_of:body.research_as_of??null,
    target_session:body.target_session??null,
    benchmark_role:body.benchmark_role??null,
  };
}

function automatedMarketObservations(metadata:Record<string,unknown>):Record<string,unknown>[]{
  const automated=isObject(metadata.automated_market_evidence)?metadata.automated_market_evidence:{};
  return automated.status==='AUTOMATED_MARKET_DATA_READY'&&Array.isArray(automated.observations)
    ?automated.observations.filter(isObject):[];
}

function governedMarketObservations(metadata:Record<string,unknown>):Record<string,unknown>[]{
  const automated=automatedMarketObservations(metadata);
  if(automated.length)return automated;
  const screenshot=isObject(metadata.screenshot_intelligence)?metadata.screenshot_intelligence:{};
  return screenshot.status==='VISION_READY'&&Array.isArray(screenshot.observations)
    ?screenshot.observations.filter(isObject):[];
}

async function requestOwnershipGate(request:Request,env:Env,requestId:string):Promise<Response|null>{
  if(!isAccessIdentityEnforced(env))return null;
  const actor=await resolveAccessActor(request,env);
  if(!actor.authenticated)return json({error:'Authenticated Console identity is required'},401);
  if(!env.DATABASE_URL)return json({error:'Database is not configured'},503);
  const sql=neon(env.DATABASE_URL);
  const rows=await sql`select metadata from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
  if(!rows.length)return json({error:'request_id not found'},404);
  const metadata=isObject(rows[0].metadata)?rows[0].metadata:{};
  if(!actorCanAccessStored(actor,metadata.actor,env))return json({error:'This run belongs to a different Console user'},403);
  return null;
}

async function sessionInfo(request:Request,env:Env):Promise<Response>{
  const actor=await resolveAccessActor(request,env);
  return json({
    identity_mode:isAccessIdentityEnforced(env)?'ENFORCE':'AUDIT',
    authenticated:actor.authenticated,
    actor_id:actor.id,
    role:actor.role
  });
}

async function exact5drRequest(request:Request,env:Env,requestId:string):Promise<Response>{
  if(!env.DATABASE_URL)return json({error:'Database is not configured'},503);
  const actor=await resolveAccessActor(request,env);
  if(isAccessIdentityEnforced(env)&&!actor.authenticated)return json({error:'Authenticated Console identity is required'},401);
  const sql=neon(env.DATABASE_URL);
  const rows=await sql`select request_id,engine,batch_id,provenance_mode,framework_version,output_contract_version,status,run_id,metadata,error,created_at,updated_at from analysis_requests where engine='5DR' and request_id=${requestId} limit 1`;
  if(!rows.length)return json({request:null,run:null,error:'request_id not found'},404);
  const metadata=isObject(rows[0].metadata)?rows[0].metadata:{};
  if(isAccessIdentityEnforced(env)&&actor.role!=='OWNER'&&!actorCanAccessStored(actor,metadata.actor,env))return json({error:'This run belongs to a different Console user'},403);
  const runId=rows[0].run_id?String(rows[0].run_id):null;
  const runRows=runId?await sql`select run_id,contract_version,framework_version,status,provenance_mode,sources,freshness_at,generated_at,result,warnings,published,learning_eligible from analysis_runs where engine='5DR' and run_id=${runId} limit 1`:[];
  return json({request:rows[0],run:runRows[0]??null});
}

async function scoped5drRead(request:Request,env:Env):Promise<Response|null>{
  if(!isAccessIdentityEnforced(env))return null;
  const actor=await resolveAccessActor(request,env);
  if(!actor.authenticated)return json({error:'Authenticated Console identity is required'},401);
  if(actor.role==='OWNER')return null;
  if(!env.DATABASE_URL)return json({error:'Database is not configured'},503);
  const url=new URL(request.url),sql=neon(env.DATABASE_URL);

  if(url.pathname==='/api/5dr/run-requests/latest'&&request.method==='GET'){
    const rows=await sql`select request_id,engine,batch_id,provenance_mode,framework_version,output_contract_version,status,run_id,metadata,error,created_at,updated_at from analysis_requests where engine='5DR' and metadata->'actor'->>'id'=${actor.id} order by created_at desc limit 1`;
    return json({request:rows[0]??null,note:rows.length?undefined:'No 5DR run request yet'});
  }

  if(url.pathname==='/api/5dr/run-request'&&request.method==='GET'){
    const runId=url.searchParams.get('run_id');
    if(!runId)return json({request:null,error:'run_id is mandatory'},422);
    const rows=await sql`select request_id,engine,batch_id,provenance_mode,framework_version,output_contract_version,status,run_id,metadata,error,created_at,updated_at from analysis_requests where engine='5DR' and run_id=${runId} and metadata->'actor'->>'id'=${actor.id} order by updated_at desc limit 1`;
    return json({request:rows[0]??null,note:rows.length?undefined:'No owned request found for this run'});
  }

  if(url.pathname==='/api/runs/latest'&&request.method==='GET'&&url.searchParams.get('engine')==='5DR'){
    const rows=await sql`select ar.run_id,ar.engine,ar.contract_version,ar.framework_version,ar.status,ar.provenance_mode,ar.freshness_at,ar.generated_at,ar.published,ar.result,ar.warnings from analysis_runs ar join analysis_requests req on req.run_id=ar.run_id where ar.engine='5DR' and req.metadata->'actor'->>'id'=${actor.id} order by ar.generated_at desc limit 20`;
    return json({runs:rows,sandbox:true});
  }

  if(url.pathname==='/api/5dr/latest'&&request.method==='GET'){
    const rows=await sql`select ar.run_id,ar.contract_version,ar.framework_version,ar.status,ar.provenance_mode,ar.sources,ar.freshness_at,ar.generated_at,ar.result,ar.warnings,ar.published from analysis_runs ar join analysis_requests req on req.run_id=ar.run_id where ar.engine='5DR' and req.metadata->'actor'->>'id'=${actor.id} order by ar.generated_at desc limit 1`;
    return json({run:rows[0]??null,sandbox:true,note:rows.length?undefined:'No sandbox 5DR run yet'});
  }

  if(url.pathname==='/api/5dr/outcome-assessment'&&request.method==='GET'){
    const runId=url.searchParams.get('run_id');
    if(!runId)return json({assessment:null,error:'run_id is mandatory'},422);
    const owned=await sql`select 1 from analysis_requests where engine='5DR' and run_id=${runId} and metadata->'actor'->>'id'=${actor.id} limit 1`;
    if(!owned.length)return json({assessment:null,error:'Run is not owned by this Console user'},403);
    return json({assessment:null,sandbox:true,note:'Tester sandbox runs are excluded from canonical efficacy and outcome assessment'});
  }

  if(url.pathname==='/api/assessment-summary'&&request.method==='GET'&&(url.searchParams.get('engine')??'5DR')==='5DR'){
    return json({summary:{engine:'5DR',sandbox:true,matured_runs:0,forecast:{total:0,hits:0,accuracy_pct:null},recommendation:{total:0,hits:0,accuracy_pct:null},returns:{absolute_return_pct:null,hits_return_pct:null,misses_return_pct:null}},details:[],note:'Tester sandbox runs are isolated from canonical efficacy'});
  }

  return null;
}

export async function createAutomatedRun(request:Request,env:Env):Promise<Response>{
  if(!env.DATABASE_URL)return json({error:'Database is not configured'},503);
  const dispatchHealth=await check5drWorkflowAccess(env,fetch);
  if(!dispatchHealth.ok)return json({error:'5DR automated dispatch is not ready',code:'FIVEDR_DISPATCH_NOT_READY',dispatch_health:dispatchHealth,next_step:'FIX_5DR_GITHUB_ACTIONS_PERMISSION'},503);
  const actor=await resolveAccessActor(request,env);
  if(isAccessIdentityEnforced(env)&&!actor.authenticated)return json({error:'Authenticated Console identity is required'},401);
  let body:unknown={};try{body=await request.json()}catch{}
  const sandboxRequested=isObject(body)&&body.sandbox===true;
  const forceNew=!isObject(body)||body.force_new!==false;
  const clientInvocationId=isObject(body)&&typeof body.client_invocation_id==='string'&&body.client_invocation_id.trim()?body.client_invocation_id.trim():null;
  const canonicalAttempt=isObject(body)&&body.canonical_attempt===true;
  const prepOnly=isObject(body)&&body.prep_only===true;
  const canonicalAttemptSlot=isObject(body)&&typeof body.canonical_attempt_slot==='string'?body.canonical_attempt_slot.trim():null;
  if(prepOnly&&canonicalAttempt)return json({error:'prep_only cannot create a canonical attempt'},422);
  const runActor=sandboxRequested?{id:actor.authenticated?actor.id:'sandbox_acceptance',role:'TESTER' as const,authenticated:actor.authenticated}:actor;
  const setup=decisionSetup(body);
  if(!setup.value)return json({error:setup.error??'Invalid decision setup'},422);
  const sql=neon(env.DATABASE_URL);
  const istParts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  const canonicalAttemptKey=canonicalAttempt?`5DR:${istParts.year}-${istParts.month}-${istParts.day}:PREOPEN`:null;
  if(canonicalAttempt&&canonicalAttemptKey){
    const existing=await sql`
      select request_id,status,run_id,metadata
        from analysis_requests
       where engine='5DR'
         and metadata->'canonical_attempt'->>'key'=${canonicalAttemptKey}
         and status in ('READY_FOR_ENGINE','PROCESSING','COMPLETED','FAILED')
       order by created_at desc
       limit 1
    `;
    if(existing.length){
      const row=existing[0];
      const existingMetadata=isObject(row.metadata)?row.metadata:{};
      const existingStage=String(existingMetadata.adapter_stage??'');
      const retryablePreopenBlock=existingStage==='AUTOMATED_MARKET_DATA_BLOCKED'&&['READY_FOR_ENGINE','FAILED'].includes(String(row.status));
      if(retryablePreopenBlock){
        const retryDispatch=await dispatch5drPreopenAcquisition(env,String(row.request_id),request.url,fetch);
        const retryRecord={...retryDispatch,attempted_at:new Date().toISOString(),reason:'PREOPEN_ACQUISITION_RETRY',slot:canonicalAttemptSlot};
        const priorRetryCount=Number(existingMetadata.preopen_retry_count??0);
        const nextMetadata={
          ...existingMetadata,
          adapter_stage:retryDispatch.ok?'AUTOMATED_MARKET_DATA_PENDING':'AUTOMATED_MARKET_DATA_BLOCKED',
          acquisition_dispatch:retryRecord,
          preopen_retry_count:Number.isFinite(priorRetryCount)?priorRetryCount+1:1
        };
        await sql`update analysis_requests
          set status='READY_FOR_ENGINE',
              metadata=${JSON.stringify(nextMetadata)}::jsonb,
              error=${retryDispatch.ok?null:JSON.stringify({stage:'PREOPEN_ACQUISITION_RETRY',detail:retryDispatch.detail??retryDispatch.status})}::jsonb,
              updated_at=now()
          where request_id=${String(row.request_id)}`;
        return json({
          ok:retryDispatch.ok,
          fresh_run:false,
          reused_output:true,
          idempotent:true,
          request_id:String(row.request_id),
          status:'READY_FOR_ENGINE',
          adapter_stage:nextMetadata.adapter_stage,
          run_id:row.run_id??null,
          canonical_attempt:true,
          canonical_attempt_key:canonicalAttemptKey,
          acquisition_dispatch:retryRecord,
          next_step:retryDispatch.ok?'WAIT_FOR_PREOPEN_ACQUISITION_RETRY':'RETRY_PREOPEN_ACQUISITION_DISPATCH'
        },retryDispatch.ok?202:503);
      }
      return json({
        ok:true,
        fresh_run:false,
        reused_output:true,
        idempotent:true,
        request_id:String(row.request_id),
        status:String(row.status),
        adapter_stage:existingStage||null,
        run_id:row.run_id??null,
        canonical_attempt:true,
        canonical_attempt_key:canonicalAttemptKey,
        next_step:String(row.status)==='COMPLETED'?'CANONICAL_ATTEMPT_COMPLETE':'RESUME_EXISTING_CANONICAL_ATTEMPT'
      },String(row.status)==='COMPLETED'?200:202);
    }
  }
  if((isAccessIdentityEnforced(env)&&actor.role==='TESTER')||sandboxRequested){
    const recent=await sql`select count(*)::int as count from analysis_requests where engine='5DR' and created_at>now()-interval '60 seconds' and metadata->'actor'->>'id'=${runActor.id}`;
    if(Number(recent[0]?.count??0)>=3)return json({error:'Run limit reached. Try again after the current minute.'},429);
  }
  const requestId=`5drreq_${crypto.randomUUID()}`;
  const batchId=`auto_${crypto.randomUUID()}`;
  const build3RunTimestamp=new Date();
  const build3Run=buildBuild3RunRegistryRecord({
    engine:'5DR',instrument:'NIFTY',source_id:requestId,model_version:'5DR_V2_1',
    run_timestamp:build3RunTimestamp,trigger_type:'AUTOMATIC',market_phase:classifyBuild3MarketPhase(build3RunTimestamp)
  });
  let metadata:Record<string,unknown>={
    actor:actorMetadata(runActor),
    identity_enforced:isAccessIdentityEnforced(env),
    sandbox_requested:sandboxRequested,
    decision_setup:setup.value,
    evidence_file_count:0,
    evidence_readiness:{status:'AUTOMATED_ACQUISITION_PENDING',basis:prepOnly?'UPSTOX_PREOPEN_PREP':canonicalAttempt?'UPSTOX_PREOPEN_PRIMARY':'UPSTOX_PRIMARY',assessed_at:new Date().toISOString()},
    automated_market_evidence:{status:'PENDING'},
    invocation:{force_new:forceNew,client_invocation_id:clientInvocationId,requested_at:new Date().toISOString(),canonical_attempt:canonicalAttempt,canonical_attempt_slot:canonicalAttemptSlot,prep_only:prepOnly},
    preopen_prep_only:prepOnly,
    build3_run:build3Run,
    run_provenance:{
      trigger_type:prepOnly?'SCHEDULED_PREP':canonicalAttempt?'SCHEDULED':'USER',
      evidence_mode:prepOnly?'PREOPEN_PREP':canonicalAttempt?'PREOPEN':null,
      market_session_as_of:null,
      research_as_of:null,
      target_session:null,
      benchmark_role:canonicalAttempt?'SESSION_PREOPEN':'NONE'
    },
    canonical_attempt:canonicalAttempt?{type:'PREOPEN_CANONICAL_ATTEMPT',key:canonicalAttemptKey,slot:canonicalAttemptSlot,requested_at:new Date().toISOString()}:null,
    adapter_stage:'AUTOMATED_MARKET_DATA_PENDING'
  };
  await sql`insert into analysis_requests (request_id,engine,batch_id,provenance_mode,framework_version,output_contract_version,status,metadata)
    values (${requestId},'5DR',${batchId},'AUTOMATED','5DR_V2_1','5DR_V2_1_2','READY_FOR_ENGINE',${JSON.stringify(metadata)}::jsonb)`;
  await persistBuild3RunRegistryRecord(env.DATABASE_URL,build3Run);
  const dispatch=(canonicalAttempt||prepOnly)
    ?await dispatch5drPreopenAcquisition(env,requestId,request.url,fetch)
    :await dispatch5drAcquisition(env,requestId,request.url,fetch);
  const acquisitionDispatch={...dispatch,attempted_at:new Date().toISOString()};
  metadata={...metadata,acquisition_dispatch:acquisitionDispatch};
  if(!dispatch.ok){
    const blocked={...metadata,adapter_stage:'AUTOMATED_MARKET_DATA_BLOCKED'};
    await sql`update analysis_requests set status='FAILED',metadata=${JSON.stringify(blocked)}::jsonb,error=${JSON.stringify({stage:'AUTOMATED_ACQUISITION_DISPATCH',detail:dispatch.detail??dispatch.status})}::jsonb,updated_at=now() where request_id=${requestId}`;
    return json({ok:false,request_id:requestId,status:'FAILED',adapter_stage:'AUTOMATED_MARKET_DATA_BLOCKED',acquisition_dispatch:acquisitionDispatch,next_step:'USE_SCREENSHOT_BACKUP'},503);
  }
  await sql`update analysis_requests set metadata=${JSON.stringify(metadata)}::jsonb,error=null,updated_at=now() where request_id=${requestId}`;
  return json({ok:true,fresh_run:true,reused_output:false,request:{request_id:requestId,engine:'5DR',batch_id:batchId,provenance_mode:'AUTOMATED',framework_version:'5DR_V2_1',output_contract_version:'5DR_V2_1_2',status:'READY_FOR_ENGINE',metadata},sandbox:sandboxRequested||runActor.role==='TESTER',canonical_attempt_key:canonicalAttemptKey,prep_only:prepOnly,next_step:prepOnly?'PREOPEN_PREP_MARKET_ACQUISITION':canonicalAttempt?'PREOPEN_MARKET_ACQUISITION':'AUTOMATED_MARKET_ACQUISITION'},201);
}

async function receiveAutomatedMarketEvidence(request:Request,env:Env,requestId:string):Promise<Response>{
  if(!env.DATABASE_URL)return json({error:'Database is not configured'},503);
  let body:unknown;try{body=await request.json()}catch{return json({error:'Invalid JSON body'},400)}
  const gate=assessAutomatedMarketEvidence(body,requestId);
  if(gate.errors.length)return json({error:'Automated market evidence validation failed',details:gate.errors},422);
  const sql=neon(env.DATABASE_URL);
  const rows=await sql`select status,run_id,metadata from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
  if(!rows.length)return json({error:'request_id not found'},404);
  if(['COMPLETED','CANCELLED'].includes(String(rows[0].status)))return json({error:'request is not eligible for automated evidence callback'},409);
  const metadata=isObject(rows[0].metadata)?rows[0].metadata:{};
  const envelope=isObject(body)?{...body,received_at:new Date().toISOString()}:body;
  if(gate.blocked){
    const next={...metadata,automated_market_evidence:envelope,adapter_stage:'AUTOMATED_MARKET_DATA_BLOCKED'};
    await sql`update analysis_requests set status='READY_FOR_ENGINE',metadata=${JSON.stringify(next)}::jsonb,error=null,updated_at=now() where request_id=${requestId}`;
    return json({ok:false,callback_accepted:true,request_id:requestId,status:'READY_FOR_ENGINE',adapter_stage:'AUTOMATED_MARKET_DATA_BLOCKED',blockers:isObject(body)&&Array.isArray(body.blockers)?body.blockers:[],next_step:'USE_SCREENSHOT_BACKUP'});
  }
  if(!gate.ready)return json({error:'Automated market evidence is not ready'},409);
  const next={
    ...metadata,
    automated_market_evidence:envelope,
    run_provenance:isObject(body)?automatedRunProvenance(body):metadata.run_provenance,
    freshness_at:isObject(body)?body.captured_at:null,
    adapter_stage:'AUTOMATED_MARKET_DATA_READY'
  };
  await sql`update analysis_requests set status='READY_FOR_ENGINE',metadata=${JSON.stringify(next)}::jsonb,error=null,updated_at=now() where request_id=${requestId}`;
  const research=await systemResearch(env,requestId);
  const researchBody=await responseJson(research);
  if(!research.ok)return json({ok:false,callback_accepted:true,request_id:requestId,status:'READY_FOR_ENGINE',adapter_stage:'AUTOMATED_MARKET_DATA_READY',research:researchBody,next_step:'RETRY_SYSTEM_RESEARCH'});
  if(metadata.preopen_prep_only===true){
    const latest=await sql`select metadata from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
    const latestMetadata=latest.length&&isObject(latest[0].metadata)?latest[0].metadata:next;
    const prepared={...latestMetadata,adapter_stage:'PREOPEN_PREP_RESEARCH_READY',preopen_prep_completed_at:new Date().toISOString()};
    await sql`update analysis_requests set status='READY_FOR_ENGINE',metadata=${JSON.stringify(prepared)}::jsonb,error=null,updated_at=now() where request_id=${requestId}`;
    return json({
      ok:true,
      callback_accepted:true,
      request_id:requestId,
      status:'READY_FOR_ENGINE',
      adapter_stage:'PREOPEN_PREP_RESEARCH_READY',
      data_acquisition:'PASS',
      deep_research_executed_this_run:'PASS',
      canonical_created:false,
      trading_enabled:false,
      next_step:'WAIT_FOR_CANONICAL_WINDOW'
    },200);
  }
  const reconciled=await reconcileIntelligence(request,env,requestId);
  const reconciledBody=await responseJson(reconciled);
  return json({...reconciledBody,callback_accepted:true,request_id:requestId},200);
}


export async function refreshPreopenPrepResearch(env:Env,targetDate:string):Promise<Response>{
  if(!env.DATABASE_URL)return json({ok:false,error:'Database is not configured'},503);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return json({ok:false,error:'targetDate must be YYYY-MM-DD'},422);
  const sql=neon(env.DATABASE_URL);
  const invocationId=`cf-preopen-prep-${targetDate}`;
  let rows=await sql`
    select request_id,status,metadata
      from analysis_requests
     where engine='5DR'
       and metadata->'invocation'->>'client_invocation_id'=${invocationId}
     order by created_at desc
     limit 1
  `;
  if(!rows.length)return json({ok:false,status:'MISSING',target_date:targetDate,stage:'PREP_REQUEST_MISSING'},404);

  const requestId=String(rows[0].request_id);
  let metadata=isObject(rows[0].metadata)?rows[0].metadata:{};
  let stage=String(metadata.adapter_stage??'');
  const existingDelta=isObject(metadata.preopen_delta_research)?metadata.preopen_delta_research:{};
  if(existingDelta.status==='DELTA_RESEARCH_READY'){
    return json({
      ok:true,
      status:'DELTA_RESEARCH_READY',
      target_date:targetDate,
      request_id:requestId,
      adapter_stage:stage||'PREOPEN_PREP_RESEARCH_READY',
      research_manifest_complete:true,
      missing_dimensions:[],
      retrieved_at:existingDelta.retrieved_at??null,
      idempotent:true,
      trading_enabled:false
    },200);
  }

  if(stage==='AUTOMATED_MARKET_DATA_PENDING'){
    const internal=new Request(`https://edge-console.internal/api/5dr/run-requests/${encodeURIComponent(requestId)}/resume-processing`,{
      method:'POST',headers:{'content-type':'application/json'},body:'{}'
    });
    await resumeProcessing(internal,env,requestId);
    rows=await sql`
      select request_id,status,metadata
        from analysis_requests
       where request_id=${requestId} and engine='5DR'
       limit 1
    `;
    metadata=rows.length&&isObject(rows[0].metadata)?rows[0].metadata:{};
    stage=String(metadata.adapter_stage??'');
  }

  if(!['PREOPEN_PREP_RESEARCH_READY','RESEARCH_RETRIEVED'].includes(stage)){
    return json({
      ok:false,
      status:'BLOCKED',
      target_date:targetDate,
      request_id:requestId,
      adapter_stage:stage||null,
      next_step:'COMPLETE_PREP_DATA_AND_RESEARCH',
      trading_enabled:false
    },409);
  }

  const acquisition=await acquireSystemResearch();
  const categoryReady=Object.values(acquisition.by_category).every(item=>item.ready_for_interpretation);
  const allReady=categoryReady&&acquisition.research_manifest_complete;
  const refreshedAt=new Date().toISOString();
  const record={
    status:allReady?'DELTA_RESEARCH_READY':'DELTA_RESEARCH_BLOCKED',
    retrieved_at:refreshedAt,
    research_manifest:'NIFTY_G5_1_DELTA_V1',
    ...acquisition
  };
  const provenance=isObject(metadata.run_provenance)?metadata.run_provenance:{};
  const next={
    ...metadata,
    preopen_delta_research:record,
    run_provenance:{...provenance,research_as_of:allReady?refreshedAt:provenance.research_as_of??null},
    adapter_stage:'PREOPEN_PREP_RESEARCH_READY'
  };
  await sql`
    update analysis_requests
       set metadata=${JSON.stringify(next)}::jsonb,
           updated_at=now()
     where request_id=${requestId}
  `;
  return json({
    ok:allReady,
    status:record.status,
    target_date:targetDate,
    request_id:requestId,
    adapter_stage:'PREOPEN_PREP_RESEARCH_READY',
    research_manifest_complete:acquisition.research_manifest_complete,
    missing_dimensions:acquisition.missing_dimensions,
    retrieved_at:refreshedAt,
    trading_enabled:false
  },allReady?200:409);
}

async function visionReadiness(env:Env):Promise<Response>{
  if(!env.AI||typeof env.AI.run!=='function')return json({ok:false,status:'UNAVAILABLE',error:'Workers AI binding is not configured'},503);
  const result=await probeVisionReadiness(env.AI);
  return json(result,result.ok?200:result.status==='LICENSE_NOT_ACCEPTED'?428:503);
}

async function shadowVision(env:Env,requestId:string):Promise<Response>{
  if(!env.DATABASE_URL)return json({error:'Database is not configured'},503);
  if(!env.AI||typeof env.AI.run!=='function')return json({error:'Workers AI binding is not configured'},503);
  const sql=neon(env.DATABASE_URL);
  const requests=await sql`select request_id,metadata from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
  if(!requests.length)return json({error:'request_id not found'},404);
  const requestMetadata=isObject(requests[0].metadata)?requests[0].metadata:{};
  const stage=String(requestMetadata.adapter_stage??'');
  if(!['SCREENSHOTS_READY','AUTONOMOUS_EVIDENCE_BLOCKED','AUTONOMOUS_EVIDENCE_READY','INTELLIGENCE_BLOCKED'].includes(stage))return json({error:'request is not eligible for shadow vision',adapter_stage:stage},409);
  const rows=await sql`select upload_id,object_key,file_name,mime_type,captured_at,metadata from evidence_uploads where request_id=${requestId} order by id`;
  if(!rows.length)return json({error:'request has no attached screenshot evidence'},409);

  for(const row of rows){
    const metadata=isObject(row.metadata)?row.metadata:{};
    const category=metadata.evidence_category;
    if(typeof category!=='string'||!allowed.has(category as ScreenshotCategory))return json({error:'request contains uncategorized or invalid screenshot evidence',upload_id:String(row.upload_id)},409);
  }

  const observations=await Promise.all(rows.map(async(row):Promise<Record<string,unknown>>=>{
    const metadata=isObject(row.metadata)?row.metadata:{};
    const category=metadata.evidence_category as ScreenshotCategory;
    try{
      const object=await env.EVIDENCE_BUCKET.get(String(row.object_key));
      if(!object)return {upload_id:String(row.upload_id),file_name:String(row.file_name),category,source_kind:'SCREENSHOT',source_ref:`evidence:${String(row.upload_id)}`,observed_at:row.captured_at,retrieved_at:new Date().toISOString(),verification:'UNAVAILABLE',findings:[],limitations:['Evidence object missing from private R2 storage']};
      const result=await analyzeScreenshot(env.AI,await object.arrayBuffer(),String(row.mime_type),category);
      return {upload_id:String(row.upload_id),file_name:String(row.file_name),category:result.category,source_kind:'SCREENSHOT',source_ref:`evidence:${String(row.upload_id)}`,observed_at:row.captured_at,retrieved_at:new Date().toISOString(),verification:result.verification,findings:result.findings,limitations:result.limitations,model:result.model};
    }catch(error){
      const message=error instanceof Error?error.message:'Screenshot interpretation failed';
      return {upload_id:String(row.upload_id),file_name:String(row.file_name),category,source_kind:'SCREENSHOT',source_ref:`evidence:${String(row.upload_id)}`,observed_at:row.captured_at,retrieved_at:new Date().toISOString(),verification:'UNAVAILABLE',findings:[],limitations:[message]};
    }
  }));

  const missing=[...allowed].filter(category=>!observations.some(item=>item.category===category));
  const unavailable=observations.filter(item=>item.verification==='UNAVAILABLE');
  const blockedCategories=[...allowed].filter(category=>!observations.some(item=>item.category===category&&item.verification!=='UNAVAILABLE'));
  const visionStatus=missing.length||blockedCategories.length?'VISION_BLOCKED':'VISION_READY';
  const recordedAt=new Date().toISOString();
  const nextMetadata={...requestMetadata,screenshot_intelligence:{status:visionStatus,producer:'EDGE_CONSOLE_WORKERS_AI_VISION',producer_version:'0.2-shadow',recorded_at:recordedAt,observations,blockers:{missing_categories:missing,blocked_categories:blockedCategories,unavailable:unavailable.map(item=>({upload_id:item.upload_id,category:item.category,limitations:item.limitations}))}}};
  await sql`update analysis_requests set metadata=${JSON.stringify(nextMetadata)}::jsonb,updated_at=now() where request_id=${requestId}`;
  if(missing.length||blockedCategories.length)return json({error:'required screenshot category lacks usable interpreted evidence',vision_status:visionStatus,missing_categories:missing,blocked_categories:blockedCategories,observations},409);
  return json({ok:true,mode:'SHADOW_NON_PUBLISHING',request_id:requestId,producer:'EDGE_CONSOLE_WORKERS_AI_VISION',producer_version:'0.2-shadow',adapter_stage:stage,vision_status:visionStatus,observations,non_blocking_unavailable:unavailable.map(item=>({upload_id:item.upload_id,category:item.category,limitations:item.limitations})),next_step:'SYSTEM_WEB_RESEARCH'},200);
}

async function systemResearch(env:Env,requestId:string):Promise<Response>{
  if(!env.DATABASE_URL)return json({error:'Database is not configured'},503);
  const sql=neon(env.DATABASE_URL);
  const rows=await sql`select metadata from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
  if(!rows.length)return json({error:'request_id not found'},404);
  const metadata=isObject(rows[0].metadata)?rows[0].metadata:{};
  const automated=automatedMarketObservations(metadata);
  const screenshotIntelligence=isObject(metadata.screenshot_intelligence)?metadata.screenshot_intelligence:{};
  const screenshotReady=screenshotIntelligence.status==='VISION_READY';
  if(!automated.length&&!screenshotReady)return json({error:'system research requires ready automated market evidence or screenshot fallback evidence',automated_status:isObject(metadata.automated_market_evidence)?metadata.automated_market_evidence.status??null:null,vision_status:screenshotIntelligence.status??null},409);
  const acquisition=await acquireSystemResearch();
  const categoryReady=Object.values(acquisition.by_category).every(item=>item.ready_for_interpretation);
  const allReady=categoryReady&&acquisition.research_manifest_complete;
  const record={
    status:allReady?'RESEARCH_RETRIEVED':'RESEARCH_BLOCKED',
    retrieved_at:new Date().toISOString(),
    market_evidence_mode:automated.length?'AUTOMATED':'SCREENSHOT_FALLBACK',
    research_manifest:'NIFTY_G5_1_V1',
    ...acquisition
  };
  const nextStage=allReady?'RESEARCH_RETRIEVED':String(metadata.adapter_stage??'');
  await sql`update analysis_requests set metadata=${JSON.stringify({...metadata,system_research_acquisition:record,adapter_stage:nextStage})}::jsonb,updated_at=now() where request_id=${requestId}`;
  return json({ok:allReady,request_id:requestId,adapter_stage:nextStage,system_research:record,next_step:allReady?'RECONCILE_INTELLIGENCE':'RETRY_SYSTEM_RESEARCH'},allReady?200:409);
}

function numericValue(value:unknown):number|null{
  const n=Number(String(value??'').replace(/[^0-9.\-]/g,''));
  return Number.isFinite(n)?n:null;
}
function median(values:number[]):number|null{
  if(!values.length)return null;
  const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function detectCurrentMarketLevelConflict(metadata:Record<string,unknown>):{conflict:boolean;detail?:string;screenshot_level?:number;official_level?:number;difference_pct?:number}{
  const observations=governedMarketObservations(metadata);
  const prices:number[]=[];
  for(const o of observations){
    const findings=Array.isArray(o.findings)?o.findings.filter(isObject):[];
    for(const f of findings){
      const label=String(f.label??'');
      if(!/^(Current Price|Spot Price|Underlying Value|Index Value)$/i.test(label))continue;
      const n=numericValue(f.value);if(n&&n>1000)prices.push(n);
    }
  }
  const screenshotLevel=median(prices);
  const research=isObject(metadata.system_research_acquisition)?metadata.system_research_acquisition:{};
  const snapshots=Array.isArray(research.snapshots)?research.snapshots.filter(isObject):[];
  let officialLevel:number|null=null;
  for(const item of snapshots){
    if(item.source_id!=='NSE_ALL_INDICES'||item.status!=='RETRIEVED'||typeof item.excerpt!=='string')continue;
    try{
      const parsed=JSON.parse(item.excerpt);
      const rows=Array.isArray(parsed?.data)?parsed.data:[];
      const nifty=rows.find((x:any)=>x&&x.index==='NIFTY 50');
      const n=numericValue(nifty?.last);if(n)officialLevel=n;
    }catch{}
  }
  if(!screenshotLevel||!officialLevel)return {conflict:false};
  const diff=Math.abs(screenshotLevel-officialLevel)/officialLevel*100;
  if(diff>1.5)return {conflict:true,detail:`Current screenshot market level (${screenshotLevel.toFixed(2)}) conflicts with the official NSE NIFTY 50 level (${officialLevel.toFixed(2)}) by ${diff.toFixed(2)}%. The run is blocked because current-market evidence is inconsistent.`,screenshot_level:screenshotLevel,official_level:officialLevel,difference_pct:Number(diff.toFixed(2))};
  return {conflict:false,screenshot_level:screenshotLevel,official_level:officialLevel,difference_pct:Number(diff.toFixed(2))};
}

async function reconcileIntelligence(request:Request,env:Env,requestId:string):Promise<Response>{
  if(!env.DATABASE_URL)return json({error:'Database is not configured'},503);
  if(!env.AI||typeof env.AI.run!=='function')return json({error:'Workers AI binding is not configured'},503);
  const sql=neon(env.DATABASE_URL);
  const rows=await sql`select metadata from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
  if(!rows.length)return json({error:'request_id not found'},404);
  const metadata=isObject(rows[0].metadata)?rows[0].metadata:{};
  const marketObservations=governedMarketObservations(metadata);
  const research=isObject(metadata.system_research_acquisition)?metadata.system_research_acquisition:{};
  if(!marketObservations.length||research.status!=='RESEARCH_RETRIEVED')return json({error:'intelligence reconciliation prerequisites are not ready',market_evidence_ready:marketObservations.length>0,research_status:research.status??null},409);
  const snapshots=Array.isArray(research.snapshots)?research.snapshots.filter(isObject):[];
  const marketConflict=detectCurrentMarketLevelConflict(metadata);
  if(marketConflict.conflict){
    const record={status:'INTELLIGENCE_BLOCKED',attempted_at:new Date().toISOString(),errors:[marketConflict.detail],evidence_conflict:marketConflict};
    await sql`update analysis_requests set status='FAILED',metadata=${JSON.stringify({...metadata,intelligence_reconciliation:record})}::jsonb,error=${JSON.stringify({stage:'EVIDENCE_CONFLICT',detail:marketConflict.detail})}::jsonb,updated_at=now() where request_id=${requestId}`;
    return json({ok:false,request_id:requestId,error:'current market evidence conflicts with official NSE data',evidence_conflict:marketConflict,next_step:'REUPLOAD_CURRENT_SCREENSHOTS'},409);
  }
  const packet={market_observations:marketObservations,research:snapshots.map(item=>({...item,excerpt:typeof item.excerpt==='string'?item.excerpt.slice(0,4000):undefined}))};
  const sourceCategory=new Map<string,string>();
  for(const item of marketObservations)if(typeof item.source_ref==='string'&&typeof item.category==='string')sourceCategory.set(item.source_ref,item.category);
  for(const item of snapshots)if(item.status==='RETRIEVED'&&typeof item.source_ref==='string'&&typeof item.category==='string')sourceCategory.set(item.source_ref,item.category);
  const produced=await produceIntelligence(env.AI,packet,new Set(sourceCategory.keys()));
  if(!produced.judgment||!produced.normalized){
    const record={status:'INTELLIGENCE_BLOCKED',attempted_at:new Date().toISOString(),model:produced.model,errors:produced.errors};
    await sql`update analysis_requests set metadata=${JSON.stringify({...metadata,intelligence_reconciliation:record})}::jsonb,updated_at=now() where request_id=${requestId}`;
    return json({ok:false,request_id:requestId,intelligence_reconciliation:record},409);
  }
  const missingFamilies=REQUIRED_FAMILIES.filter(category=>!produced.judgment!.source_refs.some(ref=>sourceCategory.get(ref)===category));
  if(missingFamilies.length){
    const record={status:'INTELLIGENCE_BLOCKED',attempted_at:new Date().toISOString(),model:produced.model,errors:[`missing cited evidence families: ${missingFamilies.join(', ')}`]};
    await sql`update analysis_requests set metadata=${JSON.stringify({...metadata,intelligence_reconciliation:record})}::jsonb,updated_at=now() where request_id=${requestId}`;
    return json({ok:false,request_id:requestId,intelligence_reconciliation:record},409);
  }
  const origin=new URL(request.url).origin;
  const observations=[
    ...marketObservations.filter(item=>produced.judgment!.source_refs.includes(String(item.source_ref))).map(item=>({category:String(item.category),source_kind:String(item.source_kind||'SCREENSHOT'),source_ref:String(item.source_ref),observed_at:String(item.observed_at),retrieved_at:String(item.retrieved_at),verification:produced.judgment!.verification,notes:Array.isArray(item.limitations)?item.limitations.join('; '):undefined})),
    ...snapshots.filter(item=>item.status==='RETRIEVED'&&produced.judgment!.source_refs.includes(String(item.source_ref))).map(item=>({category:String(item.category),source_kind:'WEB_RESEARCH',source_ref:String(item.source_ref),observed_at:String(item.retrieved_at),retrieved_at:String(item.retrieved_at),verification:produced.judgment!.verification,notes:typeof item.limitation==='string'?item.limitation:undefined}))
  ];
  const handoff={producer:'EDGE_CONSOLE_GOVERNED_INTELLIGENCE',producer_version:'0.3-automated-primary',request_id:requestId,observations,normalized:produced.normalized};
  const handoffGate=canAdvanceIntelligenceHandoff(handoff);
  if(!handoffGate.ready){
    const record={status:'INTELLIGENCE_BLOCKED',attempted_at:new Date().toISOString(),model:produced.model,errors:handoffGate.errors};
    await sql`update analysis_requests set metadata=${JSON.stringify({...metadata,intelligence_reconciliation:record})}::jsonb,updated_at=now() where request_id=${requestId}`;
    return json({ok:false,request_id:requestId,error:'intelligence handoff gate blocked',intelligence_reconciliation:record},409);
  }
  await sql`update analysis_requests set metadata=${JSON.stringify({...metadata,intelligence_handoff:handoff,adapter_stage:'INTELLIGENCE_READY'})}::jsonb,updated_at=now() where request_id=${requestId}`;
  const evidence=[{evidence_type:'INTELLIGENCE_RECONCILIATION',source_ref:`5dr-intelligence://${requestId}`,captured_at:new Date().toISOString(),normalized:produced.normalized}];
  const normalizedReq=new Request(`${origin}/api/5dr/run-requests/${encodeURIComponent(requestId)}/normalized`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({evidence})});
  const normalizedResponse=await normalizedAndDispatch(normalizedReq,env,requestId);
  const reconciliationRecord={status:normalizedResponse.ok?'NORMALIZED_AND_DISPATCHED':'NORMALIZED_OR_DISPATCH_BLOCKED',attempted_at:new Date().toISOString(),model:produced.model,verification:produced.judgment.verification,source_refs:produced.judgment.source_refs,limitations:produced.judgment.limitations,judgment:{regime:produced.judgment.regime,directional_raw:produced.judgment.directional_raw,market_trust_inputs:produced.judgment.market_trust_inputs,event_shock:produced.judgment.event_shock,execution_inputs:produced.judgment.execution_inputs,data_adequate:produced.judgment.data_adequate,expected_rr:produced.judgment.expected_rr}};
  const latest=await sql`select metadata from analysis_requests where request_id=${requestId} limit 1`;
  const latestMetadata=latest.length&&isObject(latest[0].metadata)?latest[0].metadata:{};
  await sql`update analysis_requests set metadata=${JSON.stringify({...latestMetadata,intelligence_reconciliation:reconciliationRecord})}::jsonb,updated_at=now() where request_id=${requestId}`;
  const normalizedBody=await responseJson(normalizedResponse);
  return json({...normalizedBody,intelligence_reconciliation:reconciliationRecord},normalizedResponse.status);
}

async function dispatchNormalizedReady(env:Env,requestId:string,requestUrl:string,normalizedBody:Record<string,unknown>={}):Promise<Response>{
  if(!env.DATABASE_URL)return json({error:'Database is not configured'},503);
  const sql=neon(env.DATABASE_URL);
  const rows=await sql`select status,provenance_mode,framework_version,output_contract_version,metadata from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
  if(!rows.length)return json({error:'request_id not found after normalization'},404);
  const metadata=isObject(rows[0].metadata)?rows[0].metadata:{};
  const previous=isObject(metadata.engine_dispatch)?metadata.engine_dispatch:{};
  if(String(rows[0].status)==='PROCESSING'&&previous.status==='DISPATCHED')return json({...normalizedBody,ok:true,status:'PROCESSING',adapter_stage:metadata.adapter_stage??'NORMALIZED_READY',engine_dispatch:previous,idempotent:true});
  if(metadata.adapter_stage!=='NORMALIZED_READY')return json({error:'request is not ready for engine dispatch',adapter_stage:metadata.adapter_stage??null},409);
  if(previous.status==='DISPATCHED'){
    await sql`update analysis_requests set status='PROCESSING',error=null,updated_at=now() where request_id=${requestId}`;
    return json({...normalizedBody,ok:true,status:'PROCESSING',adapter_stage:'NORMALIZED_READY',engine_dispatch:previous,idempotent:true});
  }
  const origin=new URL(requestUrl).origin;
  const packetResponse=await router.fetch(new Request(`${origin}/api/5dr/run-requests/${encodeURIComponent(requestId)}/execution-packet`,{method:'GET'}),env as any);
  const executionPacket=await responseJson(packetResponse);
  if(!packetResponse.ok){
    const refreshState=isObject(executionPacket.assessment_refresh)?executionPacket.assessment_refresh:{};
    const staleAssessment=packetResponse.status===409&&String(refreshState.detail??'')==='assessment handoff is stale';
    if(staleAssessment){
      const priorRefresh=isObject(metadata.assessment_refresh_dispatch)?metadata.assessment_refresh_dispatch:{};
      const attemptedAt=String(priorRefresh.attempted_at??'');
      const attemptedMs=attemptedAt&&!Number.isNaN(Date.parse(attemptedAt))?Date.parse(attemptedAt):0;
      const recentlyDispatched=priorRefresh.status==='DISPATCHED'&&attemptedMs>0&&Date.now()-attemptedMs<3*60_000;
      if(recentlyDispatched){
        return json({
          ...normalizedBody,
          ok:true,
          request_id:requestId,
          status:'READY_FOR_ENGINE',
          adapter_stage:'NORMALIZED_READY',
          assessment_refresh_dispatch:priorRefresh,
          next_step:'WAIT_FOR_ASSESSMENT_REFRESH'
        },202);
      }

      const refreshDispatch=await dispatch5drAssessmentRefresh(env,requestId,requestUrl,fetch);
      const refreshRecord={...refreshDispatch,attempted_at:new Date().toISOString(),reason:'STALE_ASSESSMENT_HANDOFF'};
      const latest=await sql`select metadata from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
      const latestMetadata=latest.length&&isObject(latest[0].metadata)?latest[0].metadata:metadata;
      await sql`update analysis_requests set metadata=${JSON.stringify({...latestMetadata,assessment_refresh_dispatch:refreshRecord})}::jsonb,error=null,updated_at=now() where request_id=${requestId}`;

      if(refreshDispatch.ok){
        return json({
          ...normalizedBody,
          ok:true,
          request_id:requestId,
          status:'READY_FOR_ENGINE',
          adapter_stage:'NORMALIZED_READY',
          assessment_refresh_dispatch:refreshRecord,
          next_step:'WAIT_FOR_ASSESSMENT_REFRESH'
        },202);
      }
      return json({
        ...normalizedBody,
        ok:false,
        request_id:requestId,
        status:'READY_FOR_ENGINE',
        adapter_stage:'NORMALIZED_READY',
        assessment_refresh_dispatch:refreshRecord,
        error:'5DR assessment refresh dispatch failed',
        next_step:'RETRY_ASSESSMENT_REFRESH'
      },503);
    }
    return json({...normalizedBody,...executionPacket},packetResponse.status);
  }
  if(!Array.isArray(executionPacket.evidence)||!executionPacket.evidence.length)return json({error:'normalized evidence is missing at dispatch boundary'},409);
  let evidenceSnapshot;
  try{
    const issuanceContext={
      build3_run:isObject(metadata.build3_run)?metadata.build3_run:null,
      run_provenance:isObject(metadata.run_provenance)?metadata.run_provenance:null,
      invocation:isObject(metadata.invocation)?metadata.invocation:null,
      automated_market_evidence:isObject(metadata.automated_market_evidence)?metadata.automated_market_evidence:null,
      screenshot_intelligence:isObject(metadata.screenshot_intelligence)?metadata.screenshot_intelligence:null,
      system_research_acquisition:isObject(metadata.system_research_acquisition)?metadata.system_research_acquisition:null,
      intelligence_handoff:isObject(metadata.intelligence_handoff)?metadata.intelligence_handoff:null,
      normalization_assessment:isObject(metadata.normalization_assessment)?metadata.normalization_assessment:null,
      decision_setup:isObject(metadata.decision_setup)?metadata.decision_setup:null,
      evidence_readiness:isObject(metadata.evidence_readiness)?metadata.evidence_readiness:null,
      canonical_attempt:isObject(metadata.canonical_attempt)?metadata.canonical_attempt:null,
      freshness_at:metadata.freshness_at??null,
      evidence_file_count:metadata.evidence_file_count??null,
      evidence_mime_types:Array.isArray(metadata.evidence_mime_types)?metadata.evidence_mime_types:null,
      preopen_prep_only:metadata.preopen_prep_only===true,
    };
    evidenceSnapshot=await freezeBuild3EvidenceSnapshot(env.DATABASE_URL,{
      engine:'5DR',
      instrument:'NIFTY',
      source_id:requestId,
      evidence:{
        engine_input:executionPacket,
        issuance_context:issuanceContext,
      },
    });
  }catch(error){
    const detail=error instanceof Error?error.message:String(error);
    const blocked={status:'BLOCKED',detail,blocked_at:new Date().toISOString()};
    await sql`update analysis_requests set metadata=${JSON.stringify({...metadata,build3_evidence_snapshot:blocked})}::jsonb,error=null,updated_at=now() where request_id=${requestId}`;
    return json({...normalizedBody,ok:false,request_id:requestId,status:'READY_FOR_ENGINE',adapter_stage:'NORMALIZED_READY',build3_evidence_snapshot:blocked,error:'Build 3.0 evidence freeze failed',next_step:'RETRY_EVIDENCE_FREEZE'},409);
  }
  const snapshotRef=build3EvidenceSnapshotRef(evidenceSnapshot);
  const build3Run=isObject(metadata.build3_run)?metadata.build3_run:{};
  const marketPhase=String(build3Run.market_phase??'CLOSED_SESSION') as 'PRE_OPEN'|'OPEN'|'INTRADAY'|'POST_CLOSE'|'CLOSED_SESSION';
  let dataQuality;
  try{
    dataQuality=assessBuild3FiveDrDataQuality(evidenceSnapshot,marketPhase);
    dataQuality=await persistBuild3DataQuality(env.DATABASE_URL,dataQuality);
  }catch(error){
    const detail=error instanceof Error?error.message:String(error);
    const blocked={status:'BLOCKED',detail,blocked_at:new Date().toISOString()};
    await sql`update analysis_requests set metadata=${JSON.stringify({...metadata,build3_evidence_snapshot:snapshotRef,build3_data_quality:blocked})}::jsonb,error=null,updated_at=now() where request_id=${requestId}`;
    return json({...normalizedBody,ok:false,request_id:requestId,status:'READY_FOR_ENGINE',adapter_stage:'NORMALIZED_READY',build3_evidence_snapshot:snapshotRef,build3_data_quality:blocked,error:'Build 3.0 data-quality assessment failed',next_step:'RETRY_DATA_QUALITY_GATE'},409);
  }
  const qualityRef=build3DataQualityRef(dataQuality);
  if(!dataQuality.valid_for_forecast){
    await sql`update analysis_requests set metadata=${JSON.stringify({...metadata,build3_evidence_snapshot:snapshotRef,build3_data_quality:qualityRef})}::jsonb,error=null,updated_at=now() where request_id=${requestId}`;
    return json({...normalizedBody,ok:false,request_id:requestId,status:'READY_FOR_ENGINE',adapter_stage:'NORMALIZED_READY',build3_evidence_snapshot:snapshotRef,build3_data_quality:qualityRef,error:'Build 3.0 data-quality gate blocked forecast dispatch',next_step:'REFRESH_REQUIRED_EVIDENCE'},409);
  }
  const governedExecutionPacket={...executionPacket,build3_evidence_snapshot:snapshotRef,build3_data_quality:qualityRef};
  const dispatch=await dispatch5drEngine(env,requestId,requestUrl,fetch,governedExecutionPacket);
  const dispatchRecord={...dispatch,attempted_at:new Date().toISOString()};
  const nextMetadata={...metadata,build3_evidence_snapshot:snapshotRef,build3_data_quality:qualityRef,engine_dispatch:dispatchRecord};
  if(dispatch.ok){
    await sql`update analysis_requests set status='PROCESSING',metadata=${JSON.stringify(nextMetadata)}::jsonb,error=null,updated_at=now() where request_id=${requestId}`;
    return json({...normalizedBody,engine_dispatch:dispatchRecord,status:'PROCESSING'});
  }
  await sql`update analysis_requests set metadata=${JSON.stringify(nextMetadata)}::jsonb,updated_at=now() where request_id=${requestId}`;
  return json({...normalizedBody,ok:false,engine_dispatch:dispatchRecord,next_step:'RETRY_ENGINE_DISPATCH'},503);
}

async function normalizedAndDispatch(request:Request,env:Env,requestId:string):Promise<Response>{
  const normalizedResponse=await router.fetch(request.clone() as any,env as any);
  if(!normalizedResponse.ok||!env.DATABASE_URL)return normalizedResponse;
  let normalizedBody:Record<string,unknown>={};
  try{const parsed=await normalizedResponse.clone().json();if(isObject(parsed))normalizedBody=parsed}catch{}
  if(normalizedBody.adapter_stage!=='NORMALIZED_READY')return normalizedResponse;
  return dispatchNormalizedReady(env,requestId,request.url,normalizedBody);
}

export async function resumeProcessing(request:Request,env:Env,requestId:string):Promise<Response>{
  if(!env.DATABASE_URL)return json({error:'Database is not configured'},503);
  const sql=neon(env.DATABASE_URL);
  const rows=await sql`select status,metadata from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
  if(!rows.length)return json({error:'request_id not found'},404);
  const status=String(rows[0].status);
  const metadata=isObject(rows[0].metadata)?rows[0].metadata:{};
  const stage=String(metadata.adapter_stage??'');

  if(status==='COMPLETED'){
    const runId=rows[0].run_id?String(rows[0].run_id):null;
    const runRows=runId?await sql`select published,learning_eligible from analysis_runs where run_id=${runId} and engine='5DR' limit 1`:[];
    const completion=isObject(metadata.completion)?metadata.completion:{};
    const sandbox=completion.sandbox===true;
    let build3Forecast:Record<string,unknown>|null=null;
    if(isObject(metadata.build3_run)){
      try{
        const forecast=await materializePersistedNiftyBuild3Forecast(env.DATABASE_URL,requestId);
        build3Forecast={
          forecast_version:forecast.forecast_version,
          engine:forecast.engine,
          source_id:forecast.source_id,
          issued_at:forecast.issued_at,
          evidence_snapshot_id:forecast.evidence_snapshot_id,
          horizon_count:forecast.horizons.length
        };
      }catch(error){
        return json({
          ok:false,request_id:requestId,status:'COMPLETED',adapter_stage:stage||'COMPLETED',
          run_id:runId,error:'Build 3.0 NIFTY forecast materialization failed',
          detail:error instanceof Error?error.message:String(error),
          next_step:'RETRY_BUILD3_FORECAST_MATERIALIZATION'
        },409);
      }
    }
    return json({
      ok:true,
      request_id:requestId,
      status:'COMPLETED',
      adapter_stage:stage||'COMPLETED',
      run_id:runId,
      published:runRows.length?runRows[0].published===true:false,
      learning_eligible:runRows.length?runRows[0].learning_eligible===true:false,
      sandbox,
      build3_forecast:build3Forecast,
      idempotent:true
    });
  }

  if(status==='PROCESSING'){
    const dispatch=isObject(metadata.engine_dispatch)?metadata.engine_dispatch:{};
    const sync=await sync5drEngineResult(env,requestId);
    if(sync.status==='PROCESSING'||sync.status==='NOT_FOUND')return json({ok:true,request_id:requestId,status:'PROCESSING',adapter_stage:stage,engine_dispatch:dispatch,engine_sync:sync,idempotent:true});
    if(sync.status==='FAILED'){
      const failedDispatch={...dispatch,ok:false,status:'ENGINE_FAILED',workflow_run_id:sync.workflow_run_id,failed_at:new Date().toISOString(),detail:sync.detail};
      await sql`update analysis_requests set status='FAILED',metadata=${JSON.stringify({...metadata,engine_dispatch:failedDispatch})}::jsonb,error=${JSON.stringify({stage:'EXECUTION',detail:sync.detail??'5DR engine workflow failed'})}::jsonb,updated_at=now() where request_id=${requestId}`;
      return json({ok:false,request_id:requestId,status:'FAILED',adapter_stage:stage,engine_dispatch:failedDispatch,next_step:'RETRY_ENGINE_DISPATCH'},409);
    }
    if(sync.status==='SUCCEEDED'&&sync.envelope){
      const conflict=detectCurrentMarketLevelConflict(metadata);
      if(conflict.conflict){
        const failedDispatch={...dispatch,ok:false,status:'EVIDENCE_CONFLICT',workflow_run_id:sync.workflow_run_id,failed_at:new Date().toISOString(),detail:conflict.detail};
        await sql`update analysis_requests set status='FAILED',metadata=${JSON.stringify({...metadata,engine_dispatch:failedDispatch})}::jsonb,error=${JSON.stringify({stage:'EVIDENCE_CONFLICT',detail:conflict.detail})}::jsonb,updated_at=now() where request_id=${requestId}`;
        return json({ok:false,request_id:requestId,status:'FAILED',adapter_stage:stage,evidence_conflict:conflict,next_step:'REUPLOAD_CURRENT_SCREENSHOTS'},409);
      }
      const origin=new URL(request.url).origin;
      const publishReq=new Request(`${origin}/api/5dr/runs`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(sync.envelope)});
      const published=await router.fetch(publishReq as any,env as any);
      const body=await responseJson(published);
      if(!published.ok)return json({ok:false,request_id:requestId,status:'PROCESSING',adapter_stage:stage,engine_sync:sync,error:'validated engine result could not be persisted',publish_gate:body},409);
      const completedDispatch={...dispatch,ok:true,status:'RESULT_SYNCED',workflow_run_id:sync.workflow_run_id,result_synced_at:new Date().toISOString()};
      let build3Forecast;
      try{
        build3Forecast=await materializePersistedNiftyBuild3Forecast(env.DATABASE_URL,requestId);
      }catch(error){
        const latest=await sql`select metadata from analysis_requests where request_id=${requestId} limit 1`;
        const latestMetadata=latest.length&&isObject(latest[0].metadata)?latest[0].metadata:{};
        const build3Blocked={status:'BLOCKED',detail:error instanceof Error?error.message:String(error),blocked_at:new Date().toISOString()};
        await sql`update analysis_requests set metadata=${JSON.stringify({...latestMetadata,engine_dispatch:completedDispatch,build3_forecast:build3Blocked})}::jsonb,error=null,updated_at=now() where request_id=${requestId}`;
        return json({...body,ok:false,request_id:requestId,status:'COMPLETED',adapter_stage:stage,engine_dispatch:completedDispatch,build3_forecast:build3Blocked,error:'Build 3.0 NIFTY forecast materialization failed',next_step:'RETRY_BUILD3_FORECAST_MATERIALIZATION'},409);
      }
      const build3Ref={
        forecast_version:build3Forecast.forecast_version,engine:build3Forecast.engine,source_id:build3Forecast.source_id,
        issued_at:build3Forecast.issued_at,evidence_snapshot_id:build3Forecast.evidence_snapshot_id,horizon_count:build3Forecast.horizons.length
      };
      const latest=await sql`select metadata from analysis_requests where request_id=${requestId} limit 1`;
      const latestMetadata=latest.length&&isObject(latest[0].metadata)?latest[0].metadata:{};
      await sql`update analysis_requests set metadata=${JSON.stringify({...latestMetadata,engine_dispatch:completedDispatch,build3_forecast:build3Ref})}::jsonb,error=null,updated_at=now() where request_id=${requestId}`;
      return json({...body,ok:true,request_id:requestId,status:'COMPLETED',adapter_stage:stage,engine_dispatch:completedDispatch,build3_forecast:build3Ref});
    }
    return json({ok:true,request_id:requestId,status:'PROCESSING',adapter_stage:stage,engine_dispatch:dispatch,engine_sync:sync,idempotent:true});
  }

  if(stage==='AUTOMATED_MARKET_DATA_PENDING'){
    const provenance=isObject(metadata.run_provenance)?metadata.run_provenance:{};
    const invocation=isObject(metadata.invocation)?metadata.invocation:{};
    const preopenAcquisition=
      provenance.evidence_mode==='PREOPEN'||
      provenance.evidence_mode==='PREOPEN_PREP'||
      invocation.canonical_attempt===true||
      invocation.prep_only===true||
      metadata.preopen_prep_only===true;
    const acquisitionWorkflow=preopenAcquisition
      ?env.FIVEDR_PREOPEN_ACQUIRE_WORKFLOW
      :env.FIVEDR_ACQUIRE_WORKFLOW;
    const sync=await sync5drAcquisitionResult(env,requestId,fetch,acquisitionWorkflow);
    if(sync.status==='PROCESSING'||sync.status==='NOT_FOUND')return json({ok:true,request_id:requestId,status:'READY_FOR_ENGINE',adapter_stage:stage,acquisition_sync:sync,next_step:'WAIT_FOR_AUTOMATED_MARKET_DATA'},202);
    if(sync.status==='FAILED'){
      const blocked={...metadata,adapter_stage:'AUTOMATED_MARKET_DATA_BLOCKED',acquisition_sync:sync};
      await sql`update analysis_requests set status='READY_FOR_ENGINE',metadata=${JSON.stringify(blocked)}::jsonb,error=${JSON.stringify({stage:'AUTOMATED_ACQUISITION',detail:sync.detail??'5DR acquisition workflow failed'})}::jsonb,updated_at=now() where request_id=${requestId}`;
      return json({ok:false,request_id:requestId,status:'READY_FOR_ENGINE',adapter_stage:'AUTOMATED_MARKET_DATA_BLOCKED',acquisition_sync:sync,next_step:'USE_SCREENSHOT_BACKUP'},409);
    }
    if(sync.status==='SUCCEEDED'&&sync.evidence){
      const origin=new URL(request.url).origin;
      const handoffReq=new Request(`${origin}/api/5dr/run-requests/${encodeURIComponent(requestId)}/automated-market-evidence`,{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(sync.evidence)
      });
      return receiveAutomatedMarketEvidence(handoffReq,env,requestId);
    }
    return json({ok:false,request_id:requestId,status:'READY_FOR_ENGINE',adapter_stage:stage,acquisition_sync:sync,next_step:'RETRY_AUTOMATED_ACQUISITION_SYNC'},503);
  }
  if(stage==='AUTOMATED_MARKET_DATA_BLOCKED')return json({ok:false,request_id:requestId,status:'READY_FOR_ENGINE',adapter_stage:stage,next_step:'USE_SCREENSHOT_BACKUP'},409);
  if(stage==='AUTOMATED_MARKET_DATA_READY'){
    const existingResearch=isObject(metadata.system_research_acquisition)?metadata.system_research_acquisition:{};
    if(existingResearch.status==='RESEARCH_RETRIEVED'){
      const checkpointed={...metadata,adapter_stage:'RESEARCH_RETRIEVED'};
      await sql`update analysis_requests set metadata=${JSON.stringify(checkpointed)}::jsonb,error=null,updated_at=now() where request_id=${requestId}`;
      return json({ok:true,request_id:requestId,status:'READY_FOR_ENGINE',adapter_stage:'RESEARCH_RETRIEVED',system_research:existingResearch,next_step:'RECONCILE_INTELLIGENCE',idempotent:true});
    }
    return systemResearch(env,requestId);
  }

  if(stage==='RESEARCH_RETRIEVED')return reconcileIntelligence(request,env,requestId);

  if(stage==='NORMALIZED_READY')return dispatchNormalizedReady(env,requestId,request.url);

  if(stage==='INTELLIGENCE_READY'||stage==='NORMALIZATION_BLOCKED'){
    const handoff=isObject(metadata.intelligence_handoff)?metadata.intelligence_handoff:{};
    if(!isObject(handoff.normalized))return json({error:'validated intelligence handoff is missing normalized inputs',adapter_stage:stage},409);
    const evidence=[{evidence_type:'INTELLIGENCE_RECONCILIATION',source_ref:`5dr-intelligence://${requestId}`,captured_at:new Date().toISOString(),normalized:handoff.normalized}];
    const origin=new URL(request.url).origin;
    const normalizedReq=new Request(`${origin}/api/5dr/run-requests/${encodeURIComponent(requestId)}/normalized`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({evidence})});
    return normalizedAndDispatch(normalizedReq,env,requestId);
  }

  if(stage==='AUTONOMOUS_EVIDENCE_READY'||stage==='INTELLIGENCE_BLOCKED'){
    return reconcileIntelligence(request,env,requestId);
  }

  if(stage==='SCREENSHOTS_READY'||stage==='AUTONOMOUS_EVIDENCE_BLOCKED'){
    const vision=await shadowVision(env,requestId);
    if(!vision.ok)return vision;
    return systemResearch(env,requestId);
  }

  if(stage==='VISION_READY')return systemResearch(env,requestId);

  return json({error:'request cannot be resumed from its current stage',adapter_stage:stage,status},409);
}

async function preopenStatus(request:Request,env:Env):Promise<Response>{
  if(!env.DATABASE_URL)return json({error:'Database is not configured'},503);
  const url=new URL(request.url);
  const targetDate=String(url.searchParams.get('date')??'').trim();
  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(targetDate))return json({error:'date=YYYY-MM-DD is mandatory'},422);
  const parsed=new Date(targetDate+'T00:00:00Z');
  if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==targetDate)return json({error:'date is invalid'},422);
  const canonicalAttemptKey=`5DR:${targetDate}:PREOPEN`;
  const sql=neon(env.DATABASE_URL);
  const rows=await sql`
    select request_id,status,run_id,metadata,created_at,updated_at
      from analysis_requests
     where engine='5DR'
       and metadata->'canonical_attempt'->>'key'=${canonicalAttemptKey}
     order by created_at desc
     limit 1
  `;
  if(!rows.length)return json({
    status:'MISSING',
    target_date:targetDate,
    canonical_attempt_key:canonicalAttemptKey,
    request_id:null,
    run_id:null,
    published:false,
    trading_enabled:false
  },404);
  const row=rows[0];
  const metadata=isObject(row.metadata)?row.metadata:{};
  const provenance=isObject(metadata.run_provenance)?metadata.run_provenance:{};
  const canonicalAttempt=isObject(metadata.canonical_attempt)?metadata.canonical_attempt:{};
  const runId=row.run_id?String(row.run_id):null;
  const runRows=runId?await sql`
    select published,learning_eligible,generated_at,framework_version,contract_version
      from analysis_runs
     where engine='5DR' and run_id=${runId}
     limit 1
  `:[];
  const run=runRows.length?runRows[0]:null;
  return json({
    status:String(row.status),
    target_date:targetDate,
    canonical_attempt_key:canonicalAttemptKey,
    request_id:String(row.request_id),
    run_id:runId,
    request_created_at:row.created_at,
    request_updated_at:row.updated_at,
    canonical_attempt:{
      type:canonicalAttempt.type??null,
      key:canonicalAttempt.key??null,
      slot:canonicalAttempt.slot??null,
      requested_at:canonicalAttempt.requested_at??null
    },
    run_provenance:{
      trigger_type:provenance.trigger_type??null,
      evidence_mode:provenance.evidence_mode??null,
      market_session_as_of:provenance.market_session_as_of??null,
      research_as_of:provenance.research_as_of??null,
      target_session:provenance.target_session??null,
      benchmark_role:provenance.benchmark_role??null
    },
    published:run?run.published===true:false,
    learning_eligible:run?run.learning_eligible===true:false,
    generated_at:run?.generated_at??null,
    framework_version:run?.framework_version??null,
    contract_version:run?.contract_version??null,
    trading_enabled:false
  });
}


export default {async fetch(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url);
  if(url.pathname==='/api/session'&&request.method==='GET')return sessionInfo(request,env);
  if(url.pathname==='/api/5dr/dispatch-health'&&request.method==='GET'){const health=await check5drWorkflowAccess(env,fetch);return json({...health,trading_enabled:false},health.ok?200:503)}
  const exactRequest=url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)$/);
  if(exactRequest&&request.method==='GET')return exact5drRequest(request,env,decodeURIComponent(exactRequest[1]));
  const scopedRead=await scoped5drRead(request,env);if(scopedRead)return scopedRead;
  if(url.pathname==='/api/5dr/preopen-status'&&request.method==='GET')return preopenStatus(request,env);
  if(url.pathname==='/api/edge-stocks/health'&&request.method==='GET')return json({ok:true,service:'EDGE Console',edge_database_configured:Boolean(env.EDGE_DATABASE_URL),environment:env.APP_ENV??null,prompt_dispatch_configured:Boolean(env.EDGE_GITHUB_TOKEN),research_contract_version:'EDGE_RESEARCH_BUNDLE_V2',research_authority:'EDGE_SYSTEM',fresh_data_required:true,fresh_web_research_required:true,data_first_lifecycle:true,chat_scheduled_task_dependency:false,access_identity_mode:isAccessIdentityEnforced(env)?'ENFORCE':'AUDIT'});
  if(url.pathname==='/api/5dr/automated-runs'&&request.method==='POST')return createAutomatedRun(request,env);
  if(url.pathname==='/api/evidence/upload'&&request.method==='POST')return uploadCategorizedEvidence(request,env);
  const automatedMarket=url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/automated-market-evidence$/);
  if(automatedMarket&&request.method==='POST')return receiveAutomatedMarketEvidence(request,env,decodeURIComponent(automatedMarket[1]));
  if(url.pathname==='/api/5dr/vision-readiness'&&request.method==='GET')return visionReadiness(env);
  const vision=url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/shadow-vision$/);
  if(vision&&request.method==='POST'){const id=decodeURIComponent(vision[1]);const denied=await requestOwnershipGate(request,env,id);return denied??shadowVision(env,id)}
  const research=url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/system-research$/);
  if(research&&request.method==='POST'){const id=decodeURIComponent(research[1]);const denied=await requestOwnershipGate(request,env,id);return denied??systemResearch(env,id)}
  const reconcile=url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/reconcile-intelligence$/);
  if(reconcile&&request.method==='POST'){const id=decodeURIComponent(reconcile[1]);const denied=await requestOwnershipGate(request,env,id);return denied??reconcileIntelligence(request,env,id)}
  const resume=url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/resume-processing$/);
  if(resume&&request.method==='POST'){const id=decodeURIComponent(resume[1]);const denied=await requestOwnershipGate(request,env,id);return denied??resumeProcessing(request,env,id)}
  const normalized=url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/normalized$/);
  if(normalized&&request.method==='POST'){const id=decodeURIComponent(normalized[1]);const denied=await requestOwnershipGate(request,env,id);return denied??normalizedAndDispatch(request,env,id)}
  return router.fetch(request,env as any);
}};
