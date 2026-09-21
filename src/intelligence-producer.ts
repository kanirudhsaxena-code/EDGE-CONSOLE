import { VISION_MODEL } from './vision-producer';
import { validateNormalizedInput, type JsonRecord } from './normalization';

export const INTELLIGENCE_MODEL=VISION_MODEL;

type AiBinding={run:(model:string,input:Record<string,unknown>)=>Promise<unknown>};
type RawScore=-2|-1|0|1|2;
type Verification='VERIFIED'|'DEGRADED'|'UNAVAILABLE';

const RAW_VALUES=new Set([-2,-1,0,1,2]);
const REGIMES=new Set(['TREND','RANGE','TRANSITION','EVENT_SHOCK']);
const EVENT_LEVELS=new Set(['LOW','MODERATE','HIGH','EXTREME']);
const HORIZONS=['D+1','D+2','D+3','D+4','D+5'] as const;
const HORIZON_DIRECTIONS=new Set(['BULLISH','RANGE','BEARISH']);

const DIRECTIONAL_SCHEMA={
  PRICE_STRUCTURE:{daily_1h_structure:40,key_level_acceptance_rejection:25,volume_confirmation:20,persistence_close:15},
  PVPO:{price_futures_basis:30,volume_participation:20,premium_behaviour:25,oi_structure_change:25},
  PARTICIPATION:{heavyweight_contribution:45,sector_leadership_breadth:35,institutional_cash_participation:20},
  MACRO_CATALYSTS:{global_risk_environment:35,india_macro_rbi_inr_rates:25,crude_commodities_geopolitics:25,scheduled_high_impact_catalysts:15}
} as const;

export type IntelligenceJudgment={
  verification:Verification;
  source_refs:string[];
  regime:'TREND'|'RANGE'|'TRANSITION'|'EVENT_SHOCK';
  directional_raw:{
    PRICE_STRUCTURE:{daily_1h_structure:RawScore;key_level_acceptance_rejection:RawScore;volume_confirmation:RawScore;persistence_close:RawScore};
    PVPO:{price_futures_basis:RawScore;volume_participation:RawScore;premium_behaviour:RawScore;oi_structure_change:RawScore};
    PARTICIPATION:{heavyweight_contribution:RawScore;sector_leadership_breadth:RawScore;institutional_cash_participation:RawScore};
    MACRO_CATALYSTS:{global_risk_environment:RawScore;india_macro_rbi_inr_rates:RawScore;crude_commodities_geopolitics:RawScore;scheduled_high_impact_catalysts:RawScore};
  };
  market_trust_inputs:{price_confirmation:number;pvpo_confirmation:number;participation_confirmation:number;cross_engine_consistency:number;closing_confirmation:number;evidence_freshness_completeness:number};
  event_shock:'LOW'|'MODERATE'|'HIGH'|'EXTREME';
  execution_inputs:{rr_score:number;premium_iv_theta_score:number;strike_expiry_fit_score:number;liquidity_spread_score:number;entry_invalidation_score:number};
  data_adequate:boolean;
  expected_rr:number;
  horizon_slots:Record<(typeof HORIZONS)[number],JsonRecord>;
  limitations:string[];
};

const isObject=(v:unknown):v is JsonRecord=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const exactKeys=(value:JsonRecord,keys:readonly string[])=>Object.keys(value).length===keys.length&&keys.every(k=>k in value);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);

function parseJsonText(text:string):unknown{
  const trimmed=text.trim();
  const candidates=[trimmed];
  const fenced=trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if(fenced?.[1])candidates.push(fenced[1].trim());
  const first=trimmed.indexOf('{'),last=trimmed.lastIndexOf('}');
  if(first>=0&&last>first)candidates.push(trimmed.slice(first,last+1));
  for(const candidate of candidates){try{return JSON.parse(candidate)}catch{}}
  return null;
}

function parseMessage(value:unknown):unknown{
  if(!isObject(value))return null;
  if(typeof value.content==='string'){
    const parsed=parseJsonText(value.content);
    if(parsed)return parsed;
  }
  return null;
}

