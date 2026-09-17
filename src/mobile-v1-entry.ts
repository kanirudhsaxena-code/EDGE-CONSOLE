import { neon } from '@neondatabase/serverless';
import router from './router';
import { uploadCategorizedEvidence } from './categorized-evidence-upload';
import { analyzeScreenshot, probeVisionReadiness, type ScreenshotCategory } from './vision-producer';
import { dispatch5drEngine, type EngineDispatchEnv } from './engine-dispatch';

type AiBinding={run:(model:string,input:Record<string,unknown>)=>Promise<unknown>};
type Env=EngineDispatchEnv&{ASSETS:Fetcher;EVIDENCE_BUCKET:R2Bucket;DATABASE_URL?:string;APP_ENV:string;OUTPUT_CONTRACT_VERSION:string;AI:AiBinding};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}});
const allowed=new Set<ScreenshotCategory>(['PRICE_TECHNICALS','DERIVATIVES_OI']);
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

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
  const normalized=url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/normalized$/);
  if(normalized&&request.method==='POST')return normalizedAndDispatch(request,env,decodeURIComponent(normalized[1]));
  return router.fetch(request,env as any);
}};
