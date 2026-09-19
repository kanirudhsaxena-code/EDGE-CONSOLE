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
  facts?:Record<string,unknown>;
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
  {id:'RBI_CURRENT_RATES',category:'EVENT_SHOCK',url:'https://m.rbi.org.in/Scripts/NotificationUser.aspx?Id=10001&Mode=0',authority:'PRIMARY',accept:'text/html,*/*;q=0.5'},
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

const nums=(value:string)=>[...value.matchAll(/-?\d+(?:\.\d+)?/g)].map(m=>Number(m[0])).filter(Number.isFinite);
function extractFacts(source:ResearchSource,body:string,excerpt:string):Record<string,unknown>|undefined{
  try{
    if(source.id==='NSE_ALL_INDICES'){
      const parsed=JSON.parse(body),rows=Array.isArray(parsed?.data)?parsed.data:[];
      const pick=(name:string)=>rows.find((x:any)=>x&&x.index===name);
      const slim=(x:any)=>x?{last:x.last,percent_change:x.percentChange,open:x.open,high:x.high,low:x.low,previous_close:x.previousClose,advances:Number(x.advances),declines:Number(x.declines),unchanged:Number(x.unchanged),change_30d:x.perChange30d,change_365d:x.perChange365d}:undefined;
      const n=pick('NIFTY 50');
      if(n)return {
        nifty50:{...slim(n),one_week_ago:n.oneWeekAgoVal,one_month_ago:n.oneMonthAgoVal,one_year_ago:n.oneYearAgoVal},
        india_vix:slim(pick('INDIA VIX')),
        nifty_bank:slim(pick('NIFTY BANK')),
        nifty_financial_services:slim(pick('NIFTY FINANCIAL SERVICES')),
        nifty_it:slim(pick('NIFTY IT')),
        nifty_auto:slim(pick('NIFTY AUTO')),
        nifty_midcap_100:slim(pick('NIFTY MIDCAP 100')),
        nifty_smallcap_100:slim(pick('NIFTY SMALLCAP 100'))
      };
    }
    if(source.id==='NSE_MARKET_STATUS'){
      const parsed=JSON.parse(body),rows=Array.isArray(parsed?.marketState)?parsed.marketState:[];
      const cash=rows.find((x:any)=>x&&x.market==='Capital Market');
      const fx=rows.find((x:any)=>x&&String(x.underlying||'').toUpperCase()==='USDINR');
      const gift=parsed?.giftnifty;
      const facts:Record<string,unknown>={};
      if(cash)facts.capital_market={status:cash.marketStatus,trade_date:cash.tradeDate,index:cash.index,last:cash.last,variation:cash.variation,percent_change:cash.percentChange,message:cash.marketStatusMessage};
      if(fx)facts.usdinr_futures={last:Number(fx.last),expiry:fx.expiryDate,updated_time:fx.updated_time,status:fx.marketStatus};
      if(gift)facts.gift_nifty={last:Number(gift.LASTPRICE),percent_change:Number(gift.PERCHANGE),day_change:Number(gift.DAYCHANGE),expiry:gift.EXPIRYDATE,timestamp:gift.TIMESTMP};
      return Object.keys(facts).length?facts:undefined;
    }
    if(source.id==='EIA_CRUDE_SPOT'){
      const wti=excerpt.match(/WTI\s*-\s*Cushing, Oklahoma\s+([\d.\s]+?)(?=\s+\d{4}-\d{4})/i);
      const brent=excerpt.match(/Brent\s*-\s*Europe\s+([\d.\s]+?)(?=\s+\d{4}-\d{4})/i);
      const wf=wti?nums(wti[1]).slice(0,10):[],bf=brent?nums(brent[1]).slice(0,10):[];
      const facts:Record<string,unknown>={};
      if(wf.length)facts.wti_usd_per_barrel={latest:wf.at(-1),recent:wf,change_from_first:Math.round(((wf.at(-1)!-wf[0])*100))/100};
      if(bf.length)facts.brent_usd_per_barrel={latest:bf.at(-1),recent:bf,change_from_first:Math.round(((bf.at(-1)!-bf[0])*100))/100};
      const release=excerpt.match(/Release Date:\s*([0-9/]+)/i),next=excerpt.match(/Next Release Date:\s*([0-9/]+)/i);
      if(release)facts.release_date=release[1];
      if(next)facts.next_release_date=next[1];
      return Object.keys(facts).length?facts:undefined;
    }
    if(source.id==='FED_MONETARY_POLICY'){
      const facts:Record<string,unknown>={};
      const release=excerpt.match(/FOMC Statement:[\s\S]{0,120}?Released\s+([A-Za-z]+\s+\d{1,2},\s+20\d{2})/i);
      const press=excerpt.match(/Press Conference\s+([A-Za-z]+\s+\d{1,2},\s+20\d{2})/i);
      const nextMeeting=excerpt.match(/Upcoming Dates[\s\S]{0,500}?([A-Z][a-z]{2}\.?\s+\d{1,2}-\d{1,2})\s+FOMC Meeting/i);
      const nextMinutes=excerpt.match(/Upcoming Dates[\s\S]{0,300}?([A-Z][a-z]{2}\.?\s+\d{1,2})\s+FOMC Minutes/i);
      if(release)facts.latest_fomc_statement_release=release[1];
      if(press)facts.latest_press_conference=press[1];
      if(nextMeeting)facts.next_fomc_meeting=nextMeeting[1];
      if(nextMinutes)facts.next_fomc_minutes=nextMinutes[1];
      return Object.keys(facts).length?facts:undefined;
    }
    if(source.id==='FED_FOMC_CALENDAR'){
      const facts:Record<string,unknown>={};
      const section=excerpt.match(/2026 FOMC Meetings([\s\S]*?)2025 FOMC Meetings/i)?.[1]||excerpt;
      const meetings=[...section.matchAll(/(?:January|March|April|May|June|July|September|October|December)\s+\d{1,2}(?:-\d{1,2})?\*?/g)].map(m=>m[0].replace('*',''));
      if(meetings.length)facts.meeting_dates_2026=meetings;
      return Object.keys(facts).length?facts:undefined;
    }
    if(source.id==='RBI_CURRENT_RATES'){
      const repo=excerpt.match(/Policy\s*Repo Rate\s*:?\s*(\d+(?:\.\d+)?)\s*%/i);
      const sdf=excerpt.match(/Standing Deposit Facility Rate\s*:?\s*(\d+(?:\.\d+)?)\s*%/i);
      const msf=excerpt.match(/Marginal Standing Facility Rate\s*:?\s*(\d+(?:\.\d+)?)\s*%/i);
      const usdinr=excerpt.match(/INR\s*\/\s*1 USD\s*:?\s*(\d+(?:\.\d+)?)/i);
      const dated=excerpt.match(/As at\s+[^A-Za-z0-9]*([A-Za-z]+\s+\d{1,2},\s*20\d{2})/i);
      const facts:Record<string,unknown>={};
      if(repo)facts.policy_repo_rate_pct=Number(repo[1]);
      if(sdf)facts.standing_deposit_facility_pct=Number(sdf[1]);
      if(msf)facts.marginal_standing_facility_pct=Number(msf[1]);
      if(usdinr)facts.usdinr_reference=Number(usdinr[1]);
      if(dated)facts.rates_as_of=dated[1];
      return Object.keys(facts).length?facts:undefined;
    }
    if(source.id==='FED_LATEST_FOMC_STATEMENT'){
      const facts:Record<string,unknown>={};
      const action=excerpt.match(/Committee decided to\s+(raise|lower|maintain|keep)[^.]{0,220}/i);
      const range=excerpt.match(/target range for the federal funds rate[^.]{0,100}?to\s+([^.;]+?)\s+percent/i);
      const inflation=excerpt.match(/Inflation[^.]{0,140}\./i);
      const activity=excerpt.match(/Economic activity[^.]{0,160}\./i);
      const geopolitical=excerpt.match(/uncertainty[^.]{0,180}geopolitical[^.]{0,180}\./i);
      const vote=excerpt.match(/(?:approved|voted)[^.]{0,100}?(\d+)\s*[–-]\s*(\d+)/i);
      if(action)facts.policy_action=action[1].toLowerCase();
      if(range)facts.target_range_text=range[1].trim();
      if(inflation)facts.inflation_assessment=inflation[0].trim();
      if(activity)facts.activity_assessment=activity[0].trim();
      if(geopolitical)facts.geopolitical_assessment=geopolitical[0].trim();
      if(vote)facts.vote={for:Number(vote[1]),against:Number(vote[2])};
      return Object.keys(facts).length?facts:undefined;
    }
  }catch{}
  return undefined;
}

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
    const facts=extractFacts(source,body,excerpt);
    return {source_id:source.id,category:source.category,source_ref:source.url,authority:source.authority,retrieved_at,status:'RETRIEVED',http_status:response.status,content_type,sha256:await digest(body),excerpt,facts};
  }catch(error){
    const message=error instanceof Error?error.message:'';
    const reason=message==='SOURCE_TOO_LARGE'?'SOURCE_TOO_LARGE':message.toLowerCase().includes('abort')?'SOURCE_TIMEOUT':'SOURCE_FETCH_FAILED';
    return {source_id:source.id,category:source.category,source_ref:source.url,authority:source.authority,retrieved_at,status:'UNAVAILABLE',limitation:reason};
  }
}

