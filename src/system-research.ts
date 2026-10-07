export type SystemResearchCategory='MARKET_TRUST'|'EVENT_SHOCK'|'EXECUTION_RISK';
export const REQUIRED_NIFTY_RESEARCH_DIMENSIONS=[
  'GLOBAL_MARKET_REGIME',
  'MACRO_RATES_FX',
  'COMMODITIES_CROSS_ASSET',
  'INSTITUTIONAL_FLOWS',
  'BREADTH_SECTOR_LEADERSHIP',
  'DERIVATIVES_VOLATILITY',
  'NEWS_CATALYSTS',
  'EVENT_SHOCK'
] as const;
export type NiftyResearchDimension=typeof REQUIRED_NIFTY_RESEARCH_DIMENSIONS[number];
export type ResearchSource={id:string;category:SystemResearchCategory;dimensions:readonly NiftyResearchDimension[];url:string;authority:'PRIMARY'|'OFFICIAL_MARKET';accept:string};
export type ResearchSnapshot={
  source_id:string;
  category:SystemResearchCategory;
  dimensions:readonly NiftyResearchDimension[];
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
  {id:'NSE_MARKET_STATUS',category:'MARKET_TRUST',dimensions:['GLOBAL_MARKET_REGIME','MACRO_RATES_FX','NEWS_CATALYSTS'],url:'https://www.nseindia.com/api/marketStatus',authority:'OFFICIAL_MARKET',accept:'application/json,text/plain;q=0.8,*/*;q=0.5'},
  {id:'NSE_ALL_INDICES',category:'MARKET_TRUST',dimensions:['GLOBAL_MARKET_REGIME','BREADTH_SECTOR_LEADERSHIP','DERIVATIVES_VOLATILITY'],url:'https://www.nseindia.com/api/allIndices',authority:'OFFICIAL_MARKET',accept:'application/json,text/plain;q=0.8,*/*;q=0.5'},
  {id:'NSE_INDEX_PERFORMANCE_PAGE',category:'MARKET_TRUST',dimensions:['GLOBAL_MARKET_REGIME','BREADTH_SECTOR_LEADERSHIP'],url:'https://www.nseindia.com/market-data/index-performances',authority:'OFFICIAL_MARKET',accept:'text/html,*/*;q=0.5'},
  {id:'NSE_LIVE_MARKET_PAGE',category:'MARKET_TRUST',dimensions:['GLOBAL_MARKET_REGIME','BREADTH_SECTOR_LEADERSHIP'],url:'https://www.nseindia.com/market-data/live-t0-market',authority:'OFFICIAL_MARKET',accept:'text/html,*/*;q=0.5'},
  {id:'NSE_FII_DII_API',category:'MARKET_TRUST',dimensions:['INSTITUTIONAL_FLOWS'],url:'https://www.nseindia.com/api/fiidiiTradeReact',authority:'OFFICIAL_MARKET',accept:'application/json,text/plain;q=0.8,*/*;q=0.5'},
  {id:'NSE_FII_DII_ACTIVITY',category:'MARKET_TRUST',dimensions:['INSTITUTIONAL_FLOWS'],url:'https://www.nseindia.com/reports/fii-dii',authority:'OFFICIAL_MARKET',accept:'text/html,*/*;q=0.5'},

  {id:'FED_MONETARY_POLICY',category:'EVENT_SHOCK',dimensions:['MACRO_RATES_FX','NEWS_CATALYSTS','EVENT_SHOCK'],url:'https://www.federalreserve.gov/monetarypolicy.htm',authority:'PRIMARY',accept:'text/html,*/*;q=0.5'},
  {id:'FED_FOMC_CALENDAR',category:'EVENT_SHOCK',dimensions:['MACRO_RATES_FX','NEWS_CATALYSTS','EVENT_SHOCK'],url:'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',authority:'PRIMARY',accept:'text/html,*/*;q=0.5'},
  {id:'RBI_HOME',category:'EVENT_SHOCK',dimensions:['MACRO_RATES_FX','NEWS_CATALYSTS','EVENT_SHOCK'],url:'https://www.rbi.org.in/',authority:'PRIMARY',accept:'text/html,*/*;q=0.5'},
  {id:'RBI_CURRENT_RATES',category:'EVENT_SHOCK',dimensions:['MACRO_RATES_FX','NEWS_CATALYSTS','EVENT_SHOCK'],url:'https://m.rbi.org.in/',authority:'PRIMARY',accept:'text/html,*/*;q=0.5'},
  {id:'EIA_CRUDE_SPOT',category:'EVENT_SHOCK',dimensions:['COMMODITIES_CROSS_ASSET','EVENT_SHOCK'],url:'https://www.eia.gov/dnav/pet/PET_PRI_SPT_S1_D.htm',authority:'PRIMARY',accept:'text/html,*/*;q=0.5'},

  {id:'NSE_NIFTY_OPTION_CHAIN',category:'EXECUTION_RISK',dimensions:['DERIVATIVES_VOLATILITY'],url:'https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY',authority:'OFFICIAL_MARKET',accept:'application/json,text/plain;q=0.8,*/*;q=0.5'},
  {id:'NSE_OPTION_CHAIN_PAGE',category:'EXECUTION_RISK',dimensions:['DERIVATIVES_VOLATILITY'],url:'https://www.nseindia.com/option-chain',authority:'OFFICIAL_MARKET',accept:'text/html,*/*;q=0.5'},
  {id:'NSE_DERIVATIVES_SNAPSHOT_PAGE',category:'EXECUTION_RISK',dimensions:['DERIVATIVES_VOLATILITY'],url:'https://www.nseindia.com/market-data/analysis-and-tools-derivatives-market-snapshot',authority:'OFFICIAL_MARKET',accept:'text/html,*/*;q=0.5'},
  {id:'NSE_DERIVATIVES_WATCH_PAGE',category:'EXECUTION_RISK',dimensions:['DERIVATIVES_VOLATILITY'],url:'https://www.nseindia.com/market-data/equity-derivatives-watch',authority:'OFFICIAL_MARKET',accept:'text/html,*/*;q=0.5'}
] as const;

