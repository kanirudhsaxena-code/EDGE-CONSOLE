import { neon } from '@neondatabase/serverless';
import calendar from '../config/nse-trading-calendar.json';

export type NseSessionState=
  |'TRADING_DAY'
  |'WEEKEND'
  |'TRADING_HOLIDAY'
  |'SPECIAL_TIMING'
  |'CALENDAR_COVERAGE_MISSING';

export type NseCalendarAuthority=
  |'EXACT_PROVIDER_SESSION'
  |'VERIFIED_YEAR_CACHE'
  |'BOOTSTRAP_STATIC'
  |'CALENDAR_RULE'
  |'NONE';

export type NseSessionResolution={
  date:string;
  session_state:NseSessionState;
  preopen_eligible:boolean;
  authority:NseCalendarAuthority;
  source_ref:string|null;
  acquired_at:string|null;
  market_open_at:string|null;
  market_close_at:string|null;
  cache_age_hours:number|null;
  calendar_schema:string;
};

export type NseCalendarEnv={EDGE_DATABASE_URL?:string};

const coveredYears=new Set<number>(calendar.coverage_years.map(Number));
const tradingHolidays=new Set<string>(calendar.trading_holidays.map(String));
const EXACT_PROOF_MAX_AGE_HOURS=36;
const YEAR_CACHE_MAX_AGE_HOURS=120;

function parseIsoDate(dateIso:string):{year:number;month:number;day:number}|null{
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if(!match)return null;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  const d=new Date(Date.UTC(year,month-1,day));
  if(
    d.getUTCFullYear()!==year ||
    d.getUTCMonth()!==month-1 ||
    d.getUTCDate()!==day
  )return null;
  return {year,month,day};
}

function weekday(parsed:{year:number;month:number;day:number}):number{
  return new Date(Date.UTC(parsed.year,parsed.month-1,parsed.day)).getUTCDay();
}

function arrayOfStrings(value:unknown):string[]{
  if(Array.isArray(value))return value.map(String);
  if(typeof value==='string'){
    try{
      const parsed=JSON.parse(value);
      return Array.isArray(parsed)?parsed.map(String):[];
    }catch{return []}
  }
  return [];
}

function isoOrNull(value:unknown):string|null{
  if(value===null||value===undefined||value==='')return null;
  const d=new Date(String(value));
  return Number.isNaN(d.getTime())?null:d.toISOString();
}

function hoursBetween(later:Date,earlierIso:string|null):number|null{
  if(!earlierIso)return null;
  const earlier=new Date(earlierIso);
  if(Number.isNaN(earlier.getTime()))return null;
  return Math.max(0,(later.getTime()-earlier.getTime())/3_600_000);
}

export function classifyCachedNseSession(
  dateIso:string,
  cache:{trading_holidays:unknown;special_timing_dates:unknown},
):NseSessionState{
  const parsed=parseIsoDate(dateIso);
  if(!parsed)return 'CALENDAR_COVERAGE_MISSING';
  const day=weekday(parsed);
  const closed=new Set(arrayOfStrings(cache.trading_holidays));
  const special=new Set(arrayOfStrings(cache.special_timing_dates));
  if(closed.has(dateIso))return 'TRADING_HOLIDAY';
  if(special.has(dateIso))return 'SPECIAL_TIMING';
  if(day===0||day===6)return 'WEEKEND';
  return 'TRADING_DAY';
}

/**
 * Bootstrap-only deterministic classifier retained for migration safety.
 * Production scheduling uses resolveGovernedNseSession(), which prefers exact
 * provider session proof and then the verified persisted year cache.
 */
export function classifyGovernedNseSession(dateIso:string):NseSessionState{
  const parsed=parseIsoDate(dateIso);
  if(!parsed)return 'CALENDAR_COVERAGE_MISSING';
  const day=weekday(parsed);
  if(day===0||day===6)return 'WEEKEND';
  if(!coveredYears.has(parsed.year))return 'CALENDAR_COVERAGE_MISSING';
  if(tradingHolidays.has(dateIso))return 'TRADING_HOLIDAY';
  return 'TRADING_DAY';
}

export function isGovernedNseTradingDay(dateIso:string):boolean{
  return classifyGovernedNseSession(dateIso)==='TRADING_DAY';
}

function bootstrapResolution(dateIso:string):NseSessionResolution{
  const state=classifyGovernedNseSession(dateIso);
  return {
    date:dateIso,
    session_state:state,
    preopen_eligible:false,
    authority:state==='CALENDAR_COVERAGE_MISSING'?'NONE':state==='WEEKEND'?'CALENDAR_RULE':'BOOTSTRAP_STATIC',
    source_ref:state==='CALENDAR_COVERAGE_MISSING'?null:'config/nse-trading-calendar.json',
    acquired_at:null,
    market_open_at:null,
    market_close_at:null,
    cache_age_hours:null,
    calendar_schema:String(calendar.schema),
  };
}

