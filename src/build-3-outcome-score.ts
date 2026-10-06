import type { Build3ForecastHorizon } from './build-3-forecast-contract';
import type { Build3PrecisionIssuance } from './build-3-precision';
import {
  BUILD3_OUTCOME_VERSION,
  BUILD3_PROBABILITY_RULE_VERSION,
  assertBuild3OutcomeIdentity,
  type Build3HorizonOutcome,
  type Build3SessionOhlcSource,
} from './build-3-outcome-types';

const inside=(p:number,l:number,h:number)=>p>=l&&p<=h;
const touch=(lo:number,hi:number,l:number,h:number)=>hi>=l&&lo<=h;
const dist=(p:number,l:number,h:number)=>p<l?l-p:p>h?p-h:0;
const positive=(v:number)=>Number.isFinite(v)&&v>0;

function direction(row:Build3ForecastHorizon,p0:number,close:number){
  if(row.direction==='BULL')return {hit:close>p0,margin:close-p0};
  if(row.direction==='BEAR')return {hit:close<p0,margin:p0-close};
  const hit=inside(close,row.outer_zone.low,row.outer_zone.high);
  return {
    hit,
    margin:hit
      ?Math.min(close-row.outer_zone.low,row.outer_zone.high-close)
      :-dist(close,row.outer_zone.low,row.outer_zone.high),
  };
}

function probability(row:Build3ForecastHorizon,p:Build3PrecisionIssuance,p0:number,close:number){
  const half=p.core_width_points/2;
  if(!(half>0))return {
    state:'NOT_SCORABLE' as const,actual:null,brier:null,
    components:{rule_version:BUILD3_PROBABILITY_RULE_VERSION,reason:'POSITIVE_FROZEN_CORE_WIDTH_REQUIRED'},
  };
  const actual:'BULL'|'RANGE'|'BEAR'=close>p0+half?'BULL':close<p0-half?'BEAR':'RANGE';
  const q={BULL:row.probabilities.BULL/100,RANGE:row.probabilities.RANGE/100,BEAR:row.probabilities.BEAR/100};
  const sq={
    BULL:(q.BULL-(actual==='BULL'?1:0))**2,
    RANGE:(q.RANGE-(actual==='RANGE'?1:0))**2,
    BEAR:(q.BEAR-(actual==='BEAR'?1:0))**2,
  };
  return {
    state:'SCORABLE' as const,actual,brier:sq.BULL+sq.RANGE+sq.BEAR,
    components:{
      rule_version:BUILD3_PROBABILITY_RULE_VERSION,
      formula:'SUM_SQUARED_ERROR_3_CLASS',
      neutral_band_low:p0-half,neutral_band_high:p0+half,
      frozen_core_half_width_points:half,probabilities:q,squared_errors:sq,
    },
  };
}

export function scoreBuild3HorizonOutcome(x:{
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  reference_price_p0:number;
  row:Build3ForecastHorizon;
  precision:Build3PrecisionIssuance;
  source:Build3SessionOhlcSource;
  evaluated_at?:string;
}):Build3HorizonOutcome{
  const {engine,instrument,source_id,reference_price_p0:p0,row,precision:p,source:s}=x;
  assertBuild3OutcomeIdentity(engine,instrument,source_id,row.horizon,row.target_session,p,s);
  if(!positive(p0))throw new Error('BUILD3_OUTCOME_P0_INVALID');
  const d=direction(row,p0,s.actual_close);
  const outerTouch=touch(s.actual_low,s.actual_high,row.outer_zone.low,row.outer_zone.high);
  const outerClose=inside(s.actual_close,row.outer_zone.low,row.outer_zone.high);
  const coreTouch=touch(s.actual_low,s.actual_high,row.core_zone.low,row.core_zone.high);
  const coreClose=inside(s.actual_close,row.core_zone.low,row.core_zone.high);
  const centreError=Math.abs(s.actual_close-row.expected_centre);
  const prob=probability(row,p,p0,s.actual_close);
  const caOk=engine==='5DR'
    ?s.corporate_action_state==='NOT_APPLICABLE'
    :['CLEAR','ADJUSTED'].includes(s.corporate_action_state);
  return {
    precision_outcome_version:'MDOS_BUILD_3_PRECISION_OUTCOME_V1',
    outcome_version:BUILD3_OUTCOME_VERSION,
    engine,instrument,source_id,horizon:row.horizon,target_session:row.target_session,
    outcome_source:s.source_ref,source_captured_at:s.captured_at,provider_hash:s.provider_hash,
    corporate_action_state:s.corporate_action_state,adjustment_basis:s.adjustment_basis,
    evaluated_at:x.evaluated_at??new Date().toISOString(),
    actual_open:s.actual_open,actual_high:s.actual_high,actual_low:s.actual_low,actual_close:s.actual_close,
    direction_result:caOk?(d.hit?'HIT':'MISS'):'NOT_SCORABLE',
    direction_margin_points:d.margin,
    outer_touch:outerTouch,outer_close_hit:outerClose,core_touch:coreTouch,core_close_hit:coreClose,
    core_width_points:p.core_width_points,core_width_percent:p.core_width_percent,
    outer_width_points:p.outer_width_points,outer_width_percent:p.outer_width_percent,
    centre_error:centreError,normalized_centre_error:centreError/p0*100,
    miss_distance:dist(s.actual_close,row.core_zone.low,row.core_zone.high),
    edge_proximity:Math.min(Math.abs(s.actual_close-row.core_zone.low),Math.abs(s.actual_close-row.core_zone.high)),
    probability_state:caOk?prob.state:'NOT_SCORABLE',
    realized_probability_class:caOk?prob.actual:null,
    brier_score:caOk?prob.brier:null,
    brier_components:{...prob.components,scorable:caOk,corporate_action_state:s.corporate_action_state},
    scorability_state:caOk?'SCORABLE':'NOT_SCORABLE',
    scorability_reason:caOk?null:`CORPORATE_ACTION_STATE_${s.corporate_action_state}`,
  };
}
