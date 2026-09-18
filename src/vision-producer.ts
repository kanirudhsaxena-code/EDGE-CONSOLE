export const VISION_MODEL='@cf/google/gemma-4-26b-a4b-it';
export type ScreenshotCategory='PRICE_TECHNICALS'|'DERIVATIVES_OI';
export type VisionFinding={label:string;value:string|number|boolean|null;confidence:number;notes?:string};
export type VisionObservation={category:ScreenshotCategory;verification:'VERIFIED'|'DEGRADED'|'UNAVAILABLE';findings:VisionFinding[];limitations:string[];model:string};
export type VisionReadiness={ok:boolean;model:string;status:'READY'|'LICENSE_NOT_ACCEPTED'|'RATE_LIMITED'|'UNAVAILABLE'};

type AiBinding={run:(model:string,input:Record<string,unknown>)=>Promise<unknown>};

const prompt=(category:ScreenshotCategory)=>`You are the screenshot evidence extractor for a governed NIFTY 5-day forecasting system. Analyze ONLY what is visibly supported by this image. Category: ${category}. Do not infer missing values and do not create a forecast, recommendation, score, regime or normalized 5DR input. Call submit_screenshot_evidence exactly once with your factual extraction. Use VERIFIED only when the relevant screenshot content is clearly legible; DEGRADED when useful evidence exists but important parts are ambiguous; UNAVAILABLE when the image cannot support the category. Confidence must be between 0 and 1.

IMPORTANT: extract the richest decision-relevant facts that are actually visible instead of collapsing the screenshot into one headline number.

For PRICE_TECHNICALS, capture whenever visibly supported:
- timeframe / chart interval and visible lookback window,
- current/last price, open, previous close, day range and volume,
- visible trend structure across the chart (for example higher highs/higher lows, lower highs/lower lows, sideways/range), but only when the chart visibly supports it,
- whether price is above/below visibly labelled VWAP, EMA, SMA or other plotted reference,
- visible support/resistance, swing high/low, breakout/rejection or gap levels,
- momentum/volume behaviour if visibly labelled or unambiguous,
- longer-term direction when the screenshot clearly displays a multi-day/multi-week/multi-month chart. Label it "Visible Trend Structure" and state the visible timeframe in notes.

For DERIVATIVES_OI, do NOT reduce an option-chain screenshot to aggregate Put/Call OI when strike rows are visible. Capture:
- expiry and spot/underlying value when visible,
- every clearly legible near-ATM strike row, up to 12 strikes,
- for each visible strike and each CE/PE side: premium/LTP, OI, change in OI, volume and IV when shown,
- use standardized labels such as "Strike 24300 CE LTP", "Strike 24300 CE OI", "Strike 24300 CE Change OI", "Strike 24300 CE Volume", and equivalent PE labels,
- PCR or aggregate totals only as additional context, never as a substitute for visible strike-level facts.

Do not claim a field is missing if it is visibly present elsewhere in the same screenshot. Keep limitations specific to what is genuinely unreadable or absent.`;

const evidenceTool=(category:ScreenshotCategory)=>({
  name:'submit_screenshot_evidence',
  description:'Submit only factual evidence visibly supported by the screenshot.',
  parameters:{
    type:'object',
    properties:{
      category:{type:'string',enum:[category]},
      verification:{type:'string',enum:['VERIFIED','DEGRADED','UNAVAILABLE']},
      findings:{type:'array',items:{type:'object',properties:{label:{type:'string'},value:{anyOf:[{type:'string'},{type:'number'},{type:'boolean'},{type:'null'}]},confidence:{type:'number',minimum:0,maximum:1},notes:{type:'string'}},required:['label','value','confidence']}},
      limitations:{type:'array',items:{type:'string'}}
    },
    required:['category','verification','findings','limitations']
  }
});

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

function parseToolCalls(value:unknown):unknown{
  if(!Array.isArray(value))return null;
  for(const call of value){
    if(!call||typeof call!=='object')continue;
    const c=call as Record<string,unknown>;
    // Workers AI traditional shape: {name, arguments}
    if(c.name==='submit_screenshot_evidence'){
      if(c.arguments&&typeof c.arguments==='object')return c.arguments;
      if(typeof c.arguments==='string')return parseJsonText(c.arguments);
    }
    // OpenAI-compatible shape: {type:'function', function:{name, arguments}}
    if(c.function&&typeof c.function==='object'){
      const fn=c.function as Record<string,unknown>;
      if(fn.name==='submit_screenshot_evidence'){
        if(fn.arguments&&typeof fn.arguments==='object')return fn.arguments;
        if(typeof fn.arguments==='string')return parseJsonText(fn.arguments);
      }
    }
  }
  return null;
}

