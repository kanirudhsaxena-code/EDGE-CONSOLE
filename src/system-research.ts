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

export const SYSTEM_RESEARCH_SOURCES:readonly ResearchSource[]=[
  {id:'NSE_MARKET_STATUS',category:'MARKET_TRUST',url:'https://www.nseindia.com/api/marketStatus',authority:'OFFICIAL_MARKET',accept:'application/json,text/plain;q=0.8,*/*;q=0.5'},
  {id:'NSE_ALL_INDICES',category:'MARKET_TRUST',url:'https://www.nseindia.com/api/allIndices',authority:'OFFICIAL_MARKET',accept:'application/json,text/plain;q=0.8,*/*;q=0.5'},
  {id:'FED_MONETARY_POLICY',category:'EVENT_SHOCK',url:'https://www.federalreserve.gov/monetarypolicy.htm',authority:'PRIMARY',accept:'text/html,*/*;q=0.5'},
  {id:'FED_FOMC_CALENDAR',category:'EVENT_SHOCK',url:'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',authority:'PRIMARY',accept:'text/html,*/*;q=0.5'},
  {id:'RBI_HOME',category:'EVENT_SHOCK',url:'https://www.rbi.org.in/',authority:'PRIMARY',accept:'text/html,*/*;q=0.5'},
  {id:'NSE_NIFTY_OPTION_CHAIN',category:'EXECUTION_RISK',url:'https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY',authority:'OFFICIAL_MARKET',accept:'application/json,text/plain;q=0.8,*/*;q=0.5'}
] as const;

const MAX_SOURCE_BYTES=512*1024;
const MAX_EXCERPT_CHARS=12000;

const hex=(buffer:ArrayBuffer)=>[...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');
const digest=async(text:string)=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
const cleanExcerpt=(text:string)=>text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/\s+/g,' ').trim().slice(0,MAX_EXCERPT_CHARS);

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

export async function acquireResearchSource(source:ResearchSource,fetcher:typeof fetch=fetch):Promise<ResearchSnapshot>{
  const retrieved_at=new Date().toISOString();
  try{
    const response=await fetcher(source.url,{method:'GET',headers:{'accept':source.accept,'user-agent':'Mozilla/5.0 EDGE-CONSOLE-5DR/0.2','referer':'https://www.nseindia.com/'},redirect:'follow'});
    const content_type=response.headers.get('content-type')||undefined;
    if(!response.ok)return {source_id:source.id,category:source.category,source_ref:source.url,authority:source.authority,retrieved_at,status:'UNAVAILABLE',http_status:response.status,content_type,limitation:`SOURCE_HTTP_${response.status}`};
    const body=await boundedText(response);
    if(!body.trim())return {source_id:source.id,category:source.category,source_ref:source.url,authority:source.authority,retrieved_at,status:'UNAVAILABLE',http_status:response.status,content_type,limitation:'SOURCE_EMPTY'};
    return {source_id:source.id,category:source.category,source_ref:source.url,authority:source.authority,retrieved_at,status:'RETRIEVED',http_status:response.status,content_type,sha256:await digest(body),excerpt:cleanExcerpt(body)};
  }catch(error){
    const reason=error instanceof Error&&error.message==='SOURCE_TOO_LARGE'?'SOURCE_TOO_LARGE':'SOURCE_FETCH_FAILED';
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