const MAX_SOURCE_BYTES=512*1024;
const MAX_EXCERPT_CHARS=12000;
const FETCH_TIMEOUT_MS=12000;

const hex=(buffer:ArrayBuffer)=>[...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');
const digest=async(text:string)=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
const cleanExcerpt=(text:string)=>text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim().slice(0,MAX_EXCERPT_CHARS);

const nums=(value:string)=>[...value.matchAll(/-?\d+(?:\.\d+)?/g)].map(m=>Number(m[0])).filter(Number.isFinite);

function rbiPolicyDocumentLinks(body:string):Array<{url:string;label:string;priority:number}>{
  const out:Array<{url:string;label:string;priority:number}>=[];
  for(const match of body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const href=String(match[1]||'').trim();
    const label=cleanExcerpt(String(match[2]||''));
    if(!href||!label)continue;
    if(!/(Resolution of the Monetary Policy Committee|Monetary Policy Statement|Governor.?s Statement)/i.test(label))continue;
    let url:string;
    try{url=new URL(href,'https://www.rbi.org.in/').toString()}catch{continue}
    const priority=/Resolution of the Monetary Policy Committee/i.test(label)?0:/Monetary Policy Statement/i.test(label)?1:2;
    out.push({url,label,priority});
  }
  const seen=new Set<string>();
  return out.sort((a,b)=>a.priority-b.priority).filter(item=>seen.has(item.url)?false:(seen.add(item.url),true)).slice(0,5);
}
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
    if(source.id==='NSE_FII_DII_API'){
      const parsed=JSON.parse(body);
      const rows=Array.isArray(parsed)?parsed:Array.isArray(parsed?.data)?parsed.data:[];
      const parse=(v:unknown)=>Number(String(v??'').replace(/,/g,'').trim());
      const facts:Record<string,unknown>={};
      for(const row of rows){
        if(!row||typeof row!=='object')continue;
        const category=String((row as any).category??'').trim().toUpperCase();
        const key=category==='DII'?'dii':category==='FII/FPI'||category==='FII'?'fii_fpi':null;
        if(!key||facts[key])continue;
        const buy=parse((row as any).buyValue??(row as any).buyvalue??(row as any).buy);
        const sell=parse((row as any).sellValue??(row as any).sellvalue??(row as any).sell);
        const net=parse((row as any).netValue??(row as any).netvalue??(row as any).net);
        const date=String((row as any).date??'').trim();
        if(date&&[buy,sell,net].every(Number.isFinite))facts[key]={date,buy_crore:buy,sell_crore:sell,net_crore:net};
      }
      return facts.dii&&facts.fii_fpi?facts:undefined;
    }
    if(source.id==='NSE_FII_DII_ACTIVITY'){
      const rows=[...excerpt.matchAll(/\b(DII|FII\/FPI)\s+(\d{1,2}-[A-Za-z]{3}-20\d{2})\s+([\d,.]+)\s+([\d,.]+)\s+(-?[\d,.]+)/g)];
      const parse=(v:string)=>Number(v.replace(/,/g,''));
      const facts:Record<string,unknown>={};
      for(const row of rows){
        const key=row[1]==='DII'?'dii':'fii_fpi';
        if(facts[key])continue;
        const buy=parse(row[3]),sell=parse(row[4]),net=parse(row[5]);
        if([buy,sell,net].every(Number.isFinite))facts[key]={date:row[2],buy_crore:buy,sell_crore:sell,net_crore:net};
      }
      return facts.dii&&facts.fii_fpi?facts:undefined;
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
    if(source.id==='RBI_HOME'||source.id==='RBI_CURRENT_RATES'){
      const repo=excerpt.match(/Policy\s*Repo Rate\s*\|?\s*:?\s*(\d+(?:\.\d+)?)\s*%/i);
      const sdf=excerpt.match(/Standing Deposit Facility Rate\s*\|?\s*:?\s*(\d+(?:\.\d+)?)\s*%/i);
      const msf=excerpt.match(/Marginal Standing Facility Rate\s*\|?\s*:?\s*(\d+(?:\.\d+)?)\s*%/i);
      const usdinr=excerpt.match(/INR\s*\/\s*1 USD\s*\|?\s*:?\s*(\d+(?:\.\d+)?)/i);
      const dated=excerpt.match(/As at\s+(?:\d{1,2}(?:\.\d+)?\s*(?:am|pm)\s+of\s+)?([A-Za-z]+\s+\d{1,2},\s*20\d{2})/i);
      const facts:Record<string,unknown>={};
      if(repo)facts.policy_repo_rate_pct=Number(repo[1]);
      if(sdf)facts.standing_deposit_facility_pct=Number(sdf[1]);
      if(msf)facts.marginal_standing_facility_pct=Number(msf[1]);
      if(usdinr)facts.usdinr_reference=Number(usdinr[1]);
      if(dated)facts.rates_as_of=dated[1];
      if(source.id==='RBI_HOME'){
        const links=rbiPolicyDocumentLinks(body);
        if(links.length){
          facts.policy_document_links=links;
          facts.latest_policy_document_url=links[0].url;
          facts.latest_policy_document_label=links[0].label;
        }
      }
      return Object.keys(facts).length?facts:undefined;
    }
    if(source.id==='RBI_LATEST_POLICY_DECISION'){
      const facts:Record<string,unknown>={};
      const action=excerpt.match(/(?:MPC|Committee)[\s\S]{0,500}?decided to\s+(increase|raise|reduce|lower|keep|maintain)[\s\S]{0,260}?policy repo rate[\s\S]{0,180}?(?:by\s+(\d+(?:\.\d+)?)\s+basis points?\s+)?(?:to|at|unchanged at)\s+(\d+(?:\.\d+)?)\s*(?:per cent|%)/i);
      const directRate=excerpt.match(/policy repo rate[\s\S]{0,120}?(?:to|at|unchanged at)\s+(\d+(?:\.\d+)?)\s*(?:per cent|%)/i);
      const stance=excerpt.match(/(?:stance|remain|shift(?:ed)?\s+to)[\s\S]{0,120}?(calibrated tightening|neutral|withdrawal of accommodation|accommodative)/i);
      const date=excerpt.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}/i);
      if(action){
        facts.policy_action=String(action[1]).toLowerCase();
        if(action[2])facts.policy_change_bps=Number(action[2]);
        facts.policy_repo_rate_pct=Number(action[3]);
      }else if(directRate){
        facts.policy_repo_rate_pct=Number(directRate[1]);
      }
      if(stance)facts.policy_stance=String(stance[1]);
      if(date)facts.policy_decision_date=date[0];
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
    if(!response.ok)return {source_id:source.id,category:source.category,dimensions:source.dimensions,source_ref:source.url,authority:source.authority,retrieved_at,status:'UNAVAILABLE',http_status:response.status,content_type,limitation:`SOURCE_HTTP_${response.status}`};
    const body=await boundedText(response);
    if(!body.trim())return {source_id:source.id,category:source.category,dimensions:source.dimensions,source_ref:source.url,authority:source.authority,retrieved_at,status:'UNAVAILABLE',http_status:response.status,content_type,limitation:'SOURCE_EMPTY'};
    const excerpt=cleanExcerpt(body);
    if(!excerpt)return {source_id:source.id,category:source.category,dimensions:source.dimensions,source_ref:source.url,authority:source.authority,retrieved_at,status:'UNAVAILABLE',http_status:response.status,content_type,limitation:'SOURCE_EMPTY_AFTER_CLEANING'};
    const facts=extractFacts(source,body,excerpt);
    return {source_id:source.id,category:source.category,dimensions:source.dimensions,source_ref:source.url,authority:source.authority,retrieved_at,status:'RETRIEVED',http_status:response.status,content_type,sha256:await digest(body),excerpt,facts};
  }catch(error){
    const message=error instanceof Error?error.message:'';
    const reason=message==='SOURCE_TOO_LARGE'?'SOURCE_TOO_LARGE':message.toLowerCase().includes('abort')?'SOURCE_TIMEOUT':'SOURCE_FETCH_FAILED';
    return {source_id:source.id,category:source.category,dimensions:source.dimensions,source_ref:source.url,authority:source.authority,retrieved_at,status:'UNAVAILABLE',limitation:reason};
  }
}

