export const VISION_MODEL='@cf/google/gemma-4-26b-a4b-it';
export type ScreenshotCategory='PRICE_TECHNICALS'|'DERIVATIVES_OI';
export type VisionFinding={label:string;value:string|number|boolean|null;confidence:number;notes?:string};
export type VisionObservation={category:ScreenshotCategory;verification:'VERIFIED'|'DEGRADED'|'UNAVAILABLE';findings:VisionFinding[];limitations:string[];model:string};
export type VisionReadiness={ok:boolean;model:string;status:'READY'|'LICENSE_NOT_ACCEPTED'|'RATE_LIMITED'|'UNAVAILABLE'};

type AiBinding={run:(model:string,input:Record<string,unknown>)=>Promise<unknown>};

const prompt=(category:ScreenshotCategory)=>`You are the screenshot evidence extractor for a governed NIFTY 5-day forecasting system. Analyze ONLY what is visibly supported by this image. Category: ${category}. Do not infer missing values and do not create a forecast, recommendation, score, regime or normalized 5DR input. Return JSON only with this exact shape: {"category":"${category}","verification":"VERIFIED|DEGRADED|UNAVAILABLE","findings":[{"label":"string","value":"string|number|boolean|null","confidence":0.0,"notes":"optional"}],"limitations":["string"]}. Use VERIFIED only when the relevant screenshot content is clearly legible; DEGRADED when useful evidence exists but important parts are ambiguous; UNAVAILABLE when the image cannot support the category. Confidence must be between 0 and 1. Keep the response concise: return only the material facts needed from the screenshot, with no prose outside the JSON.`;

function parseJsonText(text:string):unknown{
  const trimmed=text.trim();
  const candidates=[trimmed];
  const fenced=trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if(fenced?.[1])candidates.push(fenced[1].trim());
  const first=trimmed.indexOf('{'),last=trimmed.lastIndexOf('}');
  if(first>=0&&last>first)candidates.push(trimmed.slice(first,last+1));
  for(const candidate of candidates){try{return JSON.parse(candidate)}catch{}}
  return null;
}

function parseResponse(raw:unknown):unknown{
  if(typeof raw==='string')return parseJsonText(raw);
  if(raw&&typeof raw==='object'){
    const r=raw as Record<string,unknown>;
    if(typeof r.response==='string')return parseJsonText(r.response);
    if(typeof r.result==='string')return parseJsonText(r.result);
    if(r.response&&typeof r.response==='object')return r.response;
    if(r.result&&typeof r.result==='object')return r.result;
  }
  return null;
}

function errorText(error:unknown):string{
  if(error instanceof Error)return `${error.name} ${error.message}`.toLowerCase();
  return String(error??'').toLowerCase();
}

export function classifyVisionFailure(error:unknown):VisionReadiness['status']{
  const text=errorText(error);
  if(text.includes('5016')||text.includes('model agreement')||text.includes('license')||text.includes('licence'))return 'LICENSE_NOT_ACCEPTED';
  if(text.includes('429')||text.includes('rate limit')||text.includes('quota')||text.includes('capacity'))return 'RATE_LIMITED';
  return 'UNAVAILABLE';
}

export function validateVisionObservation(raw:unknown,category:ScreenshotCategory):VisionObservation|null{
  if(!raw||typeof raw!=='object')return null;
  const x=raw as Record<string,unknown>;
  if(x.category!==category||!['VERIFIED','DEGRADED','UNAVAILABLE'].includes(String(x.verification))||!Array.isArray(x.findings)||!Array.isArray(x.limitations))return null;
  const findings:VisionFinding[]=[];
  for(const item of x.findings){
    if(!item||typeof item!=='object')return null;
    const f=item as Record<string,unknown>;
    if(typeof f.label!=='string'||!f.label.trim()||typeof f.confidence!=='number'||f.confidence<0||f.confidence>1)return null;
    if(!['string','number','boolean'].includes(typeof f.value)&&f.value!==null)return null;
    findings.push({label:f.label,value:f.value as VisionFinding['value'],confidence:f.confidence,notes:typeof f.notes==='string'?f.notes:undefined});
  }
  if(!x.limitations.every(v=>typeof v==='string'))return null;
  if(x.verification==='VERIFIED'&&findings.length===0)return null;
  return {category,verification:x.verification as VisionObservation['verification'],findings,limitations:x.limitations as string[],model:VISION_MODEL};
}

export async function probeVisionReadiness(ai:AiBinding):Promise<VisionReadiness>{
  try{
    await ai.run(VISION_MODEL,{messages:[{role:'user',content:'Reply exactly READY.'}],max_tokens:8,temperature:0,chat_template_kwargs:{enable_thinking:false}});
    return {ok:true,model:VISION_MODEL,status:'READY'};
  }catch(error){
    return {ok:false,model:VISION_MODEL,status:classifyVisionFailure(error)};
  }
}

function withTimeout<T>(promise:Promise<T>,ms:number):Promise<T>{
  return new Promise<T>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('vision inference timeout')),ms);
    promise.then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)});
  });
}

export async function analyzeScreenshot(ai:AiBinding,image:ArrayBuffer,mimeType:string,category:ScreenshotCategory):Promise<VisionObservation>{
  if(!mimeType.startsWith('image/'))return {category,verification:'UNAVAILABLE',findings:[],limitations:['Vision producer accepts image evidence only'],model:VISION_MODEL};
  const bytes=new Uint8Array(image); let binary=''; for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  const imageBase64=`data:${mimeType};base64,${btoa(binary)}`;
  try{
    const raw=await withTimeout(ai.run(VISION_MODEL,{messages:[{role:'system',content:'Extract governed screenshot evidence. Never fabricate unreadable data.'},{role:'user',content:prompt(category)}],image:imageBase64,max_tokens:450,temperature:0,chat_template_kwargs:{enable_thinking:false}}),45000);
    const parsed=parseResponse(raw); const valid=validateVisionObservation(parsed,category);
    return valid??{category,verification:'UNAVAILABLE',findings:[],limitations:['Vision model returned an invalid governed evidence envelope'],model:VISION_MODEL};
  }catch(error){
    const status=classifyVisionFailure(error);
    const timedOut=errorText(error).includes('timeout');
    return {category,verification:'UNAVAILABLE',findings:[],limitations:[timedOut?'Workers AI vision inference timed out':status==='LICENSE_NOT_ACCEPTED'?'Workers AI vision model licence acceptance is required before live inference':status==='RATE_LIMITED'?'Workers AI vision inference is rate limited':'Workers AI vision inference is unavailable'],model:VISION_MODEL};
  }
}