function parseJson(raw:unknown):unknown{
  if(typeof raw==='string')return parseJsonText(raw);
  if(!isObject(raw))return null;
  if('verification' in raw&&'source_refs' in raw&&'directional_raw' in raw)return raw;
  if(Array.isArray(raw.choices)){
    for(const choice of raw.choices){
      if(!isObject(choice))continue;
      const parsed=parseMessage(choice.message);
      if(parsed)return parsed;
    }
  }
  for(const key of ['response','result'] as const){
    const nested=raw[key];
    if(isObject(nested)){
      if('verification' in nested&&'source_refs' in nested&&'directional_raw' in nested)return nested;
      if(Array.isArray(nested.choices)){
        for(const choice of nested.choices){
          if(!isObject(choice))continue;
          const parsed=parseMessage(choice.message);
          if(parsed)return parsed;
        }
      }
    }
    if(typeof nested==='string'){
      const parsed=parseJsonText(nested);
      if(parsed)return parsed;
    }
  }
  return null;
}

function validateRawGroup(value:unknown,schema:Record<string,number>,path:string,errors:string[]){
  if(!isObject(value)||!exactKeys(value,Object.keys(schema))){errors.push(`${path} must contain exactly the governed subcomponents`);return}
  for(const key of Object.keys(schema))if(!finite(value[key])||!RAW_VALUES.has(Number(value[key])))errors.push(`${path}.${key} must be one of -2,-1,0,1,2`);
}

export function validateIntelligenceJudgment(raw:unknown,allowedSourceRefs:Set<string>):{judgment:IntelligenceJudgment|null;errors:string[]}{
  if(!isObject(raw))return {judgment:null,errors:['judgment must be an object']};
  const errors:string[]=[];
  if(!['VERIFIED','DEGRADED','UNAVAILABLE'].includes(String(raw.verification)))errors.push('verification is invalid');
  if(!Array.isArray(raw.source_refs)||raw.source_refs.some(ref=>typeof ref!=='string'||!allowedSourceRefs.has(ref)))errors.push('source_refs must only contain supplied evidence references');
  if(typeof raw.regime!=='string'||!REGIMES.has(raw.regime))errors.push('regime is invalid');
  if(!isObject(raw.directional_raw))errors.push('directional_raw is mandatory');
  else for(const [engine,schema] of Object.entries(DIRECTIONAL_SCHEMA))validateRawGroup(raw.directional_raw[engine],schema,`directional_raw.${engine}`,errors);
  for(const detail of validateNormalizedInput('market_trust_inputs',raw.market_trust_inputs))errors.push(detail);
  if(typeof raw.event_shock!=='string'||!EVENT_LEVELS.has(raw.event_shock))errors.push('event_shock is invalid');
  for(const detail of validateNormalizedInput('execution_inputs',raw.execution_inputs))errors.push(detail);
  if(typeof raw.data_adequate!=='boolean')errors.push('data_adequate must be boolean');
  if(!finite(raw.expected_rr)||raw.expected_rr<0)errors.push('expected_rr must be a finite non-negative number');
  for(const detail of validateNormalizedInput('horizon_slots',raw.horizon_slots))errors.push(detail);
  if(isObject(raw.horizon_slots)){
    for(const horizon of HORIZONS){
      const slot=raw.horizon_slots[horizon];
      if(!isObject(slot))continue;
      const keys=Object.keys(slot);
      if(!keys.length){
        if(raw.verification!=='UNAVAILABLE')errors.push(`horizon_slots.${horizon} must contain a day-wise forecast whenever a forecast is publishable`);
        continue;
      }
      const direction=slot.direction;
      const probability=slot.probability;
      const low=slot.zone_low;
      const high=slot.zone_high;
      if(typeof direction!=='string'||!HORIZON_DIRECTIONS.has(direction))errors.push(`horizon_slots.${horizon}.direction must be BULLISH, RANGE or BEARISH`);
      if(!finite(probability)||probability<0||probability>100)errors.push(`horizon_slots.${horizon}.probability must be 0..100`);
      if(!finite(low)||!finite(high)||low<=0||high<=0||high<low)errors.push(`horizon_slots.${horizon} must contain a valid positive zone_low <= zone_high`);
      if(slot.basis!==undefined&&typeof slot.basis!=='string')errors.push(`horizon_slots.${horizon}.basis must be text when present`);
    }
  }
  if(!Array.isArray(raw.limitations)||raw.limitations.some(v=>typeof v!=='string'))errors.push('limitations must be a string array');
  if(raw.verification==='UNAVAILABLE'&&raw.data_adequate===true)errors.push('UNAVAILABLE judgment cannot assert data_adequate=true');
  return {judgment:errors.length?null:raw as unknown as IntelligenceJudgment,errors};
}

