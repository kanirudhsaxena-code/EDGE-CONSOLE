import {
  EDGE_RESEARCH_BUNDLE_VERSION,
  MANDATORY_EDGE_RESEARCH_CATEGORIES,
  validateEdgeResearchBundle,
  type EdgeResearchBundle,
  type EdgeResearchClaim,
  type EdgeResearchSource,
  type SourceAuthority,
} from './edge-research';
import { INTELLIGENCE_MODEL, INTELLIGENCE_FALLBACK_MODEL } from './intelligence-producer';

type AiBinding={run:(model:string,input:Record<string,unknown>)=>Promise<unknown>};
type Env={AI:AiBinding};
type JsonRecord=Record<string,unknown>;

type SourceSpec={id:string;url:string;title:string;authority:SourceAuthority};

const MAX_SOURCE_BYTES=384*1024;
const MAX_EXCERPT_CHARS=9000;
const FETCH_TIMEOUT_MS=12000;

const COMPANY_SOURCES:Record<string,SourceSpec[]>={
  LTF:[
    {id:'LTF_OFFICIAL_NEWSROOM',url:'https://www.ltfinance.com/news-room',title:'L&T Finance official newsroom',authority:'COMPANY'},
    {id:'LTF_OFFICIAL_INVESTORS',url:'https://www.ltfinance.com/investors',title:'L&T Finance investor relations',authority:'COMPANY'},
  ],
  CUPID:[
    {id:'CUPID_OFFICIAL_NOTICES',url:'https://www.cupidlimited.com/shareholders-notice/shareholders-notice-2026-2027/',title:'Cupid Limited shareholder notices',authority:'COMPANY'},
    {id:'CUPID_OFFICIAL_FINANCIALS',url:'https://www.cupidlimited.com/financial-reports/',title:'Cupid Limited financial reports',authority:'COMPANY'},
  ],
  RELIANCE:[
    {id:'RELIANCE_OFFICIAL_PRESS',url:'https://www.ril.com/news-media/press-releases',title:'Reliance Industries official press releases',authority:'COMPANY'},
    {id:'RELIANCE_OFFICIAL_INVESTORS',url:'https://www.ril.com/investors/financial-reporting',title:'Reliance Industries financial reporting',authority:'COMPANY'},
  ],
};

const isObject=(v:unknown):v is JsonRecord=>!!v&&typeof v==='object'&&!Array.isArray(v);
const clean=(text:string)=>text
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;/gi,' ')
  .replace(/&amp;/gi,'&')
  .replace(/&#39;/gi,"'")
  .replace(/&quot;/gi,'"')
  .replace(/\s+/g,' ')
  .trim()
  .slice(0,MAX_EXCERPT_CHARS);

const hex=(buffer:ArrayBuffer)=>[...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');
const digest=async(text:string)=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));

function genericSources(ticker:string):SourceSpec[]{
  const q=encodeURIComponent(ticker+' NSE stock');
  return [
    {
      id:`${ticker}_SCREENER`,
      url:`https://www.screener.in/company/${encodeURIComponent(ticker)}/consolidated/`,
      title:`${ticker} consolidated financial, valuation and shareholding snapshot`,
      authority:'REPUTABLE_SECONDARY',
    },
    {
      id:`${ticker}_NSE_QUOTE`,
      url:`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(ticker)}`,
      title:`${ticker} NSE company/market page`,
      authority:'EXCHANGE',
    },
    {
      id:`${ticker}_NEWS_RSS`,
      url:`https://news.google.com/rss/search?q=${q}%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en`,
      title:`${ticker} recent news discovery feed`,
      authority:'REPUTABLE_SECONDARY',
    },
  ];
}

async function boundedText(response:Response):Promise<string>{
  const declared=Number(response.headers.get('content-length')||'0');
  if(Number.isFinite(declared)&&declared>MAX_SOURCE_BYTES)throw new Error('SOURCE_TOO_LARGE');
  const reader=response.body?.getReader();
  if(!reader)return '';
  const chunks:Uint8Array[]=[];let total=0;
  while(true){
    const {done,value}=await reader.read();
    if(done)break;
    if(value){
      total+=value.byteLength;
      if(total>MAX_SOURCE_BYTES){reader.cancel().catch(()=>{});throw new Error('SOURCE_TOO_LARGE')}
      chunks.push(value);
    }
  }
  const merged=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){merged.set(chunk,offset);offset+=chunk.byteLength}
  return new TextDecoder().decode(merged);
}

