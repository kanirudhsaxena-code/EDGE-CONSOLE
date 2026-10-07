import type { Build3DecisionRecord } from './build-3-decision';
import type { Build3SessionOhlcSource } from './build-3-outcome-types';

export const BUILD3_RECOMMENDATION_OBSERVATION_VERSION='MDOS_BUILD_3_RECOMMENDATION_OBSERVATION_V1' as const;

export type Build3RecommendationObservationState='SCORABLE'|'PENDING'|'NOT_SCORABLE';

export type Build3RecommendationObservation={
  observation_version:typeof BUILD3_RECOMMENDATION_OBSERVATION_VERSION;
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  evaluated_at:string;
  state:Build3RecommendationObservationState;
  reason:string|null;
  lifecycle_complete:boolean;
  entry_triggered:boolean;
  entry_triggered_session:string|null;
  entry_triggered_basis:'OPEN_IN_BAND'|'RANGE_ENTERED_BAND'|null;
  target_hit:boolean|null;
  sl_hit:boolean|null;
  expected_sessions:string[];
  observed_sessions:string[];
  evidence:Array<{
    session_date:string;
    source_ref:string;
    provider_hash:string;
    actual_open:number;
    actual_high:number;
    actual_low:number;
    actual_close:number;
  }>;
};

const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value);
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const inRange=(value:number,low:number,high:number)=>value>=low&&value<=high;
const rangeTouches=(low:number,high:number,level:number)=>low<=level&&high>=level;
const bandTouches=(low:number,high:number,bandLow:number,bandHigh:number)=>high>=bandLow&&low<=bandHigh;

function istDateAndMinute(value:string):{date:string;minute:number}{
  const parsed=new Date(value);
  if(Number.isNaN(parsed.getTime()))throw new Error('BUILD3_RECOMMENDATION_ISSUED_AT_INVALID');
  const shifted=new Date(parsed.getTime()+330*60_000);
  return {date:shifted.toISOString().slice(0,10),minute:shifted.getUTCHours()*60+shifted.getUTCMinutes()};
}

function result(
  decision:Build3DecisionRecord,
  evaluatedAt:string,
  lifecycleComplete:boolean,
  state:Build3RecommendationObservationState,
  reason:string|null,
  expectedSessions:string[],
  sessions:Build3SessionOhlcSource[],
  partial:Partial<Build3RecommendationObservation>={},
):Build3RecommendationObservation{
  return {
    observation_version:BUILD3_RECOMMENDATION_OBSERVATION_VERSION,
    engine:decision.engine,instrument:decision.instrument,source_id:decision.source_id,
    evaluated_at:evaluatedAt,state,reason,lifecycle_complete:lifecycleComplete,
    entry_triggered:false,entry_triggered_session:null,entry_triggered_basis:null,
    target_hit:null,sl_hit:null,
    expected_sessions:expectedSessions,
    observed_sessions:sessions.map(row=>row.session_date),
    evidence:sessions.map(row=>({
      session_date:row.session_date,source_ref:row.source_ref,provider_hash:row.provider_hash,
      actual_open:row.actual_open,actual_high:row.actual_high,actual_low:row.actual_low,actual_close:row.actual_close,
    })),
    ...partial,
  };
}