export async function resolveGovernedNseSession(
  env:NseCalendarEnv,
  dateIso:string,
  now=new Date(),
):Promise<NseSessionResolution>{
  const parsed=parseIsoDate(dateIso);
  if(!parsed)return bootstrapResolution(dateIso);
  const day=weekday(parsed);

  if(env.EDGE_DATABASE_URL){
    try{
      const sql=neon(env.EDGE_DATABASE_URL);
      const exact=await sql\`
        select session_state,preopen_eligible,market_open_at,market_close_at,
               timing_source_ref,calendar_source_ref,acquired_at
          from v_nse_session_latest
         where session_date=cast(\${dateIso} as date)
         limit 1
      \`;
      if(exact.length){
        const row=exact[0] as Record<string,unknown>;
        const raw=String(row.session_state??'');
        const state:NseSessionState=
          raw==='TRADING_DAY'||raw==='TRADING_HOLIDAY'||raw==='WEEKEND'||raw==='SPECIAL_TIMING'
            ?raw:'CALENDAR_COVERAGE_MISSING';
        const acquired=isoOrNull(row.acquired_at);
        const age=hoursBetween(now,acquired);
        if(age!==null&&age<=EXACT_PROOF_MAX_AGE_HOURS){
          return {
            date:dateIso,
            session_state:state,
            preopen_eligible:row.preopen_eligible===true&&state==='TRADING_DAY',
            authority:'EXACT_PROVIDER_SESSION',
            source_ref:String(row.timing_source_ref??row.calendar_source_ref??'')||null,
            acquired_at:acquired,
            market_open_at:isoOrNull(row.market_open_at),
            market_close_at:isoOrNull(row.market_close_at),
            cache_age_hours:age,
            calendar_schema:'NSE_SESSION_CALENDAR_DYNAMIC_V1',
          };
        }
      }

      const years=await sql\`
        select trading_holidays,special_timing_dates,source_ref,acquired_at
          from v_nse_calendar_year_latest
         where calendar_year=\${parsed.year}
         limit 1
      \`;
      if(years.length){
        const row=years[0] as Record<string,unknown>;
        const acquired=isoOrNull(row.acquired_at);
        const age=hoursBetween(now,acquired);
        if(age!==null&&age<=YEAR_CACHE_MAX_AGE_HOURS){
          const state=classifyCachedNseSession(dateIso,{
            trading_holidays:row.trading_holidays,
            special_timing_dates:row.special_timing_dates,
          });
          return {
            date:dateIso,
            session_state:state,
            preopen_eligible:state==='TRADING_DAY',
            authority:'VERIFIED_YEAR_CACHE',
            source_ref:String(row.source_ref??'')||null,
            acquired_at:acquired,
            market_open_at:null,
            market_close_at:null,
            cache_age_hours:age,
            calendar_schema:'NSE_SESSION_CALENDAR_DYNAMIC_V1',
          };
        }
      }
    }catch{
      // Migration/bootstrap resilience: fall through to the checked-in 2026
      // bootstrap snapshot. Unsupported years still fail closed.
    }
  }

  return bootstrapResolution(dateIso);
}

function previousIsoDate(dateIso:string):string|null{
  const parsed=parseIsoDate(dateIso);
  if(!parsed)return null;
  const d=new Date(Date.UTC(parsed.year,parsed.month-1,parsed.day));
  d.setUTCDate(d.getUTCDate()-1);
  return d.toISOString().slice(0,10);
}

export async function resolvePreviousNseTradingSession(
  env:NseCalendarEnv,
  dateIso:string,
  now=new Date(),
):Promise<string|null>{
  let cursor=previousIsoDate(dateIso);
  for(let i=0;i<20&&cursor;i++){
    const resolved=await resolveGovernedNseSession(env,cursor,now);
    if(resolved.session_state==='TRADING_DAY'||resolved.session_state==='SPECIAL_TIMING')return cursor;
    if(resolved.session_state==='CALENDAR_COVERAGE_MISSING')return null;
    cursor=previousIsoDate(cursor);
  }
  return null;
}

const json=(value:unknown,status=200)=>new Response(JSON.stringify(value,null,2),{
  status,headers:{'content-type':'application/json; charset=utf-8'}
});

export async function handleMarketCalendarRequest(
  request:Request,
  env:NseCalendarEnv,
):Promise<Response|null>{
  const url=new URL(request.url);
  if(url.pathname!=='/api/market-calendar/session'||request.method!=='GET')return null;
  const dateIso=String(url.searchParams.get('date')??'').trim();
  if(!parseIsoDate(dateIso))return json({error:'date=YYYY-MM-DD is mandatory and must be valid'},422);
  const resolution=await resolveGovernedNseSession(env,dateIso,new Date());
  const previous=await resolvePreviousNseTradingSession(env,dateIso,new Date());
  return json({
    ...resolution,
    previous_trading_session:previous,
    trading_enabled:false,
  },resolution.session_state==='CALENDAR_COVERAGE_MISSING'?503:200);
}

export const GOVERNED_NSE_CALENDAR={
  schema:String(calendar.schema),
  timezone:String(calendar.timezone),
  bootstrap_coverage_years:[...coveredYears].sort(),
  authority:'Dynamic provider session proof -> verified year cache -> bootstrap static',
  exact_proof_max_age_hours:EXACT_PROOF_MAX_AGE_HOURS,
  year_cache_max_age_hours:YEAR_CACHE_MAX_AGE_HOURS,
} as const;