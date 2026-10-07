import { neon } from '@neondatabase/serverless';
import { canonicalBuild3EvidenceJson } from './build-3-evidence-snapshot';
import type { Build3ChallengerProposal } from './build-3-learning-lab';
import type { Build3Scorecard } from './build-3-scorecard';

export const BUILD3_CHALLENGER_EVENT_VERSION='MDOS_BUILD_3_CHALLENGER_EVENT_V1' as const;
export const BUILD3_CHALLENGER_COMPARISON_VERSION='MDOS_BUILD_3_CHALLENGER_COMPARISON_V1' as const;

export type Build3ChallengerEventType='APPROVED'|'REJECTED'|'PROMOTED'|'WITHDRAWN';

export type Build3ChallengerEvent={
  event_version:typeof BUILD3_CHALLENGER_EVENT_VERSION;
  challenger_id:string;
  event_type:Build3ChallengerEventType;
  event_at:string;
  explicit_user_approval:boolean;
  actor:string|null;
  details:Record<string,unknown>;
};

export type Build3ChallengerComparison={
  version:typeof BUILD3_CHALLENGER_COMPARISON_VERSION;
  challenger_id:string;
  comparison_state:'SAME_POPULATION_COMPLETE'|'NEEDS_FORWARD_SHADOW'|'FORWARD_SHADOW_COMPLETE';
  same_population:true;
  baseline_metric:string|null;
  challenger_metric:string|null;
  baseline_value:number|null;
  challenger_value:number|null;
  delta:number|null;
  denominator:number|null;
  downside_checks:{
    drawdown:'NOT_AVAILABLE'|'UNCHANGED'|'WORSE'|'BETTER';
    probability_calibration:'NOT_AVAILABLE'|'UNCHANGED'|'WORSE'|'BETTER';
    no_trade_protection:'NOT_AVAILABLE'|'UNCHANGED'|'WORSE'|'BETTER';
  };
  promotion_eligible:false;
  reason:string;
};

export function prepareBuild3ChallengerEvent(input:{
  challenger_id:string;
  event_type:Build3ChallengerEventType;
  event_at?:string;
  explicit_user_approval?:boolean;
  actor?:string|null;
  details?:Record<string,unknown>;
}):Build3ChallengerEvent{
  if(!input.challenger_id.trim())throw new Error('BUILD3_CHALLENGER_EVENT_ID_REQUIRED');
  const eventAt=input.event_at??new Date().toISOString();
  if(Number.isNaN(Date.parse(eventAt)))throw new Error('BUILD3_CHALLENGER_EVENT_TIMESTAMP_INVALID');
  const approval=Boolean(input.explicit_user_approval);
  if((input.event_type==='APPROVED'||input.event_type==='PROMOTED')&&!approval){
    throw new Error('BUILD3_CHALLENGER_EXPLICIT_USER_APPROVAL_REQUIRED');
  }
  return {
    event_version:BUILD3_CHALLENGER_EVENT_VERSION,
    challenger_id:input.challenger_id.trim(),
    event_type:input.event_type,event_at:new Date(eventAt).toISOString(),
    explicit_user_approval:approval,actor:input.actor?.trim()||null,details:input.details??{},
  };
}