export async function acquireSystemResearch(fetcher:typeof fetch=fetch):Promise<{snapshots:ResearchSnapshot[];by_category:Record<SystemResearchCategory,{retrieved:number;unavailable:number;ready_for_interpretation:boolean}>}>{
  const snapshots=await Promise.all(SYSTEM_RESEARCH_SOURCES.map(source=>acquireResearchSource(source,fetcher)));
  const fedLanding=snapshots.find(s=>s.source_id==='FED_MONETARY_POLICY'&&s.status==='RETRIEVED');
  const release=fedLanding?.excerpt?.match(/FOMC Statement:[\s\S]{0,160}?Released\s+([A-Za-z]+)\s+(\d{1,2}),\s+(20\d{2})/i);
  if(release){
    const monthMap:Record<string,string>={January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',July:'07',August:'08',September:'09',October:'10',November:'11',December:'12'};
    const mm=monthMap[release[1]],dd=release[2].padStart(2,'0'),yyyy=release[3];
    if(mm){
      const latest:ResearchSource={id:'FED_LATEST_FOMC_STATEMENT',category:'EVENT_SHOCK',url:`https://www.federalreserve.gov/newsevents/pressreleases/monetary${yyyy}${mm}${dd}a.htm`,authority:'PRIMARY',accept:'text/html,*/*;q=0.5'};
      snapshots.push(await acquireResearchSource(latest,fetcher));
    }
  }
  const categories:SystemResearchCategory[]=['MARKET_TRUST','EVENT_SHOCK','EXECUTION_RISK'];
  const by_category={} as Record<SystemResearchCategory,{retrieved:number;unavailable:number;ready_for_interpretation:boolean}>;
  for(const category of categories){
    const group=snapshots.filter(item=>item.category===category);const retrieved=group.filter(item=>item.status==='RETRIEVED').length;
    by_category[category]={retrieved,unavailable:group.length-retrieved,ready_for_interpretation:retrieved>0};
  }
  return {snapshots,by_category};
}
