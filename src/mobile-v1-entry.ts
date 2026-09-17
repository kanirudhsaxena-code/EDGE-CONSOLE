import { neon } from '@neondatabase/serverless';
import router from './router';
import { uploadCategorizedEvidence } from './categorized-evidence-upload';
import { analyzeScreenshot, probeVisionReadiness, type ScreenshotCategory } from './vision-producer';
import { dispatch5drEngine, type EngineDispatchEnv } from './engine-dispatch';
import { acquireSystemResearch } from './system-research';
import { produceIntelligence } from './intelligence-producer';

type AiBinding={run:(model:string,input:Record<string,unknown>)=>Promise<unknown>};
type Env=EngineDispatchEnv&{ASSETS:Fetcher;EVIDENCE_BUCKET:R2Bucket;DATABASE_URL?:string;APP_ENV:string;OUTPUT_CONTRACT_VERSION:string;AI:AiBinding};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}});
const allowed=new Set<ScreenshotCategory>(['PRICE_TECHNICALS','DERIVATIVES_OI']);
const REQUIRED_FAMILIES=['PRICE_TECHNICALS','DERIVATIVES_OI','MARKET_TRUST','EVENT_SHOCK','EXECUTION_RISK'] as const;
const SYSTEM_FAMILIES=['MARKET_TRUST','EVENT_SHOCK','EXECUTION_RISK'] as const;
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const responseJson=async(response:Response):Promise<Record<string,unknown>>=>{try{const body=await response.clone().json();return isObject(body)?body:{}}catch{return {}}};

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
  const observations=[] as Record<string,unknown>[];
  for(const row of rows){
    const metadata=isObject(row.metadata)?row.metadata:{};
    const category=metadata.evidence_category;
    if(typeof category!=='string'||!allowed.has(category as ScreenshotCategory))return json({error:'request contains uncategorized or invalid screenshot evidence',upload_id:String(row.upload_id)},409);
    const object=await env.EVIDENCE_BUCKET.get(String(row.object_key));
    if(!object){observations.push({upload_id:String(row.upload_id),category,source_kind:'SCREENSHOT',source_ref:`evidence:${String(row.upload_id)}`,observed_at:row.captured_at,retrieved_at:new Date().toISOString(),verification:'UNAVAILABLE',findings:[],limitations:['Evidence object missing from private R2 storage']});continue;}
    const result=await analyzeScreenshot(env.AI,await object.arrayBuffer(),String(row.mime_type),category as ScreenshotCategory);
    observations.push({upload_id:String(row.upload_id),file_name:String(row.file_name),category:result.category,source_kind:'SCREENSHOT',source_ref:`evidence:${String(row.upload_id)}`,observed_at:row.captured_at,retrieved_at:new Date().toISOString(),verification:result.verification,findings:result.findings,limitations:result.limitations,model:result.model});
  }
  const missing=[...allowed].filter(category=>!observations.some(item=>item.category===category));
  const unavailable=observations.filter(item=>item.verification==='UNAVAILABLE');
  const visionStatus=missing.length||unavailable.length?'VISION_BLOCKED':'VISION_READY';
  const recordedAt=new Date().toISOString();
  const nextMetadata={...requestMetadata,screenshot_intelligence:{status:visionStatus,producer:'EDGE_CONSOLE_WORKERS_AI_VISION',producer_version:'0.2-shadow',recorded_at:recordedAt,observations,blockers:{missing_categories:missing,unavailable:unavailable.map(item=>({upload_id:item.upload_id,category:item.category,limitations:item.limitations}))}}};
  await sql`update analysis_requests set metadata=${JSON.stringify(nextMetadata)}::jsonb,updated_at=now() where request_id=${requestId}`;
  if(missing.length)return json({error:'required screenshot category missing from shadow vision work',vision_status:visionStatus,missing_categories:missing,observations},409);
  return json({ok:unavailable.length===0,mode:'SHADOW_NON_PUBLISHING',request_id:requestId,producer:'EDGE_CONSOLE_WORKERS_AI_VISION',producer_version:'0.2-shadow',adapter_stage:stage,vision_status:visionStatus,observations,blockers:unavailable.map(item=>({upload_id:item.upload_id,category:item.category,limitations:item.limitations})),next_step:unavailable.length?'FIX_OR_RETRY_SCREENSHOT_INTERPRETATION':'SYSTEM_WEB_RESEARCH'},unavailable.length?409:200);
}

