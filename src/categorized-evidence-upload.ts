import { neon } from '@neondatabase/serverless';

export type UploadEnv={EVIDENCE_BUCKET:R2Bucket;DATABASE_URL?:string};
type Category='PRICE_TECHNICALS'|'DERIVATIVES_OI';
type ManifestItem={category:Category;file_name:string};
const CATEGORIES=new Set<Category>(['PRICE_TECHNICALS','DERIVATIVES_OI']);
const TYPES=new Set(['image/jpeg','image/png','image/webp','application/pdf']);
const MAX_FILES=20,MAX_BYTES=10*1024*1024;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=utf-8'}});
const safe=(name:string)=>name.replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').slice(0,120)||'evidence';

function parseManifest(raw:FormDataEntryValue|null,files:File[]):ManifestItem[]|null{
  if(typeof raw!=='string')return null;
  let value:unknown;try{value=JSON.parse(raw)}catch{return null}
  if(!Array.isArray(value)||value.length!==files.length)return null;
  const out:ManifestItem[]=[];
  for(let i=0;i<value.length;i++){
    const x=value[i];if(!x||typeof x!=='object')return null;
    const category=String((x as any).category) as Category,fileName=String((x as any).file_name||'');
    if(!CATEGORIES.has(category)||fileName!==files[i].name)return null;
    out.push({category,file_name:fileName});
  }
  if(!out.some(x=>x.category==='PRICE_TECHNICALS')||!out.some(x=>x.category==='DERIVATIVES_OI'))return null;
  return out;
}

export async function uploadCategorizedEvidence(request:Request,env:UploadEnv):Promise<Response>{
  if(!env.DATABASE_URL)return json({error:'Database is not configured'},503);
  let form:FormData;try{form=await request.formData()}catch{return json({error:'Invalid multipart form data'},400)}
  const engine=String(form.get('engine')||''),mode=String(form.get('provenance_mode')||'').toUpperCase(),capturedRaw=String(form.get('captured_at')||''),files=form.getAll('files').filter((x):x is File=>x instanceof File);
  if(engine!=='5DR')return json({error:'Evidence upload currently supports 5DR only'},422);
  if(!['MANUAL','HYBRID','AUTOMATED'].includes(mode))return json({error:'Invalid provenance_mode'},422);
  if(!files.length||files.length>MAX_FILES)return json({error:'Evidence file count is invalid'},422);
  const manifest=parseManifest(form.get('evidence_manifest'),files);if(!manifest)return json({error:'Governed evidence_manifest is invalid or incomplete'},422);
  for(const file of files){if(!TYPES.has(file.type))return json({error:`Unsupported evidence type: ${file.type||'unknown'}`,file:file.name},415);if(file.size<=0||file.size>MAX_BYTES)return json({error:'Each evidence file must be between 1 byte and 10 MB',file:file.name},413)}
  const capturedAt=capturedRaw&&!Number.isNaN(Date.parse(capturedRaw))?new Date(capturedRaw).toISOString():new Date().toISOString(),now=new Date(),batchId=crypto.randomUUID(),prefix=`5dr/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}/${String(now.getUTCDate()).padStart(2,'0')}`,sql=neon(env.DATABASE_URL),stored:string[]=[],uploaded:any[]=[];
  try{for(let i=0;i<files.length;i++){const file=files[i],category=manifest[i].category,uploadId=crypto.randomUUID(),filename=safe(file.name),key=`${prefix}/${batchId}/${uploadId}-${filename}`;await env.EVIDENCE_BUCKET.put(key,file.stream(),{httpMetadata:{contentType:file.type},customMetadata:{engine,provenance_mode:mode,upload_id:uploadId,batch_id:batchId,original_filename:filename,captured_at:capturedAt,evidence_category:category}});stored.push(key);const metadata={storage:'R2',bucket_binding:'EVIDENCE_BUCKET',evidence_category:category};await sql`insert into evidence_uploads (upload_id,batch_id,engine,provenance_mode,object_key,file_name,mime_type,size_bytes,captured_at,status,metadata) values (${uploadId},${batchId},${engine},${mode},${key},${filename},${file.type},${file.size},${capturedAt},'STAGED',${JSON.stringify(metadata)}::jsonb)`;uploaded.push({upload_id:uploadId,file_name:filename,mime_type:file.type,size_bytes:file.size,captured_at:capturedAt,status:'STAGED',evidence_category:category})}}
  catch(error){console.error('Categorized evidence upload failed',error);await Promise.allSettled(stored.map(k=>env.EVIDENCE_BUCKET.delete(k)));if(uploaded.length)await sql`delete from evidence_uploads where batch_id=${batchId}`;return json({error:'Evidence upload failed; staged files were rolled back'},500)}
  return json({ok:true,batch_id:batchId,engine,provenance_mode:mode,file_count:uploaded.length,evidence:uploaded,next_step:'Apply screenshot readiness gate'},201);
}