export async function persistBuild3ChallengerEvent(
  databaseUrl:string|undefined,
  event:Build3ChallengerEvent,
):Promise<Build3ChallengerEvent>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_CHALLENGER_EVENT_DATABASE_NOT_CONFIGURED');
  if((event.event_type==='APPROVED'||event.event_type==='PROMOTED')&&!event.explicit_user_approval){
    throw new Error('BUILD3_CHALLENGER_EXPLICIT_USER_APPROVAL_REQUIRED');
  }
  const sql=neon(databaseUrl);
  const challengers=await sql`select challenger_id from build3_challengers where challenger_id=${event.challenger_id} limit 1`;
  if(challengers.length!==1)throw new Error('BUILD3_CHALLENGER_NOT_FOUND');
  await sql`
    insert into build3_challenger_events(
      event_version,challenger_id,event_type,event_at,explicit_user_approval,actor,details,payload
    ) values(
      ${event.event_version},${event.challenger_id},${event.event_type},${event.event_at},
      ${event.explicit_user_approval},${event.actor},${JSON.stringify(event.details)}::jsonb,
      ${JSON.stringify(event)}::jsonb
    )
  `;
  const rows=await sql`
    select payload from build3_challenger_events
     where challenger_id=${event.challenger_id} and event_type=${event.event_type}
       and event_at=${event.event_at}
     order by id desc limit 1
  `;
  if(rows.length!==1)throw new Error('BUILD3_CHALLENGER_EVENT_READBACK_MISSING');
  const restored=rows[0].payload as Build3ChallengerEvent;
  if(canonicalBuild3EvidenceJson(restored)!==canonicalBuild3EvidenceJson(event)){
    throw new Error('BUILD3_CHALLENGER_EVENT_IMMUTABLE_CONFLICT');
  }
  return restored;
}

export function compareBuild3Challenger(
  proposal:Build3ChallengerProposal,
  scorecard:Build3Scorecard,
):Build3ChallengerComparison{
  if(proposal.production_mutation_allowed!==false||proposal.status!=='PROPOSED'){
    throw new Error('BUILD3_CHALLENGER_PROPOSAL_GOVERNANCE_INVALID');
  }
  if(proposal.challenger_type==='ZONE_DEVIATION_TOLERANCE'){
    const m=scorecard.forecast.independent_metrics;
    const baseline=m.core_deviation_hit_rate_pct;
    const challenger=m.core_challenger_3pct_hit_rate_pct;
    const denominator=m.core_zone_samples;
    if(baseline===null||challenger===null||denominator===0){
      return {
        version:BUILD3_CHALLENGER_COMPARISON_VERSION,challenger_id:proposal.challenger_id,
        comparison_state:'NEEDS_FORWARD_SHADOW',same_population:true,
        baseline_metric:'CORE_DEVIATION_HIT_5PCT',challenger_metric:'CORE_DEVIATION_HIT_3PCT',
        baseline_value:baseline,challenger_value:challenger,delta:null,denominator,
        downside_checks:{drawdown:'NOT_AVAILABLE',probability_calibration:'UNCHANGED',no_trade_protection:'UNCHANGED'},
        promotion_eligible:false,reason:'INSUFFICIENT_SCORABLE_ZONE_POPULATION',
      };
    }
    return {
      version:BUILD3_CHALLENGER_COMPARISON_VERSION,challenger_id:proposal.challenger_id,
      comparison_state:'SAME_POPULATION_COMPLETE',same_population:true,
      baseline_metric:'CORE_DEVIATION_HIT_5PCT',challenger_metric:'CORE_DEVIATION_HIT_3PCT',
      baseline_value:baseline,challenger_value:challenger,
      delta:Number((challenger-baseline).toFixed(4)),denominator,
      downside_checks:{drawdown:'NOT_AVAILABLE',probability_calibration:'UNCHANGED',no_trade_protection:'UNCHANGED'},
      promotion_eligible:false,
      reason:'SAME_ELIGIBLE_CORE_ZONE_POPULATION_COMPARISON; USER_APPROVAL_AND_GOVERNED_PROMOTION_STILL_REQUIRED',
    };
  }
  return {
    version:BUILD3_CHALLENGER_COMPARISON_VERSION,challenger_id:proposal.challenger_id,
    comparison_state:'NEEDS_FORWARD_SHADOW',same_population:true,
    baseline_metric:null,challenger_metric:null,baseline_value:null,challenger_value:null,delta:null,denominator:null,
    downside_checks:{drawdown:'NOT_AVAILABLE',probability_calibration:'NOT_AVAILABLE',no_trade_protection:'NOT_AVAILABLE'},
    promotion_eligible:false,
    reason:'CHALLENGER_REQUIRES_IMPLEMENTED_FORWARD_SHADOW_ON_IDENTICAL_ELIGIBLE_NEW_RUNS',
  };
}