export async function acquireSystemResearch(fetcher:typeof fetch=fetch):Promise<{
  snapshots:ResearchSnapshot[];
  by_category:Record<SystemResearchCategory,{retrieved:number;unavailable:number;ready_for_interpretation:boolean}>;
  by_dimension:Record<NiftyResearchDimension,{retrieved:number;ready_for_interpretation:boolean;source_ids:string[]}>;
  research_manifest_complete:boolean;
  missing_dimensions:NiftyResearchDimension[];
  fact_blockers:string[];
}>{
  const snapshots=await Promise.all(SYSTEM_RESEARCH_SOURCES.map(source=>acquireResearchSource(source,fetcher)));
  const fedLanding=snapshots.find(s=>s.source_id==='FED_MONETARY_POLICY'&&s.status==='RETRIEVED');
  const release=fedLanding?.excerpt?.match(/FOMC Statement:[\s\S]{0,160}?Released\s+([A-Za-z]+)\s+(\d{1,2}),\s+(20\d{2})/i);
  if(release){
    const monthMap:Record<string,string>={January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',July:'07',August:'08',September:'09',October:'10',November:'11',December:'12'};
    const mm=monthMap[release[1]],dd=release[2].padStart(2,'0'),yyyy=release[3];
    if(mm){
      const latest:ResearchSource={id:'FED_LATEST_FOMC_STATEMENT',category:'EVENT_SHOCK',dimensions:['MACRO_RATES_FX','NEWS_CATALYSTS','EVENT_SHOCK'],url:`https://www.federalreserve.gov/newsevents/pressreleases/monetary${yyyy}${mm}${dd}a.htm`,authority:'PRIMARY',accept:'text/html,*/*;q=0.5'};
      snapshots.push(await acquireResearchSource(latest,fetcher));
    }
  }
  const rbiHome=snapshots.find(s=>s.source_id==='RBI_HOME'&&s.status==='RETRIEVED');
  const rbiPolicyUrl=typeof rbiHome?.facts?.latest_policy_document_url==='string'?rbiHome.facts.latest_policy_document_url:'';
  if(rbiPolicyUrl){
    const latestRbi:ResearchSource={id:'RBI_LATEST_POLICY_DECISION',category:'EVENT_SHOCK',dimensions:['MACRO_RATES_FX','NEWS_CATALYSTS','EVENT_SHOCK'],url:rbiPolicyUrl,authority:'PRIMARY',accept:'text/html,*/*;q=0.5'};
    snapshots.push(await acquireResearchSource(latestRbi,fetcher));
  }
  const categories:SystemResearchCategory[]=['MARKET_TRUST','EVENT_SHOCK','EXECUTION_RISK'];
  const by_category={} as Record<SystemResearchCategory,{retrieved:number;unavailable:number;ready_for_interpretation:boolean}>;
  for(const category of categories){
    const group=snapshots.filter(item=>item.category===category);const retrieved=group.filter(item=>item.status==='RETRIEVED').length;
    by_category[category]={retrieved,unavailable:group.length-retrieved,ready_for_interpretation:retrieved>0};
  }
  const by_dimension={} as Record<NiftyResearchDimension,{retrieved:number;ready_for_interpretation:boolean;source_ids:string[]}>;
  const rbiRateRows=snapshots.filter(item=>item.status==='RETRIEVED'&&['RBI_HOME','RBI_CURRENT_RATES'].includes(item.source_id)&&typeof item.facts?.policy_repo_rate_pct==='number');
  const rbiLatestLink=typeof rbiHome?.facts?.latest_policy_document_url==='string'&&!!rbiHome.facts.latest_policy_document_url;
  const rbiDecisionRows=snapshots.filter(item=>item.status==='RETRIEVED'&&item.source_id==='RBI_LATEST_POLICY_DECISION'&&typeof item.facts?.policy_repo_rate_pct==='number'&&typeof item.facts?.policy_action==='string');
  const fedDecisionRows=snapshots.filter(item=>item.status==='RETRIEVED'&&item.source_id==='FED_LATEST_FOMC_STATEMENT'&&!!item.facts&&(typeof item.facts.policy_action==='string'||typeof item.facts.target_range_text==='string'));
  for(const dimension of REQUIRED_NIFTY_RESEARCH_DIMENSIONS){
    const retrievedRows=snapshots.filter(item=>{
      if(item.status!=='RETRIEVED'||!item.dimensions.includes(dimension))return false;
      if(dimension==='INSTITUTIONAL_FLOWS'){
        return item.authority==='OFFICIAL_MARKET'&&item.source_id.startsWith('NSE_FII_DII_')&&!!item.facts&&!!item.facts.dii&&!!item.facts.fii_fpi;
      }
      if(dimension==='MACRO_RATES_FX'){
        const rbiReady=rbiRateRows.length>0&&(!rbiLatestLink||rbiDecisionRows.length>0);
        const fedReady=fedDecisionRows.length>0;
        return rbiReady&&fedReady&&(['RBI_HOME','RBI_CURRENT_RATES','RBI_LATEST_POLICY_DECISION','FED_LATEST_FOMC_STATEMENT'].includes(item.source_id));
      }
      return true;
    });
    const macroReady=dimension==='MACRO_RATES_FX'
      ?rbiRateRows.length>0&&(!rbiLatestLink||rbiDecisionRows.length>0)&&fedDecisionRows.length>0
      :retrievedRows.length>0;
    by_dimension[dimension]={
      retrieved:retrievedRows.length,
      ready_for_interpretation:macroReady,
      source_ids:retrievedRows.map(item=>item.source_id)
    };
  }
  const missing_dimensions=REQUIRED_NIFTY_RESEARCH_DIMENSIONS.filter(d=>!by_dimension[d].ready_for_interpretation);
  const fact_blockers:string[]=[];
  if(!rbiRateRows.length)fact_blockers.push('RBI_CURRENT_POLICY_RATE_FACT_MISSING');
  if(rbiLatestLink&&!rbiDecisionRows.length)fact_blockers.push('RBI_LATEST_POLICY_DECISION_UNRESOLVED');
  if(!fedDecisionRows.length)fact_blockers.push('FED_LATEST_POLICY_DECISION_UNRESOLVED');
  return {
    snapshots,
    by_category,
    by_dimension,
    research_manifest_complete:missing_dimensions.length===0,
    missing_dimensions,
    fact_blockers
  };
}
