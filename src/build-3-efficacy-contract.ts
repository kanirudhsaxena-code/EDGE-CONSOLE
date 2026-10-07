export const BUILD3_EFFICACY_SCORING_VERSION='MDOS_BUILD_3_EFFICACY_SCORING_V1' as const;
export const BUILD3_ZONE_PRIMARY_TOLERANCE_PCT=5 as const;
export const BUILD3_ZONE_CHALLENGER_TOLERANCE_PCT=3 as const;

export type Build3ZoneQualityStatus='GREEN'|'AMBER'|'RED'|'NOT_SCORABLE';
export type Build3ZoneScorability='SCORABLE'|'NOT_SCORABLE';

export type Build3ZoneEfficacy={
  scoring_version:typeof BUILD3_EFFICACY_SCORING_VERSION;
  scorability_state:Build3ZoneScorability;
  scorability_reason:string|null;
  zone_low:number;
  zone_high:number;
  zone_width_points:number;
  actual_high:number;
  actual_low:number;
  actual_close:number;
  close_hit:boolean|null;
  high_signed_distance_points:number|null;
  low_signed_distance_points:number|null;
  high_breach_points:number|null;
  low_breach_points:number|null;
  high_deviation_pct:number|null;
  low_deviation_pct:number|null;
  range_deviation_pct:number|null;
  primary_tolerance_pct:typeof BUILD3_ZONE_PRIMARY_TOLERANCE_PCT;
  deviation_hit:boolean|null;
  challenger_tolerance_pct:typeof BUILD3_ZONE_CHALLENGER_TOLERANCE_PCT;
  challenger_deviation_hit:boolean|null;
  quality_status:Build3ZoneQualityStatus;
};

const finite=(value:number)=>Number.isFinite(value);
const pct=(value:number,width:number)=>value/width*100;

export function scoreBuild3ZoneEfficacy(input:{
  zone_low:number;
  zone_high:number;
  actual_high:number;
  actual_low:number;
  actual_close:number;
}):Build3ZoneEfficacy{
  const {zone_low:low,zone_high:high,actual_high:ah,actual_low:al,actual_close:ac}=input;
  if(![low,high,ah,al,ac].every(finite))throw new Error('BUILD3_ZONE_EFFICACY_NON_FINITE');
  if(al>ah)throw new Error('BUILD3_ZONE_EFFICACY_OHLC_INVALID');
  const width=high-low;
  const base={
    scoring_version:BUILD3_EFFICACY_SCORING_VERSION,
    zone_low:low,zone_high:high,zone_width_points:width,
    actual_high:ah,actual_low:al,actual_close:ac,
    primary_tolerance_pct:BUILD3_ZONE_PRIMARY_TOLERANCE_PCT,
    challenger_tolerance_pct:BUILD3_ZONE_CHALLENGER_TOLERANCE_PCT,
  } as const;
  if(!(width>0)){
    return {
      ...base,
      scorability_state:'NOT_SCORABLE',
      scorability_reason:'POSITIVE_ZONE_WIDTH_REQUIRED',
      close_hit:null,
      high_signed_distance_points:null,
      low_signed_distance_points:null,
      high_breach_points:null,
      low_breach_points:null,
      high_deviation_pct:null,
      low_deviation_pct:null,
      range_deviation_pct:null,
      deviation_hit:null,
      challenger_deviation_hit:null,
      quality_status:'NOT_SCORABLE',
    };
  }
  const closeHit=ac>=low&&ac<=high;
  const highSigned=ah-high;
  const lowSigned=low-al;
  const highBreach=Math.max(0,highSigned);
  const lowBreach=Math.max(0,lowSigned);
  const highDeviation=pct(highBreach,width);
  const lowDeviation=pct(lowBreach,width);
  const rangeDeviation=Math.max(highDeviation,lowDeviation);
  const deviationHit=rangeDeviation<=BUILD3_ZONE_PRIMARY_TOLERANCE_PCT;
  const challengerDeviationHit=rangeDeviation<=BUILD3_ZONE_CHALLENGER_TOLERANCE_PCT;
  const quality:Build3ZoneQualityStatus=
    closeHit&&deviationHit?'GREEN':
    closeHit||deviationHit?'AMBER':'RED';
  return {
    ...base,
    scorability_state:'SCORABLE',
    scorability_reason:null,
    close_hit:closeHit,
    high_signed_distance_points:highSigned,
    low_signed_distance_points:lowSigned,
    high_breach_points:highBreach,
    low_breach_points:lowBreach,
    high_deviation_pct:highDeviation,
    low_deviation_pct:lowDeviation,
    range_deviation_pct:rangeDeviation,
    deviation_hit:deviationHit,
    challenger_deviation_hit:challengerDeviationHit,
    quality_status:quality,
  };
}

export type Build3RecommendationClassification=
  |'TARGET_ONLY'
  |'SL_ONLY'
  |'DUAL_TOUCH'
  |'TIMEOUT_NO_TARGET'
  |'OPEN'
  |'UNTRIGGERED';

export type Build3RecommendationResult='HIT'|'LOSS'|'MISS'|null;