async function systemResearch(env:Env,requestId:string):Promise<Response>{
  if(!env.DATABASE_URL)return json({error:'Database is not configured'},503);
  const sql=neon(env.DATABASE_URL);
  const rows=await sql`select metadata from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
  if(!rows.length)return json({error:'request_id not found'},404);
  const metadata=isObject(rows[0].metadata)?rows[0].metadata:{};
  const screenshotIntelligence=isObject(metadata.screenshot_intelligence)?metadata.screenshot_intelligence:{};
  if(screenshotIntelligence.status!=='VISION_READY')return json({error:'system research requires VISION_READY screenshot intelligence',vision_status:screenshotIntelligence.status??null},409);
  const acquisition=await acquireSystemResearch();
  const allReady=Object.values(acquisition.by_category).every(item=>item.ready_for_interpretation);
  const record={status:allReady?'RESEARCH_RETRIEVED':'RESEARCH_BLOCKED',retrieved_at:new Date().toISOString(),...acquisition};
  await sql`update analysis_requests set metadata=${JSON.stringify({...metadata,system_research_acquisition:record})}::jsonb,updated_at=now() where request_id=${requestId}`;
  return json({ok:allReady,request_id:requestId,system_research:record,next_step:allReady?'RESEARCH_INTERPRETATION':'RETRY_SYSTEM_RESEARCH'},allReady?200:409);
}

async function reconcileIntelligence(request:Request,env:Env,requestId:string):Promise<Response>{
  if(!env.DATABASE_URL)return json({error:'Database is not configured'},503);
  if(!env.AI||typeof env.AI.run!=='function')return json({error:'Workers AI binding is not configured'},503);
  const sql=neon(env.DATABASE_URL);
  const rows=await sql`select metadata from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
  if(!rows.length)return json({error:'request_id not found'},404);
  const metadata=isObject(rows[0].metadata)?rows[0].metadata:{};
  const screenshot=isObject(metadata.screenshot_intelligence)?metadata.screenshot_intelligence:{};
  const research=isObject(metadata.system_research_acquisition)?metadata.system_research_acquisition:{};
  if(screenshot.status!=='VISION_READY'||research.status!=='RESEARCH_RETRIEVED')return json({error:'intelligence reconciliation prerequisites are not ready',vision_status:screenshot.status??null,research_status:research.status??null},409);
  const screenshotObservations=Array.isArray(screenshot.observations)?screenshot.observations.filter(isObject):[];
  const snapshots=Array.isArray(research.snapshots)?research.snapshots.filter(isObject):[];
  const packet={screenshots:screenshotObservations,research:snapshots.map(item=>({...item,excerpt:typeof item.excerpt==='string'?item.excerpt.slice(0,4000):undefined}))};
  const sourceCategory=new Map<string,string>();
  for(const item of screenshotObservations)if(typeof item.source_ref==='string'&&typeof item.category==='string')sourceCategory.set(item.source_ref,item.category);
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
  const autonomousItems=SYSTEM_FAMILIES.map(category=>({category,status:produced.judgment!.verification==='VERIFIED'?'VERIFIED':'DEGRADED',source_refs:produced.judgment!.source_refs.filter(ref=>sourceCategory.get(ref)===category),retrieved_at:new Date().toISOString(),detail:`Governed intelligence reconciliation ${produced.judgment!.verification}`}));
  const origin=new URL(request.url).origin;
  const autonomousReq=new Request(`${origin}/api/5dr/run-requests/${encodeURIComponent(requestId)}/autonomous-evidence`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items:autonomousItems})});
  const autonomousResponse=await router.fetch(autonomousReq as any,env as any);
  if(!autonomousResponse.ok)return json({error:'autonomous evidence gate blocked after reconciliation',gate:await responseJson(autonomousResponse)},409);
  const observations=[
    ...screenshotObservations.filter(item=>produced.judgment!.source_refs.includes(String(item.source_ref))).map(item=>({category:String(item.category),source_kind:'SCREENSHOT',source_ref:String(item.source_ref),observed_at:String(item.observed_at),retrieved_at:String(item.retrieved_at),verification:produced.judgment!.verification,notes:Array.isArray(item.limitations)?item.limitations.join('; '):undefined})),
    ...snapshots.filter(item=>item.status==='RETRIEVED'&&produced.judgment!.source_refs.includes(String(item.source_ref))).map(item=>({category:String(item.category),source_kind:'WEB_RESEARCH',source_ref:String(item.source_ref),observed_at:String(item.retrieved_at),retrieved_at:String(item.retrieved_at),verification:produced.judgment!.verification,notes:typeof item.limitation==='string'?item.limitation:undefined}))
  ];
  const handoff={producer:'EDGE_CONSOLE_GOVERNED_INTELLIGENCE',producer_version:'0.2-shadow',request_id:requestId,observations,normalized:produced.normalized};
  const intelligenceReq=new Request(`${origin}/api/5dr/run-requests/${encodeURIComponent(requestId)}/intelligence`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(handoff)});
  const intelligenceResponse=await router.fetch(intelligenceReq as any,env as any);
  if(!intelligenceResponse.ok)return json({error:'intelligence handoff gate blocked',gate:await responseJson(intelligenceResponse)},409);
  const evidence=[{evidence_type:'INTELLIGENCE_RECONCILIATION',source_ref:`5dr-intelligence://${requestId}`,captured_at:new Date().toISOString(),normalized:produced.normalized}];
  const normalizedReq=new Request(`${origin}/api/5dr/run-requests/${encodeURIComponent(requestId)}/normalized`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({evidence})});
  const normalizedResponse=await normalizedAndDispatch(normalizedReq,env,requestId);
  const reconciliationRecord={status:normalizedResponse.ok?'NORMALIZED_AND_DISPATCHED':'NORMALIZED_OR_DISPATCH_BLOCKED',attempted_at:new Date().toISOString(),model:produced.model,verification:produced.judgment.verification,source_refs:produced.judgment.source_refs,limitations:produced.judgment.limitations};
  const latest=await sql`select metadata from analysis_requests where request_id=${requestId} limit 1`;
  const latestMetadata=latest.length&&isObject(latest[0].metadata)?latest[0].metadata:{};
  await sql`update analysis_requests set metadata=${JSON.stringify({...latestMetadata,intelligence_reconciliation:reconciliationRecord})}::jsonb,updated_at=now() where request_id=${requestId}`;
  const normalizedBody=await responseJson(normalizedResponse);
  return json({...normalizedBody,intelligence_reconciliation:reconciliationRecord},normalizedResponse.status);
}

