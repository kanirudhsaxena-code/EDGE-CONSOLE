export type SystemResearchCategory='MARKET_TRUST'|'EVENT_SHOCK'|'EXECUTION_RISK';
export type ResearchSource={id:string;category:SystemResearchCategory;url:string;authority:'PRIMARY'|'OFFICIAL_MARKET';accept:string};
export type ResearchSnapshot={
  source_id:string;
  category:SystemResearchCategory;
  source_ref:string;
  authority:'PRIMARY'|'OFFICIAL_MARKET';
  retrieved_at:string;
  status:'RETRIEVED'|'UNAVAILABLE';
  http_status?:number;
  content_type?:string;
  sha256?:string;
  excerpt?:string;
  limitation?:string;
};

// Zero-cost, official-source registry. API endpoints remain preferred where available,
// while official human-readable pages provide a fail-closed fallback when NSE blocks
// datacentre/API traffic. A successful fetch means only "retrieved for interpretation";
// it never means the market state is neutral or verified.
export const SYSTEM_RESEARCH_SOURCES:readonly ResearchSource[]=[
  {id:'NSE_MARKET_STATUS',category:'MARKET_TRUST',url:'https://www.nseindia.com/api/marketStatus',authority:'OFFICIAL_MARKET',accept:'application/json,text/plain;q=0.8,*/*;q=0.5'},
  {id:'NSE_ALL_INDICES',category:'MARKET_TRUST',url:'https://www.nseindia.com/api/allIndices',authority:'OFFICIAL_MARKET',accept:'application/json,text/plain;q=0.8,*/*;q=0.5'},
  {id:'NSE_INDEX_PERFORMANCE_PAGE',category:'MARKET_TRUST',url:'https://www.nseindia.com/market-data/index-performances',authority:'OFFICIAL_MARKET',accept:'text/html,*/*;q=0.5'},
  {id:'NSE_LIVE_MARKET_PAGE',category:'MARKET_TRUST',url:'https://www.nseindia.com/market-data/live-t0-market',authority:'OFFICIAL_MARKET',accept:'text/html,*/*;q=0.5'},

  {id:'FED_MONETARY_POLICY',category:'EVENT_SHOCK',url:'https://www.federalreserve.gov/monetarypolicy.htm',authority:'PRIMARY',accept:'text/html,*/*;q=0.5'},
  {id:'FED_FOMC_CALENDAR',category:'EVENT_SHOCK',url:'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',authority:'PRIMARY',accept:'text/html,*/*;q=0.5'},
  {id:'RBI_HOME',category:'EVENT_SHOCK',url:'https://www.rbi.org.in/',authority:'PRIMARY',accept:'text/html,*/*;q=0.5'},
  {id:'RBI_CURRENT_RATES',category:'EVENT_SHOCK',url:'https://m.rbi.org.in/home.aspx',authority:'PRIMARY',accept:'text/html,*/*;q=0.5'},
  {id:'EIA_CRUDE_SPOT',category:'EVENT_SHOCK',url:'https://www.eia.gov/dnav/pet/PET_PRI_SPT_S1_D.htm',authority:'PRIMARY',accept:'text/html,*/*;q=0.5'},

  {id:'NSE_NIFTY_OPTION_CHAIN',category:'EXECUTION_RISK',url:'https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY',authority:'OFFICIAL_MARKET',accept:'application/json,text/plain;q=0.8,*/*;q=0.5'},
  {id:'NSE_OPTION_CHAIN_PAGE',category:'EXECUTION_RISK',url:'https://www.nseindia.com/option-chain',authority:'OFFICIAL_MARKET',accept:'text/html,*/*;q=0.5'},
  {id:'NSE_DERIVATIVES_SNAPSHOT_PAGE',category:'EXECUTION_RISK',url:'https://www.nseindia.com/market-data/analysis-and-tools-derivatives-market-snapshot',authority:'OFFICIAL_MARKET',accept:'text/html,*/*;q=0.5'},
  {id:'NSE_DERIVATIVES_WATCH_PAGE',category:'EXECUTION_RISK',url:'https://www.nseindia.com/market-data/equity-derivatives-watch',authority:'OFFICIAL_MARKET',accept:'text/html,*/*;q=0.5'}
] as const;

const MAX_SOURCE_BYTES=512*1024;
const MAX_EXCERPT_CHARS=12000;
const FETCH_TIMEOUT_MS=12000;