async function fetchSource(spec:SourceSpec,fetcher:typeof fetch):Promise<{
  source:EdgeResearchSource&{content_sha256:string;excerpt:string};
  ok:boolean;
  limitation?:string;
}>{
  const retrievedAt=new Date().toISOString();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),FETCH_TIMEOUT_MS);
  try{
    const response=await fetcher(spec.url,{
      method:'GET',
      redirect:'follow',
      signal:controller.signal,
      headers:{
        'accept':'text/html,application/xhtml+xml,application/xml,text/xml,application/json;q=0.9,*/*;q=0.7',
        'accept-language':'en-IN,en;q=0.9',
        'cache-control':'no-cache',
        'user-agent':'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36 EDGE-STOCK-RESEARCH/2.0',
      },
    });
    if(!response.ok)throw new Error(`HTTP_${response.status}`);
    const raw=await boundedText(response);
    const excerpt=clean(raw);
    if(!excerpt)throw new Error('SOURCE_EMPTY');
    return {
      ok:true,
      source:{
        source_id:spec.id,
        provider:'SYSTEM_WEB',
        authority:spec.authority,
        url:spec.url,
        title:spec.title,
        retrieved_at:retrievedAt,
        publication_date:null,
        event_date:null,
        content_sha256:await digest(raw),
        excerpt,
      },
    };
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    return {
      ok:false,
      limitation:`${spec.id} unavailable: ${message.slice(0,120)}`,
      source:{
        source_id:spec.id,
        provider:'SYSTEM_WEB',
        authority:spec.authority,
        url:spec.url,
        title:spec.title,
        retrieved_at:retrievedAt,
        publication_date:null,
        event_date:null,
        content_sha256:'',
        excerpt:'',
      },
    };
  }finally{clearTimeout(timer)}
}

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

function parseAi(raw:unknown):unknown{
  if(typeof raw==='string')return parseJsonText(raw);
  if(!isObject(raw))return null;
  if(Array.isArray(raw.choices)){
    for(const choice of raw.choices){
      if(!isObject(choice)||!isObject(choice.message)||typeof choice.message.content!=='string')continue;
      const parsed=parseJsonText(choice.message.content);if(parsed)return parsed;
    }
  }
  for(const key of ['response','result']){
    const value=raw[key];
    if(typeof value==='string'){const parsed=parseJsonText(value);if(parsed)return parsed}
    if(isObject(value)&&Array.isArray(value.choices)){
      for(const choice of value.choices){
        if(!isObject(choice)||!isObject(choice.message)||typeof choice.message.content!=='string')continue;
        const parsed=parseJsonText(choice.message.content);if(parsed)return parsed;
      }
    }
  }
  return null;
}

async function runInference(ai:AiBinding,input:Record<string,unknown>):Promise<{raw:unknown;model:string}>{
  const failures:string[]=[];
  for(const model of [INTELLIGENCE_MODEL,INTELLIGENCE_FALLBACK_MODEL]){
    try{return {raw:await ai.run(model,input),model}}
    catch(error){failures.push(`${model}:${error instanceof Error?error.message:String(error)}`)}
  }
  throw new Error('STOCK_RESEARCH_AI_UNAVAILABLE:'+failures.join(' | ').slice(0,600));
}

function marketContext(payload:JsonRecord):JsonRecord{
  const market=isObject(payload.market)?payload.market:{};
  const providerResearch=isObject(payload.provider_research)?payload.provider_research:{};
  const observations=[
    ...(Array.isArray(market.observations)?market.observations:[]),
    ...(Array.isArray(providerResearch.observations)?providerResearch.observations:[]),
  ].filter(isObject).slice(0,24).map(row=>({
    category:row.category,
    evidence_type:row.evidence_type,
    detail:row.detail,
    source_ref:row.source_ref,
    captured_at:row.captured_at,
  }));
  const quotePayloads:JsonRecord[]=[];
  const payloads=isObject(market.payloads)?market.payloads:{};
  for(const [ref,value] of Object.entries(payloads)){
    if(!ref.includes('/v3/market-quote/quotes')||!isObject(value))continue;
    const text=JSON.stringify(value);
    try{quotePayloads.push(JSON.parse(text.slice(0,6000)))}catch{quotePayloads.push({source_ref:ref,summary:text.slice(0,5500)})}
    if(quotePayloads.length>=2)break;
  }
  return {observations,quote_payloads:quotePayloads};
}

