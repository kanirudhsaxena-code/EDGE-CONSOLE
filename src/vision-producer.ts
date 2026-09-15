export const VISION_MODEL='@cf/meta/llama-3.2-11b-vision-instruct';
export type ScreenshotCategory='PRICE_TECHNICALS'|'DERIVATIVES_OI';
export type VisionFinding={label:string;value:string|number|boolean|null;confidence:number;notes?:string};
export type VisionObservation={category:ScreenshotCategory;verification:'VERIFIED'|'DEGRADED'|'UNAVAILABLE';findings:VisionFinding[];limitations:string[];model:string};

type AiBinding={run:(model:string,input:Record<string,unknown>)=>Promise<unknown>};

const prompt=(category:ScreenshotCategory)=>`You are the screenshot evidence extractor for a governed NIFTY 5-day forecasting system. Analyze ONLY what is visibly supported by this image. Category: ${category}. Do not infer missing values and do not create a forecast, recommendation, score, regime or normalized 5DR input. Return JSON only with this exact shape: {"category":"${category}","verification":"VERIFIED|DEGRADED|UNAVAILABLE","findings":[{"label":"string","value":"string|number|boolean|null","confidence":0.0,"notes":"optional"}],"limitations":["string"]}. Use VERIFIED only when the relevant screenshot content is clearly legible; DEGRADED when useful evidence exists but important parts are ambiguous; UNAVAILABLE when the image cannot support the category. Confidence must be between 0 and 1.`;

function parseResponse(raw:unknown):unknown{
  if(typeof raw==='string'){try{return JSON.parse(raw)}catch{return null}}
  if(raw&&typeof raw==='object'){
    const r=raw as Record<string,unknown>;
    if(typeof r.response==='string'){try{return JSON.parse(r.response)}catch{return null}}
    if(typeof r.result==='string'){try{return JSON.parse(r.result)}catch{return null}}
  }
  return null;
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

export async function analyzeScreenshot(ai:AiBinding,image:ArrayBuffer,mimeType:string,category:ScreenshotCategory):Promise<VisionObservation>{
  if(!mimeType.startsWith('image/'))return {category,verification:'UNAVAILABLE',findings:[],limitations:['Vision producer accepts image evidence only'],model:VISION_MODEL};
  const bytes=new Uint8Array(image); let binary=''; for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  const imageBase64=`data:${mimeType};base64,${btoa(binary)}`;
  try{
    const raw=await ai.run(VISION_MODEL,{messages:[{role:'system',content:'Extract governed screenshot evidence. Never fabricate unreadable data.'},{role:'user',content:prompt(category)}],image:imageBase64,max_tokens:1200,temperature:0});
    const parsed=parseResponse(raw); const valid=validateVisionObservation(parsed,category);
    return valid??{category,verification:'UNAVAILABLE',findings:[],limitations:['Vision model returned an invalid governed evidence envelope'],model:VISION_MODEL};
  }catch(error){
    return {category,verification:'UNAVAILABLE',findings:[],limitations:[`Vision inference unavailable: ${error instanceof Error?error.message:'unknown error'}`],model:VISION_MODEL};
  }
}
