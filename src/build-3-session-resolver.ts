import { BUILD3_HORIZONS, type Build3TargetSession } from './build-3-run-contract';
import { classifyGovernedNseSession } from './nse-trading-calendar';

export const BUILD3_SESSION_TIMEZONE='Asia/Kolkata' as const;
export const BUILD3_SESSION_CLOSE_MINUTE=15*60+30;

type IstRunClock={date:string;minuteOfDay:number};

function istRunClock(at:Date):IstRunClock{
  if(Number.isNaN(at.getTime()))throw new Error('BUILD3_SESSION_RESOLVER_INVALID_TIMESTAMP');
  const parts=Object.fromEntries(
    new Intl.DateTimeFormat('en-US',{
      timeZone:BUILD3_SESSION_TIMEZONE,
      year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hourCycle:'h23'
    }).formatToParts(at).filter(part=>part.type!=='literal').map(part=>[part.type,part.value])
  );
  return {
    date:`${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay:Number(parts.hour)*60+Number(parts.minute),
  };
}

function addCalendarDays(dateIso:string,days:number):string{
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if(!match)throw new Error('BUILD3_SESSION_RESOLVER_INVALID_DATE');
  const next=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])+days));
  return next.toISOString().slice(0,10);
}

function firstEligibleSession(startDate:string,includeStart:boolean):string{
  let candidate=includeStart?startDate:addCalendarDays(startDate,1);
  for(let guard=0;guard<20;guard++){
    const state=classifyGovernedNseSession(candidate);
    if(state==='TRADING_DAY')return candidate;
    if(state==='CALENDAR_COVERAGE_MISSING'){
      throw new Error(`BUILD3_SESSION_CALENDAR_COVERAGE_MISSING:${candidate}`);
    }
    candidate=addCalendarDays(candidate,1);
  }
  throw new Error('BUILD3_SESSION_RESOLUTION_EXHAUSTED');
}

export function resolveBuild3TargetSessions(runTimestamp:Date|string):Build3TargetSession[]{
  const at=runTimestamp instanceof Date?runTimestamp:new Date(runTimestamp);
  const clock=istRunClock(at);
  const runDateState=classifyGovernedNseSession(clock.date);
  if(runDateState==='CALENDAR_COVERAGE_MISSING'){
    throw new Error(`BUILD3_SESSION_CALENDAR_COVERAGE_MISSING:${clock.date}`);
  }

  const useRunDate=
    runDateState==='TRADING_DAY'&&clock.minuteOfDay<BUILD3_SESSION_CLOSE_MINUTE;
  const d=firstEligibleSession(clock.date,useRunDate);

  const sessions:string[]=[d];
  while(sessions.length<BUILD3_HORIZONS.length){
    sessions.push(firstEligibleSession(sessions[sessions.length-1],false));
  }

  return BUILD3_HORIZONS.map((horizon,index)=>({
    horizon,
    target_session:sessions[index],
  }));
}