const hex=(buffer:ArrayBuffer)=>[...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');
const digest=async(text:string)=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
const cleanExcerpt=(text:string)=>text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim().slice(0,MAX_EXCERPT_CHARS);

async function boundedText(response:Response):Promise<string>{
  const declared=Number(response.headers.get('content-length')||'0');
  if(Number.isFinite(declared)&&declared>MAX_SOURCE_BYTES)throw new Error('SOURCE_TOO_LARGE');
  const reader=response.body?.getReader();
  if(!reader)return '';
  const chunks:Uint8Array[]=[];let total=0;
  while(true){
    const {done,value}=await reader.read();if(done)break;
    if(value){total+=value.byteLength;if(total>MAX_SOURCE_BYTES){reader.cancel().catch(()=>{});throw new Error('SOURCE_TOO_LARGE')}chunks.push(value)}
  }
  const merged=new Uint8Array(total);let offset=0;for(const chunk of chunks){merged.set(chunk,offset);offset+=chunk.byteLength}
  return new TextDecoder().decode(merged);
}

async function fetchWithTimeout(fetcher:typeof fetch,url:string,init:RequestInit):Promise<Response>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),FETCH_TIMEOUT_MS);
  try{return await fetcher(url,{...init,signal:controller.signal})}finally{clearTimeout(timer)}
}

export async function acquireResearchSource(source:ResearchSource,fetcher:typeof fetch=fetch):Promise<ResearchSnapshot>{
  const retrieved_at=new Date().toISOString();
  try{
    const response=await fetchWithTimeout(fetcher,source.url,{method:'GET',headers:{
      'accept':source.accept,
      'accept-language':'en-US,en;q=0.9',
      'cache-control':'no-cache',
      'user-agent':'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36 EDGE-CONSOLE-5DR/0.3',
      'referer':source.url.includes('nseindia.com')?'https://www.nseindia.com/':'https://www.google.com/'
    },redirect:'follow'});
    const content_type=response.headers.get('content-type')||undefined;
    if(!response.ok)return {source_id:source.id,category:source.category,source_ref:source.url,authority:source.authority,retrieved_at,status:'UNAVAILABLE',http_status:response.status,content_type,limitation:`SOURCE_HTTP_${response.status}`};
    const body=await boundedText(response);
    if(!body.trim())return {source_id:source.id,category:source.category,source_ref:source.url,authority:source.authority,retrieved_at,status:'UNAVAILABLE',http_status:response.status,content_type,limitation:'SOURCE_EMPTY'};
    const excerpt=cleanExcerpt(body);
    if(!excerpt)return {source_id:source.id,category:source.category,source_ref:source.url,authority:source.authority,retrieved_at,status:'UNAVAILABLE',http_status:response.status,content_type,limitation:'SOURCE_EMPTY_AFTER_CLEANING'};
    return {source_id:source.id,category:source.category,source_ref:source.url,authority:source.authority,retrieved_at,status:'RETRIEVED',http_status:response.status,content_type,sha256:await digest(body),excerpt};
  }catch(error){
    const message=error instanceof Error?error.message:'';
    const reason=message==='SOURCE_TOO_LARGE'?'SOURCE_TOO_LARGE':message.toLowerCase().includes('abort')?'SOURCE_TIMEOUT':'SOURCE_FETCH_FAILED';
    return {source_id:source.id,category:source.category,source_ref:source.url,authority:source.authority,retrieved_at,status:'UNAVAILABLE',limitation:reason};
  }
}

export async function acquireSystemResearch(fetcher:typeof fetch=fetch):Promise<{snapshots:ResearchSnapshot[];by_category:Record<SystemResearchCategory,{retrieved:number;unavailable:number;ready_for_interpretation:boolean}>}>{
  const snapshots=await Promise.all(SYSTEM_RESEARCH_SOURCES.map(source=>acquireResearchSource(source,fetcher)));
  const categories:SystemResearchCategory[]=['MARKET_TRUST','EVENT_SHOCK','EXECUTION_RISK'];
  const by_category={} as Record<SystemResearchCategory,{retrieved:number;unavailable:number;ready_for_interpretation:boolean}>;
  for(const category of categories){
    const group=snapshots.filter(item=>item.category===category);const retrieved=group.filter(item=>item.status==='RETRIEVED').length;
    by_category[category]={retrieved,unavailable:group.length-retrieved,ready_for_interpretation:retrieved>0};
  }
  return {snapshots,by_category};
}
