import { neon } from '@neondatabase/serverless';
import router from './router';
import { uploadCategorizedEvidence } from './categorized-evidence-upload';
import { analyzeScreenshot, type ScreenshotCategory } from './vision-producer';

type AiBinding={run:(model:string,input:Record<string,unknown>)=>Promise<unknown>};
type Env={ASSETS:Fetcher;EVIDENCE_BUCKET:R2Bucket;DATABASE_URL?:string;APP_ENV:string;OUTPUT_CONTRACT_VERSION:string;AI:AiBinding};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}});
const allowed=new Set<ScreenshotCategory>(['PRICE_TECHNICALS','DERIVATIVES_OI']);

async function shadowVision(env:Env,requestId:string):Promise<Response>{
  if(!env.DATABASE_URL)return json({error:'Database is not configured'},503);
  if(!env.AI||typeof env.AI.run!=='function')return json({error:'Workers AI binding is not configured'},503);
  const sql=neon(env.DATABASE_URL);
  const requests=await sql`select request_id,metadata from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
  if(!requests.length)return json({error:'request_id not found'},404);
  const requestMetadata=requests[0].metadata&&typeof requests[0].metadata==='object'?requests[0].metadata as Record<string,unknown>:{};
  const stage=String(requestMetadata.adapter_stage??'');
  if(!['SCREENSHOTS_READY','AUTONOMOUS_EVIDENCE_BLOCKED','AUTONOMOUS_EVIDENCE_READY','INTELLIGENCE_BLOCKED'].includes(stage))return json({error:'request is not eligible for shadow vision',adapter_stage:stage},409);
  const rows=await sql`select upload_id,object_key,file_name,mime_type,captured_at,metadata from evidence_uploads where request_id=${requestId} order by id`;
  if(!rows.length)return json({error:'request has no attached screenshot evidence'},409);
  const observations=[] as Record<string,unknown>[];
  for(const row of rows){
    const metadata=row.metadata&&typeof row.metadata==='object'?row.metadata as Record<string,unknown>:{};
    const category=metadata.evidence_category;
    if(typeof category!=='string'||!allowed.has(category as ScreenshotCategory))return json({error:'request contains uncategorized or invalid screenshot evidence',upload_id:String(row.upload_id)},409);
    const object=await env.EVIDENCE_BUCKET.get(String(row.object_key));
    if(!object){observations.push({upload_id:String(row.upload_id),category,source_ref:`evidence:${String(row.upload_id)}`,observed_at:row.captured_at,retrieved_at:new Date().toISOString(),verification:'UNAVAILABLE',findings:[],limitations:['Evidence object missing from private R2 storage']});continue;}
    const result=await analyzeScreenshot(env.AI,await object.arrayBuffer(),String(row.mime_type),category as ScreenshotCategory);
    observations.push({upload_id:String(row.upload_id),file_name:String(row.file_name),category:result.category,source_ref:`evidence:${String(row.upload_id)}`,observed_at:row.captured_at,retrieved_at:new Date().toISOString(),verification:result.verification,findings:result.findings,limitations:result.limitations,model:result.model});
  }
  const missing=[...allowed].filter(category=>!observations.some(item=>item.category===category));
  if(missing.length)return json({error:'required screenshot category missing from shadow vision work',missing_categories:missing,observations},409);
  const unavailable=observations.filter(item=>item.verification==='UNAVAILABLE');
  return json({ok:unavailable.length===0,mode:'SHADOW_NON_PUBLISHING',request_id:requestId,producer:'EDGE_CONSOLE_WORKERS_AI_VISION',producer_version:'0.1-shadow',adapter_stage:stage,observations,blockers:unavailable.map(item=>({upload_id:item.upload_id,category:item.category,limitations:item.limitations})),next_step:unavailable.length?'FIX_OR_RETRY_SCREENSHOT_INTERPRETATION':'SYSTEM_WEB_RESEARCH'},unavailable.length?409:200);
}

export default {async fetch(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url);
  if(url.pathname==='/api/evidence/upload'&&request.method==='POST')return uploadCategorizedEvidence(request,env);
  const vision=url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/shadow-vision$/);
  if(vision&&request.method==='POST')return shadowVision(env,decodeURIComponent(vision[1]));
  return router.fetch(request,env as any);
}};