const normalizedRaw=(raw:number)=>raw===2?1:raw===1?.5:raw===-1?-.5:raw===-2?-1:0;
function weightedScore(values:JsonRecord,weights:Record<string,number>):number{
  let total=0;for(const [key,weight] of Object.entries(weights))total+=(weight/100)*normalizedRaw(Number(values[key]));
  return Math.round(total*100000)/1000;
}

export function normalizeIntelligenceJudgment(judgment:IntelligenceJudgment):JsonRecord{
  const component_scores:JsonRecord={};
  for(const [engine,weights] of Object.entries(DIRECTIONAL_SCHEMA))component_scores[engine]=weightedScore((judgment.directional_raw as unknown as JsonRecord)[engine] as JsonRecord,weights as unknown as Record<string,number>);
  const normalized:JsonRecord={
    regime:judgment.regime,
    component_scores,
    market_trust_inputs:judgment.market_trust_inputs,
    event_shock:judgment.event_shock,
    execution_inputs:judgment.execution_inputs,
    data_adequate:judgment.data_adequate,
    event_kill_switch:judgment.event_shock==='EXTREME',
    expected_rr:judgment.expected_rr,
    horizon_slots:judgment.horizon_slots
  };
  for(const [key,value] of Object.entries(normalized)){
    const errors=validateNormalizedInput(key,value);if(errors.length)throw new Error(`INTELLIGENCE_NORMALIZATION_INVALID:${key}:${errors.join('|')}`);
  }
  return normalized;
}