function validateClaims(value:unknown,sourceIds:Set<string>):{claims:EdgeResearchClaim[];limitations:string[]}{
  if(!isObject(value)||!Array.isArray(value.claims))throw new Error('STOCK_RESEARCH_AI_INVALID_JSON');
  const claims=value.claims.filter(isObject) as JsonRecord[];
  if(claims.length!==MANDATORY_EDGE_RESEARCH_CATEGORIES.length)throw new Error('STOCK_RESEARCH_AI_CATEGORY_COUNT');
  const byCategory=new Map<string,JsonRecord>();
  for(const claim of claims){
    const category=String(claim.evidence_category||'');
    if(byCategory.has(category))throw new Error('STOCK_RESEARCH_AI_DUPLICATE_CATEGORY');
    byCategory.set(category,claim);
  }
  const out:EdgeResearchClaim[]=[];
  for(const category of MANDATORY_EDGE_RESEARCH_CATEGORIES){
    const raw=byCategory.get(category);
    if(!raw)throw new Error('STOCK_RESEARCH_AI_MISSING_'+category);
    const ids=Array.isArray(raw.source_ids)?raw.source_ids.map(x=>String(x)):[];
    if(!ids.length||ids.some(id=>!sourceIds.has(id)))throw new Error('STOCK_RESEARCH_AI_INVALID_SOURCE_REF');
    const direction=String(raw.direction);
    const materiality=String(raw.materiality);
    const verification=String(raw.verification_status);
    if(!['POSITIVE','NEUTRAL','NEGATIVE','BINARY_UNCERTAIN'].includes(direction))throw new Error('STOCK_RESEARCH_AI_INVALID_DIRECTION');
    if(!['LOW','MODERATE','HIGH','CRITICAL'].includes(materiality))throw new Error('STOCK_RESEARCH_AI_INVALID_MATERIALITY');
    if(!['VERIFIED','CONFLICTED','NOT_VERIFIED','NOT_AVAILABLE'].includes(verification))throw new Error('STOCK_RESEARCH_AI_INVALID_VERIFICATION');
    const statement=String(raw.statement||'').trim();
    if(!statement)throw new Error('STOCK_RESEARCH_AI_EMPTY_STATEMENT');
    out.push({
      claim_id:`auto-${category.toLowerCase().replaceAll('_','-')}`,
      evidence_category:category as EdgeResearchClaim['evidence_category'],
      statement,
      materiality:materiality as EdgeResearchClaim['materiality'],
      direction:direction as EdgeResearchClaim['direction'],
      source_ids:ids,
      verification_status:verification as EdgeResearchClaim['verification_status'],
      independent_validation:verification==='VERIFIED',
      conflict_note:verification==='CONFLICTED'?String(raw.conflict_note||'Source conflict identified by governed research reconciliation'):null,
    });
  }
  return {claims:out,limitations:Array.isArray(value.limitations)?value.limitations.map(x=>String(x).slice(0,500)):[]};
}