export function observeBuild3RecommendationFromDailySessions(input:{
  decision:Build3DecisionRecord;
  expected_sessions:string[];
  sessions:Build3SessionOhlcSource[];
  now?:Date;
}):Build3RecommendationObservation{
  const {decision}=input;
  const now=input.now??new Date();
  if(Number.isNaN(now.getTime()))throw new Error('BUILD3_RECOMMENDATION_OBSERVATION_NOW_INVALID');
  const evaluatedAt=now.toISOString();
  const expectedSessions=[...new Set(input.expected_sessions)].sort();
  if(expectedSessions.some(value=>!validDate(value)))throw new Error('BUILD3_RECOMMENDATION_EXPECTED_SESSION_INVALID');

  if(decision.decision_state!=='ACTIONABLE'){
    return result(decision,evaluatedAt,false,'NOT_SCORABLE','ACTIONABLE_RECOMMENDATION_REQUIRED',expectedSessions,[]);
  }
  const x=decision.execution_snapshot;
  const lifecycleEndAt=x.lifecycle_end_at;
  const lifecycleEndMs=lifecycleEndAt?Date.parse(lifecycleEndAt):NaN;
  if(!lifecycleEndAt||Number.isNaN(lifecycleEndMs)){
    return result(decision,evaluatedAt,false,'NOT_SCORABLE','LIFECYCLE_END_NOT_FROZEN',expectedSessions,[]);
  }
  const lifecycleComplete=now.getTime()>=lifecycleEndMs;
  if(!lifecycleComplete){
    return result(decision,evaluatedAt,false,'PENDING','LIFECYCLE_OPEN',expectedSessions,[]);
  }
  if(
    !x.applicable||x.availability!=='COMPLETE'||!x.exact_contract_verified||
    !finite(x.entry_low)||!finite(x.entry_high)||!finite(x.stop)||!finite(x.efficacy_target)||
    x.entry_low>x.entry_high
  ){
    return result(decision,evaluatedAt,true,'NOT_SCORABLE','FROZEN_EXECUTION_CONTRACT_INCOMPLETE',expectedSessions,[]);
  }

  // Daily index OHLC must never be used to score option-premium entry/target/SL.
  if(decision.engine==='5DR'){
    return result(decision,evaluatedAt,true,'NOT_SCORABLE','OPTION_CONTRACT_LEVEL_OHLC_REQUIRED',expectedSessions,[]);
  }
  if(!['EQUITY','EQUITY_EXIT'].includes(String(x.instrument_expression??'').toUpperCase())){
    return result(decision,evaluatedAt,true,'NOT_SCORABLE','STOCK_EXECUTION_INSTRUMENT_UNSUPPORTED',expectedSessions,[]);
  }

  const lifecycleEndDate=new Date(lifecycleEndMs+330*60_000).toISOString().slice(0,10);
  const required=expectedSessions.filter(date=>date<=lifecycleEndDate);
  const byDate=new Map<string,Build3SessionOhlcSource>();
  for(const row of input.sessions){
    if(row.engine!==decision.engine||row.instrument!==decision.instrument||!validDate(row.session_date)){
      return result(decision,evaluatedAt,true,'NOT_SCORABLE','SESSION_EVIDENCE_IDENTITY_MISMATCH',required,[]);
    }
    if(!['CLEAR','ADJUSTED'].includes(row.corporate_action_state)){
      return result(decision,evaluatedAt,true,'PENDING','SESSION_EVIDENCE_CORPORATE_ACTION_UNRESOLVED',required,[]);
    }
    if(byDate.has(row.session_date)){
      return result(decision,evaluatedAt,true,'NOT_SCORABLE','SESSION_EVIDENCE_DUPLICATE_DATE',required,[]);
    }
    byDate.set(row.session_date,row);
  }
  const missing=required.filter(date=>!byDate.has(date));
  const sessions=required.map(date=>byDate.get(date)).filter((row):row is Build3SessionOhlcSource=>!!row);
  if(missing.length){
    return result(decision,evaluatedAt,true,'PENDING','SESSION_EVIDENCE_MISSING:'+missing.join(','),required,sessions);
  }

  const issued=istDateAndMinute(decision.issued_at);
  const marketOpenMinute=9*60+15;
  let entryTriggered=false;
  let entrySession:string|null=null;
  let entryBasis:'OPEN_IN_BAND'|'RANGE_ENTERED_BAND'|null=null;
  let targetHit=false;
  let slHit=false;

  for(const bar of sessions){
    if(bar.session_date<issued.date)continue;
    const sameIssueDate=bar.session_date===issued.date;

    if(!entryTriggered){
      // If issuance happened after market open, a daily bar cannot prove whether a same-day
      // band touch happened before or after issuance. Fail closed if the band was touched.
      if(sameIssueDate&&issued.minute>=marketOpenMinute){
        if(bandTouches(bar.actual_low,bar.actual_high,x.entry_low,x.entry_high)){
          return result(decision,evaluatedAt,true,'NOT_SCORABLE','SAME_SESSION_ENTRY_SEQUENCE_REQUIRES_INTRADAY_EVIDENCE',required,sessions);
        }
        continue;
      }

      if(inRange(bar.actual_open,x.entry_low,x.entry_high)){
        entryTriggered=true; entrySession=bar.session_date; entryBasis='OPEN_IN_BAND';
        targetHit=rangeTouches(bar.actual_low,bar.actual_high,x.efficacy_target);
        slHit=rangeTouches(bar.actual_low,bar.actual_high,x.stop);
        continue;
      }

      if(bandTouches(bar.actual_low,bar.actual_high,x.entry_low,x.entry_high)){
        entryTriggered=true; entrySession=bar.session_date; entryBasis='RANGE_ENTERED_BAND';
        const targetSameSession=rangeTouches(bar.actual_low,bar.actual_high,x.efficacy_target);
        const slSameSession=rangeTouches(bar.actual_low,bar.actual_high,x.stop);
        if(targetSameSession||slSameSession){
          return result(decision,evaluatedAt,true,'NOT_SCORABLE','ENTRY_SESSION_TARGET_SL_SEQUENCE_REQUIRES_INTRADAY_EVIDENCE',required,sessions,{
            entry_triggered:true,entry_triggered_session:entrySession,entry_triggered_basis:entryBasis,
          });
        }
        continue;
      }
      continue;
    }

    if(rangeTouches(bar.actual_low,bar.actual_high,x.efficacy_target))targetHit=true;
    if(rangeTouches(bar.actual_low,bar.actual_high,x.stop))slHit=true;
  }

  return result(decision,evaluatedAt,true,'SCORABLE',null,required,sessions,{
    entry_triggered:entryTriggered,
    entry_triggered_session:entrySession,
    entry_triggered_basis:entryBasis,
    target_hit:entryTriggered?targetHit:false,
    sl_hit:entryTriggered?slHit:false,
  });
}
