import type { Build3PrecisionIssuance } from './build-3-precision';
import type { Build3ZoneEfficacy } from './build-3-efficacy-contract';

export const BUILD3_OUTCOME_VERSION='MDOS_BUILD_3_OUTCOME_V2' as const;
export const BUILD3_PROBABILITY_RULE_VERSION='FROZEN_CORE_WIDTH_REBASED_TO_P0_V1' as const;

export type Build3SessionOhlcSource={
  source_version:string;
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  session_date:string;
  captured_at:string;
  source_ref:string;
  provider_hash:string;
  actual_open:number;
  actual_high:number;
  actual_low:number;
  actual_close:number;
  corporate_action_state:'NOT_APPLICABLE'|'CLEAR'|'ADJUSTED'|'UNKNOWN'|'CONFLICT';
  adjustment_basis:string;
};

export type Build3HorizonOutcome={
  precision_outcome_version:'MDOS_BUILD_3_PRECISION_OUTCOME_V1';
  outcome_version:typeof BUILD3_OUTCOME_VERSION;
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  horizon:string;
  target_session:string;
  outcome_source:string;
  source_captured_at:string;
  provider_hash:string;
  corporate_action_state:Build3SessionOhlcSource['corporate_action_state'];
  adjustment_basis:string;
  evaluated_at:string;
  actual_open:number;
  actual_high:number;
  actual_low:number;
  actual_close:number;
  direction_result:'HIT'|'MISS'|'NOT_SCORABLE';
  direction_margin_points:number;
  outer_touch:boolean;
  outer_close_hit:boolean;
  core_touch:boolean;
  core_close_hit:boolean;
  core_width_points:number;
  core_width_percent:number;
  outer_width_points:number;
  outer_width_percent:number;
  centre_error:number;
  normalized_centre_error:number;
  miss_distance:number;
  edge_proximity:number;
  zone_efficacy_version:string;
  outer_efficacy:Build3ZoneEfficacy;
  core_efficacy:Build3ZoneEfficacy;
  probability_state:'SCORABLE'|'NOT_SCORABLE';
  realized_probability_class:'BULL'|'RANGE'|'BEAR'|null;
  brier_score:number|null;
  brier_components:Record<string,unknown>;
  scorability_state:'SCORABLE'|'NOT_SCORABLE';
  scorability_reason:string|null;
};

const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;

export function validateBuild3SessionOhlc(s:Build3SessionOhlcSource):string[]{
  const e:string[]=[];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s.session_date))e.push('session_date');
  if(Number.isNaN(Date.parse(s.captured_at)))e.push('captured_at');
  if(!s.source_ref?.trim())e.push('source_ref');
  if(!/^[0-9a-f]{64}$/i.test(s.provider_hash))e.push('provider_hash');
  for(const k of ['actual_open','actual_high','actual_low','actual_close'] as const){
    if(!positive(s[k]))e.push(k);
  }
  if(positive(s.actual_low)&&positive(s.actual_high)&&s.actual_low>s.actual_high)e.push('high_low_geometry');
  if(
    positive(s.actual_low)&&positive(s.actual_high)&&positive(s.actual_open)&&positive(s.actual_close)&&
    (s.actual_low>Math.min(s.actual_open,s.actual_close)||s.actual_high<Math.max(s.actual_open,s.actual_close))
  )e.push('ohlc_geometry');
  return e;
}

export function assertBuild3OutcomeIdentity(
  engine:'5DR'|'EDGE_STOCKS',instrument:string,sourceId:string,
  horizon:string,targetSession:string,precision:Build3PrecisionIssuance,source:Build3SessionOhlcSource,
){
  const errors=validateBuild3SessionOhlc(source);
  if(errors.length)throw new Error('BUILD3_OUTCOME_SOURCE_INVALID:'+errors.join(','));
  if(source.engine!==engine||source.instrument!==instrument||source.session_date!==targetSession){
    throw new Error('BUILD3_OUTCOME_SOURCE_IDENTITY_MISMATCH');
  }
  if(
    precision.engine!==engine||precision.instrument!==instrument||precision.source_id!==sourceId||
    precision.horizon!==horizon||precision.target_session!==targetSession
  )throw new Error('BUILD3_OUTCOME_PRECISION_IDENTITY_MISMATCH');
}
