export type JsonRecord = Record<string, unknown>;

// Only evidence required to calculate a new 5DR forecast belongs upstream.
// Forecast/recommendation assessments and ledger completion are downstream lifecycle
// outputs and must never be fabricated to make a run executable.
export const REQUIRED_5DR_INPUTS = [
  'regime', 'component_scores', 'market_trust_inputs', 'event_shock',
  'event_transmission', 'convexity_warranted',
  'execution_inputs', 'data_adequate', 'event_kill_switch', 'expected_rr',
  'horizon_slots'
] as const;

const COMPONENT_SCORE_KEYS=['PRICE_STRUCTURE','PVPO','PARTICIPATION','MACRO_CATALYSTS'] as const;
const MARKET_TRUST_KEYS=['price_confirmation','pvpo_confirmation','participation_confirmation','cross_engine_consistency','closing_confirmation','evidence_freshness_completeness'] as const;
const EXECUTION_KEYS=['rr_score','premium_iv_theta_score','strike_expiry_fit_score','liquidity_spread_score','entry_invalidation_score'] as const;
const HORIZON_KEYS=['D+1','D+2','D+3','D+4','D+5'] as const;
const REGIMES=new Set(['TREND','RANGE','TRANSITION','EVENT_SHOCK']);
const EVENT_SHOCK_LEVELS=new Set(['LOW','MODERATE','HIGH','EXTREME']);
const EVENT_TRANSMISSIONS=new Set(['BULLISH','BEARISH','TWO_SIDED']);
const HORIZON_DIRECTIONS=new Set(['BULLISH','RANGE','BEARISH']);
const SCENARIO_KEYS=['BULL','RANGE','BEAR'] as const;

export const isObject = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const canonicalize=(value:unknown):unknown=>{
  if(Array.isArray(value))return value.map(canonicalize);
  if(isObject(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalize(value[key])]));
  return value;
};

export const jsonEquivalent=(a:unknown,b:unknown):boolean=>
  JSON.stringify(canonicalize(a))===JSON.stringify(canonicalize(b));

const isFiniteNumber=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const exactKeys=(value:JsonRecord,keys:readonly string[])=>Object.keys(value).length===keys.length&&keys.every(key=>key in value);
const boundedObject=(value:unknown,keys:readonly string[],min:number,max:number):boolean=>isObject(value)&&exactKeys(value,keys)&&keys.every(key=>isFiniteNumber(value[key])&&Number(value[key])>=min&&Number(value[key])<=max);