export type Build3RecommendationEfficacy={
  scoring_version:typeof BUILD3_EFFICACY_SCORING_VERSION;
  entry_triggered:boolean;
  target_hit:boolean;
  sl_hit:boolean;
  lifecycle_complete:boolean;
  classification:Build3RecommendationClassification;
  conservative_result:Build3RecommendationResult;
  liberal_result:Build3RecommendationResult;
  finalized_triggered:boolean;
};

export function scoreBuild3RecommendationEfficacy(input:{
  entry_triggered:boolean;
  target_hit:boolean;
  sl_hit:boolean;
  lifecycle_complete:boolean;
}):Build3RecommendationEfficacy{
  const {entry_triggered,target_hit,sl_hit,lifecycle_complete}=input;
  if(!entry_triggered){
    return {
      scoring_version:BUILD3_EFFICACY_SCORING_VERSION,
      entry_triggered,target_hit:false,sl_hit:false,lifecycle_complete,
      classification:'UNTRIGGERED',
      conservative_result:null,liberal_result:null,finalized_triggered:false,
    };
  }
  if(target_hit&&sl_hit){
    return {
      scoring_version:BUILD3_EFFICACY_SCORING_VERSION,
      entry_triggered,target_hit,sl_hit,lifecycle_complete,
      classification:'DUAL_TOUCH',
      conservative_result:'LOSS',liberal_result:'HIT',finalized_triggered:true,
    };
  }
  if(target_hit){
    return {
      scoring_version:BUILD3_EFFICACY_SCORING_VERSION,
      entry_triggered,target_hit,sl_hit:false,lifecycle_complete,
      classification:'TARGET_ONLY',
      conservative_result:'HIT',liberal_result:'HIT',finalized_triggered:true,
    };
  }
  if(sl_hit){
    return {
      scoring_version:BUILD3_EFFICACY_SCORING_VERSION,
      entry_triggered,target_hit:false,sl_hit,lifecycle_complete,
      classification:'SL_ONLY',
      conservative_result:'LOSS',liberal_result:'LOSS',finalized_triggered:true,
    };
  }
  if(!lifecycle_complete){
    return {
      scoring_version:BUILD3_EFFICACY_SCORING_VERSION,
      entry_triggered,target_hit:false,sl_hit:false,lifecycle_complete,
      classification:'OPEN',
      conservative_result:null,liberal_result:null,finalized_triggered:false,
    };
  }
  return {
    scoring_version:BUILD3_EFFICACY_SCORING_VERSION,
    entry_triggered,target_hit:false,sl_hit:false,lifecycle_complete,
    classification:'TIMEOUT_NO_TARGET',
    conservative_result:'MISS',liberal_result:'MISS',finalized_triggered:true,
  };
}

const percent=(n:number,d:number)=>d?Number((n/d*100).toFixed(4)):null;

export type Build3RecommendationEfficacySummary={
  total_observations:number;
  finalized_triggered:number;
  open:number;
  untriggered:number;
  target_only:number;
  sl_only:number;
  dual_touch:number;
  timeout_no_target:number;
  conservative_hit_rate_pct:number|null;
  liberal_hit_rate_pct:number|null;
  hit_rate_gap_pct:number|null;
  conservative_loss_miss_pct:number|null;
  liberal_loss_miss_pct:number|null;
  sl_only_pct:number|null;
  dual_touch_pct:number|null;
  timeout_no_target_pct:number|null;
  conservative_loss_contribution:{
    sl_only_pct:number|null;
    dual_touch_pct:number|null;
    timeout_no_target_pct:number|null;
  };
};

export function summarizeBuild3RecommendationEfficacy(
  rows:Build3RecommendationEfficacy[],
):Build3RecommendationEfficacySummary{
  const finalized=rows.filter(row=>row.finalized_triggered);
  const count=(c:Build3RecommendationClassification)=>rows.filter(row=>row.classification===c).length;
  const targetOnly=count('TARGET_ONLY');
  const slOnly=count('SL_ONLY');
  const dual=count('DUAL_TOUCH');
  const timeout=count('TIMEOUT_NO_TARGET');
  const d=finalized.length;
  const conservativeHits=finalized.filter(row=>row.conservative_result==='HIT').length;
  const liberalHits=finalized.filter(row=>row.liberal_result==='HIT').length;
  const conservativeFailures=d-conservativeHits;
  const liberalFailures=d-liberalHits;
  const conservative=percent(conservativeHits,d);
  const liberal=percent(liberalHits,d);
  return {
    total_observations:rows.length,
    finalized_triggered:d,
    open:count('OPEN'),
    untriggered:count('UNTRIGGERED'),
    target_only:targetOnly,
    sl_only:slOnly,
    dual_touch:dual,
    timeout_no_target:timeout,
    conservative_hit_rate_pct:conservative,
    liberal_hit_rate_pct:liberal,
    hit_rate_gap_pct:conservative===null||liberal===null?null:Number((liberal-conservative).toFixed(4)),
    conservative_loss_miss_pct:percent(conservativeFailures,d),
    liberal_loss_miss_pct:percent(liberalFailures,d),
    sl_only_pct:percent(slOnly,d),
    dual_touch_pct:percent(dual,d),
    timeout_no_target_pct:percent(timeout,d),
    conservative_loss_contribution:{
      sl_only_pct:percent(slOnly,conservativeFailures),
      dual_touch_pct:percent(dual,conservativeFailures),
      timeout_no_target_pct:percent(timeout,conservativeFailures),
    },
  };
}