const prompt=(packet:unknown)=>`You are the governed intelligence reconciliation layer for the frozen 5DR V2.2.3 methodology. You are NOT the deterministic 5DR engine. Use only the supplied market observations (automated structured evidence or screenshot fallback) and system-research snapshots. Never invent a missing fact and never cite a source_ref not present in the packet. If critical evidence is absent or ambiguous, mark verification DEGRADED or UNAVAILABLE and set data_adequate=false. Do not output the FINAL overall five-day forecast/probability, trade recommendation, DES5, Market Trust score or Execution Edge score; those are deterministic downstream outputs. You MUST, however, produce the governed D+1 through D+5 forecast PATH in horizon_slots because those slots are required forecast-path inputs and do not determine DES5. IMPORTANT: source_refs must include at least one supplied evidence reference from EACH required family in the packet: PRICE_TECHNICALS, DERIVATIVES_OI, MARKET_TRUST, EVENT_SHOCK, and EXECUTION_RISK. You may cite multiple refs per family when useful.\n\nApply these frozen raw-score semantics inside each directional subcomponent only: +2 strong bullish, +1 bullish, 0 neutral/balanced, -1 bearish, -2 strong bearish. OI alone cannot create direction. PRICE→VOLUME→PREMIUM→OI is mandatory for PVPO. Execution factors affect tradeability only, not direction. Event Shock levels are LOW/MODERATE/HIGH/EXTREME; EXTREME is the governed kill-switch state and is derived later by code. For MACRO_CATALYSTS, actively interpret every supplied official macro fact and relevant retrieved text on global policy/risk, the latest FOMC decision, RBI policy rates, INR/rates, crude/commodities/geopolitics and scheduled high-impact events. Do not compress material macro evidence into a generic neutral/supportive label. A fresh Fed hike/tightening is an adverse global-liquidity/risk input unless supplied evidence clearly establishes an offset; a large recent rise in WTI/Brent is adverse for India through inflation/import/current-account sensitivity and MUST NOT be scored bullish/supportive merely because crude data was successfully retrieved. INR levels without a comparable baseline are risk context, not invented direction. A recent or upcoming FOMC/MPC event inside the D+1 to D+5 horizon must be reflected in scheduled_high_impact_catalysts. If macro sources conflict with one another, score conservatively and state the conflict in limitations. If a subcomponent truly cannot be determined, score it 0 and name the exact missing or ambiguous fact. Prefer structured research facts when present, but interpret material facts from retrieved text when structured extraction is incomplete. For PARTICIPATION, use official NIFTY 50 advances/declines and available multi-period index performance as real participation evidence; do not score participation_confirmation as zero merely because sector-level breadth is absent if official index breadth is available. For MACRO_CATALYSTS, use structured RBI policy-rate facts and EIA crude facts when present, and distinguish "partially verified" from "not verified". For PRICE_STRUCTURE and PVPO, use the supplied market observations directly. Automated UPSTOX_STRUCTURED observations may expose facts in structured_data and findings; screenshot fallback exposes interpreted findings. Use visible/structured trend, support/resistance, strike-level LTP, OI, change OI, volume, IV, Greeks and bid/ask evidence when supplied. Do not claim fields are missing when they are present in either evidence form.\n\nReturn JSON only with exactly: {"verification":"VERIFIED|DEGRADED|UNAVAILABLE","source_refs":["only refs supplied"],"regime":"TREND|RANGE|TRANSITION|EVENT_SHOCK","directional_raw":{"PRICE_STRUCTURE":{"daily_1h_structure":0,"key_level_acceptance_rejection":0,"volume_confirmation":0,"persistence_close":0},"PVPO":{"price_futures_basis":0,"volume_participation":0,"premium_behaviour":0,"oi_structure_change":0},"PARTICIPATION":{"heavyweight_contribution":0,"sector_leadership_breadth":0,"institutional_cash_participation":0},"MACRO_CATALYSTS":{"global_risk_environment":0,"india_macro_rbi_inr_rates":0,"crude_commodities_geopolitics":0,"scheduled_high_impact_catalysts":0}},"market_trust_inputs":{"price_confirmation":0,"pvpo_confirmation":0,"participation_confirmation":0,"cross_engine_consistency":0,"closing_confirmation":0,"evidence_freshness_completeness":0},"event_shock":"LOW|MODERATE|HIGH|EXTREME","execution_inputs":{"rr_score":0,"premium_iv_theta_score":0,"strike_expiry_fit_score":0,"liquidity_spread_score":0,"entry_invalidation_score":0},"data_adequate":false,"expected_rr":0,"horizon_slots":{"D+1":{"direction":"BULLISH|RANGE|BEARISH","probability":0,"zone_low":0,"zone_high":0,"basis":"brief evidence-grounded path rationale"},"D+2":{"direction":"BULLISH|RANGE|BEARISH","probability":0,"zone_low":0,"zone_high":0,"basis":"brief evidence-grounded path rationale"},"D+3":{"direction":"BULLISH|RANGE|BEARISH","probability":0,"zone_low":0,"zone_high":0,"basis":"brief evidence-grounded path rationale"},"D+4":{"direction":"BULLISH|RANGE|BEARISH","probability":0,"zone_low":0,"zone_high":0,"basis":"brief evidence-grounded path rationale"},"D+5":{"direction":"BULLISH|RANGE|BEARISH","probability":0,"zone_low":0,"zone_high":0,"basis":"brief evidence-grounded path rationale"}},"limitations":["string"]}. Market Trust and Execution input values are 0..100 evidence-quality/execution judgments under the frozen definitions, not final aggregate scores. Horizon slots are the day-wise forecast path and MUST be populated for every publishable VERIFIED or DEGRADED judgment, including NO-TRADE cases. For each D+1..D+5 slot, use the supplied NIFTY spot, multi-timeframe structure, prior ranges/support-resistance and derivatives positioning to state an evidence-grounded session bias, probability and expected NIFTY zone. A NO TRADE decision or weak Execution Edge does not justify empty forecast slots. Widen zones or reduce probability when uncertainty rises. Never fabricate a level that cannot be anchored to supplied price/range/positioning evidence; if the market evidence truly cannot support any five-day path, set verification=UNAVAILABLE and data_adequate=false instead of publishing empty slots.\n\nEvidence packet:\n${JSON.stringify(packet)}`;