export function validateNormalizedInput(key:string,value:unknown):string[]{
  switch(key){
    case 'regime': return typeof value==='string'&&REGIMES.has(value)?[]:['regime must be TREND, RANGE, TRANSITION or EVENT_SHOCK'];
    case 'component_scores': return boundedObject(value,COMPONENT_SCORE_KEYS,-100,100)?[]:['component_scores must contain exactly PRICE_STRUCTURE, PVPO, PARTICIPATION and MACRO_CATALYSTS values in -100..100'];
    case 'market_trust_inputs': return boundedObject(value,MARKET_TRUST_KEYS,0,100)?[]:['market_trust_inputs must contain exactly the six governed Market Trust inputs in 0..100'];
    case 'event_shock': return typeof value==='string'&&EVENT_SHOCK_LEVELS.has(value)?[]:['event_shock must be LOW, MODERATE, HIGH or EXTREME'];
    case 'event_transmission': return typeof value==='string'&&EVENT_TRANSMISSIONS.has(value)?[]:['event_transmission must be BULLISH, BEARISH or TWO_SIDED'];
    case 'convexity_warranted': return typeof value==='boolean'?[]:['convexity_warranted must be boolean'];
    case 'execution_inputs': return boundedObject(value,EXECUTION_KEYS,0,100)?[]:['execution_inputs must contain exactly the five governed Execution Edge inputs in 0..100'];
    case 'data_adequate': return typeof value==='boolean'?[]:['data_adequate must be boolean'];
    case 'event_kill_switch': return typeof value==='boolean'?[]:['event_kill_switch must be boolean'];
    case 'expected_rr': return isFiniteNumber(value)&&value>=0?[]:['expected_rr must be a finite non-negative number'];
    case 'horizon_slots': {
      if(!isObject(value)||!exactKeys(value,HORIZON_KEYS))return ['horizon_slots must contain exactly D+1, D+2, D+3, D+4 and D+5'];
      const errors:string[]=[];
      for(const horizon of HORIZON_KEYS){
        const slot=value[horizon];
        if(!isObject(slot)){errors.push(`horizon_slots.${horizon} must be an object`);continue}
        if(typeof slot.direction!=='string'||!HORIZON_DIRECTIONS.has(slot.direction))errors.push(`horizon_slots.${horizon}.direction must be BULLISH, RANGE or BEARISH`);
        const probabilities=slot.probabilities;
        if(!isObject(probabilities)||!exactKeys(probabilities,SCENARIO_KEYS)){
          errors.push(`horizon_slots.${horizon}.probabilities must contain exactly BULL, RANGE and BEAR`);
        }else{
          for(const scenario of SCENARIO_KEYS)if(!isFiniteNumber(probabilities[scenario])||Number(probabilities[scenario])<0||Number(probabilities[scenario])>100)errors.push(`horizon_slots.${horizon}.probabilities.${scenario} must be 0..100`);
          if(SCENARIO_KEYS.every(scenario=>isFiniteNumber(probabilities[scenario]))){
            const sum=SCENARIO_KEYS.reduce((acc,scenario)=>acc+Number(probabilities[scenario]),0);
            if(Math.abs(sum-100)>0.02)errors.push(`horizon_slots.${horizon}.probabilities must sum to 100 within 0.02`);
            const selectedKey=slot.direction==='BULLISH'?'BULL':slot.direction==='BEARISH'?'BEAR':'RANGE';
            const selected=Number(probabilities[selectedKey]);
            const maximum=Math.max(...SCENARIO_KEYS.map(scenario=>Number(probabilities[scenario])));
            if(Math.abs(selected-maximum)>0.02)errors.push(`horizon_slots.${horizon}.direction must match the highest scenario probability`);
          }
        }
        if(!isFiniteNumber(slot.zone_low)||!isFiniteNumber(slot.zone_high)||Number(slot.zone_low)<=0||Number(slot.zone_high)<Number(slot.zone_low))errors.push(`horizon_slots.${horizon} must contain positive zone_low <= zone_high`);
        if(!isNonEmptyString(slot.basis))errors.push(`horizon_slots.${horizon}.basis is mandatory`);
      }
      return errors;
    }
    default:return [`unsupported normalized input ${key}`];
  }
}

export function validateNormalizedEvidence(body: unknown): string[] {
  if (!isObject(body) || !Array.isArray(body.evidence)) return ['evidence must be an array'];
  if (!body.evidence.length) return ['at least one normalized evidence item is required'];
  if (body.evidence.length > 20) return ['maximum 20 normalized evidence items'];
  const errors: string[] = [];
  body.evidence.forEach((item, index) => {
    if (!isObject(item)) { errors.push(`evidence[${index}] must be an object`); return; }
    if (!isNonEmptyString(item.evidence_type)) errors.push(`evidence[${index}].evidence_type is mandatory`);
    if (!isNonEmptyString(item.source_ref)) errors.push(`evidence[${index}].source_ref is mandatory`);
    if (item.captured_at !== undefined && item.captured_at !== null &&
      (!isNonEmptyString(item.captured_at) || Number.isNaN(Date.parse(item.captured_at)))) {
      errors.push(`evidence[${index}].captured_at must be a valid ISO timestamp`);
    }
    if (!isObject(item.normalized) || Object.keys(item.normalized).length === 0) {
      errors.push(`evidence[${index}].normalized must be a non-empty object`);
      return;
    }
    for(const [key,value] of Object.entries(item.normalized)){
      for(const detail of validateNormalizedInput(key,value))errors.push(`evidence[${index}].normalized.${key}: ${detail}`);
    }
  });
  return errors;
}

export function assessCompleteness(evidence: unknown[]): { missing: string[]; conflicts: string[] } {
  const seen = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const item of evidence) {
    if (!isObject(item) || !isObject(item.normalized)) continue;
    for (const [key, value] of Object.entries(item.normalized)) {
      if (!REQUIRED_5DR_INPUTS.includes(key as typeof REQUIRED_5DR_INPUTS[number])) continue;
      const encoded = JSON.stringify(value);
      if (seen.has(key) && seen.get(key) !== encoded) conflicts.add(key);
      else seen.set(key, encoded);
    }
  }
  return { missing: REQUIRED_5DR_INPUTS.filter(key => !seen.has(key)), conflicts: [...conflicts] };
}