export async function produceStockSystemResearch(
  env:Env,
  input:{
    ticker:string;
    lifecycle_id:string;
    market_snapshot_id:string;
    data_captured_at:string;
    market_payload:JsonRecord;
  },
  fetcher:typeof fetch=fetch,
):Promise<{bundle:EdgeResearchBundle;model:string;source_failures:string[]}>{
  const ticker=input.ticker.trim().toUpperCase();
  const specs=[...(COMPANY_SOURCES[ticker]||[]),...genericSources(ticker)];
  const retrieved=await Promise.all(specs.map(spec=>fetchSource(spec,fetcher)));
  const usable=retrieved.filter(x=>x.ok&&x.source.excerpt);
  const failures=retrieved.filter(x=>!x.ok).map(x=>x.limitation||'source unavailable');
  const authorities=new Set(usable.map(x=>x.source.authority));
  if(usable.length<2||(!authorities.has('COMPANY')&&!authorities.has('EXCHANGE'))){
    throw new Error('STOCK_RESEARCH_SOURCES_INSUFFICIENT:'+failures.join(' | ').slice(0,500));
  }

  const sources=usable.map(x=>x.source);
  const sourcePacket=sources.map(source=>({
    source_id:source.source_id,
    authority:source.authority,
    url:source.url,
    title:source.title,
    retrieved_at:source.retrieved_at,
    excerpt:source.excerpt,
  }));
  const system='You are the governed independent web-research layer for EDGE Stocks. Return JSON only. Never invent facts, numbers, dates, sources or conclusions.';
  const prompt=`Ticker: ${ticker}
Immutable DATA snapshot: ${input.market_snapshot_id}
DATA captured_at: ${input.data_captured_at}
Market/provider context captured BEFORE this research:
${JSON.stringify(marketContext(input.market_payload))}

Fresh independent web sources:
${JSON.stringify(sourcePacket)}

Produce EXACTLY one claim for each category:
${MANDATORY_EDGE_RESEARCH_CATEGORIES.join(', ')}

Rules:
- Use only supplied source_ids and source text.
- A VERIFIED claim must be directly supported by the supplied source set.
- If evidence is insufficient, use NOT_VERIFIED or NOT_AVAILABLE; do not invent. The downstream gate will fail closed.
- "No severe event found" may only mean none was identified in the bounded fresh source set; say that explicitly.
- Institutional shareholding is historical ownership evidence unless a source explicitly proves current-session flow.
- Valuation is context, not a stand-alone trade recommendation.
- Do not output an EDGE recommendation, probability, DES, Market Trust, BOT score or price target.
- direction is POSITIVE, NEUTRAL, NEGATIVE or BINARY_UNCERTAIN.
- materiality is LOW, MODERATE, HIGH or CRITICAL.
- For VERIFIED claims set independent_validation true.
Return exactly:
{"claims":[{"evidence_category":"BUSINESS_FUNDAMENTALS","statement":"...","materiality":"HIGH","direction":"POSITIVE","source_ids":["..."],"verification_status":"VERIFIED","independent_validation":true},{"evidence_category":"INSTITUTIONAL_BEHAVIOUR","statement":"...","materiality":"MODERATE","direction":"NEUTRAL","source_ids":["..."],"verification_status":"VERIFIED","independent_validation":true},{"evidence_category":"NEWS_EVENTS_CATALYSTS","statement":"...","materiality":"MODERATE","direction":"NEUTRAL","source_ids":["..."],"verification_status":"VERIFIED","independent_validation":true},{"evidence_category":"VALUATION","statement":"...","materiality":"MODERATE","direction":"NEUTRAL","source_ids":["..."],"verification_status":"VERIFIED","independent_validation":true},{"evidence_category":"EVENT_SHOCK","statement":"...","materiality":"HIGH","direction":"NEUTRAL","source_ids":["..."],"verification_status":"VERIFIED","independent_validation":true}],"limitations":["..."]}`;

  const inference=await runInference(env.AI,{
    messages:[{role:'system',content:system},{role:'user',content:prompt}],
    max_tokens:1800,
    temperature:0,
    chat_template_kwargs:{enable_thinking:false},
  });
  const parsed=parseAi(inference.raw);
  const validated=validateClaims(parsed,new Set(sources.map(x=>x.source_id)));
  const now=new Date().toISOString();
  const basis=input.lifecycle_id+'|'+input.market_snapshot_id+'|'+sources.map(x=>x.content_sha256).join('|')+'|'+JSON.stringify(validated.claims);
  const idHash=(await digest(basis)).slice(0,16);
  const bundle:EdgeResearchBundle={
    contract_version:EDGE_RESEARCH_BUNDLE_VERSION,
    bundle_id:`ER2-${ticker}-${idHash}`,
    ticker,
    command:`EDGE ${ticker}`,
    created_at:now,
    research_fresh_at:now,
    research_authority:'EDGE_SYSTEM',
    lifecycle_id:input.lifecycle_id,
    market_snapshot_id:input.market_snapshot_id,
    retrieval_providers:['SYSTEM_WEB'],
    sources,
    claims:validated.claims,
    limitations:[
      `Research is bound to DATA snapshot ${input.market_snapshot_id} captured at ${input.data_captured_at}.`,
      ...failures,
      ...validated.limitations,
    ],
  };
  const errors=validateEdgeResearchBundle(bundle,new Date(now));
  if(errors.length)throw new Error('STOCK_RESEARCH_BUNDLE_INVALID:'+errors.join('; '));
  return {bundle,model:inference.model,source_failures:failures};
}