async function normalizedAndDispatch(request:Request,env:Env,requestId:string):Promise<Response>{
  const normalizedResponse=await router.fetch(request.clone() as any,env as any);
  if(!normalizedResponse.ok||!env.DATABASE_URL)return normalizedResponse;
  let normalizedBody:Record<string,unknown>={};
  try{const parsed=await normalizedResponse.clone().json();if(isObject(parsed))normalizedBody=parsed}catch{}
  if(normalizedBody.adapter_stage!=='NORMALIZED_READY')return normalizedResponse;
  const sql=neon(env.DATABASE_URL);
  const rows=await sql`select status,metadata from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
  if(!rows.length)return json({error:'request_id not found after normalization'},404);
  const metadata=isObject(rows[0].metadata)?rows[0].metadata:{};
  const previous=isObject(metadata.engine_dispatch)?metadata.engine_dispatch:{};
  if(previous.status==='DISPATCHED')return json({...normalizedBody,engine_dispatch:previous});
  const dispatch=await dispatch5drEngine(env,requestId,request.url);
  const dispatchRecord={...dispatch,attempted_at:new Date().toISOString()};
  const nextMetadata={...metadata,engine_dispatch:dispatchRecord};
  if(dispatch.ok){
    await sql`update analysis_requests set status='PROCESSING',metadata=${JSON.stringify(nextMetadata)}::jsonb,error=null,updated_at=now() where request_id=${requestId}`;
    return json({...normalizedBody,engine_dispatch:dispatchRecord,status:'PROCESSING'});
  }
  await sql`update analysis_requests set metadata=${JSON.stringify(nextMetadata)}::jsonb,updated_at=now() where request_id=${requestId}`;
  return json({...normalizedBody,ok:false,engine_dispatch:dispatchRecord,next_step:'RETRY_ENGINE_DISPATCH'},503);
}

export default {async fetch(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url);
  if(url.pathname==='/api/evidence/upload'&&request.method==='POST')return uploadCategorizedEvidence(request,env);
  if(url.pathname==='/api/5dr/vision-readiness'&&request.method==='GET')return visionReadiness(env);
  const vision=url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/shadow-vision$/);
  if(vision&&request.method==='POST')return shadowVision(env,decodeURIComponent(vision[1]));
  const research=url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/system-research$/);
  if(research&&request.method==='POST')return systemResearch(env,decodeURIComponent(research[1]));
  const reconcile=url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/reconcile-intelligence$/);
  if(reconcile&&request.method==='POST')return reconcileIntelligence(request,env,decodeURIComponent(reconcile[1]));
  const normalized=url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/normalized$/);
  if(normalized&&request.method==='POST')return normalizedAndDispatch(request,env,decodeURIComponent(normalized[1]));
  return router.fetch(request,env as any);
}};