export async function produceIntelligence(ai:AiBinding,packet:unknown,allowedSourceRefs:Set<string>):Promise<{judgment:IntelligenceJudgment|null;normalized:JsonRecord|null;errors:string[];model:string}>{
  try{
    const allowed=[...allowedSourceRefs];
    const system='Reconcile evidence under frozen 5DR rules. Output governed JSON only.';
    const userPrompt=prompt(packet)+'\n\nAllowed source_refs (copy EXACTLY, never rewrite):\n'+JSON.stringify(allowed);
    const raw=await ai.run(INTELLIGENCE_MODEL,{messages:[{role:'system',content:system},{role:'user',content:userPrompt}],max_tokens:3200,temperature:0,chat_template_kwargs:{enable_thinking:false}});
    let parsed=parseJson(raw);let validation=validateIntelligenceJudgment(parsed,allowedSourceRefs);
    if(!validation.judgment&&validation.errors.length===1&&validation.errors[0]==='source_refs must only contain supplied evidence references'&&isObject(parsed)){
      const repairPrompt='Your prior JSON was rejected ONLY because source_refs contained a value that was not supplied. Do not change any evidence interpretation, scores, regime, limitations or horizon fields. Return the same JSON with source_refs corrected to use ONLY exact strings from this allowed list. If a family cannot be cited from this list, remove the unsupported claim by degrading verification/data_adequate rather than inventing a ref. Allowed source_refs: '+JSON.stringify(allowed)+'\nPrior JSON:\n'+JSON.stringify(parsed);
      const repairedRaw=await ai.run(INTELLIGENCE_MODEL,{messages:[{role:'system',content:system},{role:'user',content:repairPrompt}],max_tokens:3200,temperature:0,chat_template_kwargs:{enable_thinking:false}});
      parsed=parseJson(repairedRaw);validation=validateIntelligenceJudgment(parsed,allowedSourceRefs);
    }
    if(!validation.judgment&&validation.errors.length>0&&validation.errors.every(error=>error.startsWith('horizon_slots.'))&&isObject(parsed)){
      const repairPrompt='Your prior JSON was rejected because the D+1..D+5 forecast path was incomplete or invalid. Preserve all other evidence interpretation, raw scores, source_refs, regime, event shock, execution inputs and limitations. Using ONLY the supplied evidence packet, populate EACH horizon slot with exactly an evidence-grounded direction (BULLISH|RANGE|BEARISH), probability 0..100, positive numeric zone_low, positive numeric zone_high with zone_high >= zone_low, and a brief basis. NO TRADE or weak execution is not a reason to leave forecast-path slots empty. If the supplied PRICE_TECHNICALS evidence truly cannot support a path, set verification=UNAVAILABLE and data_adequate=false. Evidence packet:\n'+JSON.stringify(packet)+'\nPrior JSON:\n'+JSON.stringify(parsed);
      const repairedRaw=await ai.run(INTELLIGENCE_MODEL,{messages:[{role:'system',content:system},{role:'user',content:repairPrompt}],max_tokens:3200,temperature:0,chat_template_kwargs:{enable_thinking:false}});
      parsed=parseJson(repairedRaw);validation=validateIntelligenceJudgment(parsed,allowedSourceRefs);
    }
    if(!validation.judgment)return {judgment:null,normalized:null,errors:validation.errors.length?validation.errors:['intelligence model returned invalid JSON'],model:INTELLIGENCE_MODEL};
    return {judgment:validation.judgment,normalized:normalizeIntelligenceJudgment(validation.judgment),errors:[],model:INTELLIGENCE_MODEL};
  }catch{return {judgment:null,normalized:null,errors:['intelligence inference unavailable'],model:INTELLIGENCE_MODEL}}
}