function parseMessage(value:unknown):unknown{
  if(!value||typeof value!=='object')return null;
  const m=value as Record<string,unknown>;
  const tool=parseToolCalls(m.tool_calls);
  if(tool)return tool;
  if(typeof m.content==='string'){
    const parsed=parseJsonText(m.content);
    if(parsed)return parsed;
  }
  return null;
}

function parseResponse(raw:unknown):unknown{
  if(typeof raw==='string')return parseJsonText(raw);
  if(raw&&typeof raw==='object'){
    const r=raw as Record<string,unknown>;
    const directTool=parseToolCalls(r.tool_calls);
    if(directTool)return directTool;

    if(Array.isArray(r.choices)){
      for(const choice of r.choices){
        if(!choice||typeof choice!=='object')continue;
        const c=choice as Record<string,unknown>;
        const parsed=parseMessage(c.message);
        if(parsed)return parsed;
      }
    }

    if(r.response&&typeof r.response==='object'){
      const nested=r.response as Record<string,unknown>;
      const nestedTool=parseToolCalls(nested.tool_calls);
      if(nestedTool)return nestedTool;
      if(Array.isArray(nested.choices)){
        for(const choice of nested.choices){
          if(!choice||typeof choice!=='object')continue;
          const c=choice as Record<string,unknown>;
          const parsed=parseMessage(c.message);
          if(parsed)return parsed;
        }
      }
      if('category' in nested&&'verification' in nested&&'findings' in nested&&'limitations' in nested)return nested;
    }
    if(r.result&&typeof r.result==='object'){
      const nested=r.result as Record<string,unknown>;
      const nestedTool=parseToolCalls(nested.tool_calls);
      if(nestedTool)return nestedTool;
      if(Array.isArray(nested.choices)){
        for(const choice of nested.choices){
          if(!choice||typeof choice!=='object')continue;
          const c=choice as Record<string,unknown>;
          const parsed=parseMessage(c.message);
          if(parsed)return parsed;
        }
      }
      if('category' in nested&&'verification' in nested&&'findings' in nested&&'limitations' in nested)return nested;
    }
    if(typeof r.response==='string')return parseJsonText(r.response);
    if(typeof r.result==='string')return parseJsonText(r.result);
    if('category' in r&&'verification' in r&&'findings' in r&&'limitations' in r)return r;
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

function applyCurrentEvidenceSanity(observation:VisionObservation,category:ScreenshotCategory):VisionObservation{
  if(category!=='DERIVATIVES_OI')return observation;
  const expiry=observation.findings.find(f=>String(f.label).toLowerCase()==='expiry');
  if(typeof expiry?.value!=='string')return observation;
  const parsed=Date.parse(expiry.value);
  if(Number.isNaN(parsed))return observation;
  const now=new Date();
  const today=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
  if(parsed<today)return {...observation,verification:'UNAVAILABLE',limitations:[...observation.limitations,'Extracted option expiry is already past the current run date; current derivatives evidence cannot be trusted.']};
  return observation;
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
    const raw=await withTimeout(ai.run(VISION_MODEL,{
      messages:[{role:'system',content:'Extract governed screenshot evidence. Never fabricate unreadable data. Use the submit_screenshot_evidence tool.'},{role:'user',content:prompt(category)}],
      image:imageBase64,
      tools:[evidenceTool(category)],
      tool_choice:'required',
      parallel_tool_calls:false,
      max_tokens:1400,
      temperature:0,
      chat_template_kwargs:{enable_thinking:false}
    }),45000);
    const parsed=parseResponse(raw); const valid=validateVisionObservation(parsed,category);
    return valid?applyCurrentEvidenceSanity(valid,category):{category,verification:'UNAVAILABLE',findings:[],limitations:['Vision model returned an invalid governed evidence envelope'],model:VISION_MODEL};
  }catch(error){
    const status=classifyVisionFailure(error);
    const timedOut=errorText(error).includes('timeout');
    return {category,verification:'UNAVAILABLE',findings:[],limitations:[timedOut?'Workers AI vision inference timed out':status==='LICENSE_NOT_ACCEPTED'?'Workers AI vision model licence acceptance is required before live inference':status==='RATE_LIMITED'?'Workers AI vision inference is rate limited':'Workers AI vision inference is unavailable'],model:VISION_MODEL};
  }
}
