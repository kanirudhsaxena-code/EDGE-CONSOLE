import calendar from '../config/nse-trading-calendar.json';

export type NseSessionState='TRADING_DAY'|'WEEKEND'|'TRADING_HOLIDAY'|'CALENDAR_COVERAGE_MISSING';

const coveredYears=new Set<number>(calendar.coverage_years.map(Number));
const tradingHolidays=new Set<string>(calendar.trading_holidays.map(String));

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

export function classifyGovernedNseSession(dateIso:string):NseSessionState{
  const parsed=parseIsoDate(dateIso);
  if(!parsed)return 'CALENDAR_COVERAGE_MISSING';
  const weekday=new Date(Date.UTC(parsed.year,parsed.month-1,parsed.day)).getUTCDay();
  if(weekday===0||weekday===6)return 'WEEKEND';
  if(!coveredYears.has(parsed.year))return 'CALENDAR_COVERAGE_MISSING';
  if(tradingHolidays.has(dateIso))return 'TRADING_HOLIDAY';
  return 'TRADING_DAY';
}

export function isGovernedNseTradingDay(dateIso:string):boolean{
  return classifyGovernedNseSession(dateIso)==='TRADING_DAY';
}

export const GOVERNED_NSE_CALENDAR={
  schema:String(calendar.schema),
  timezone:String(calendar.timezone),
  coverage_years:[...coveredYears].sort(),
  authority:String(calendar.authority),
} as const;
