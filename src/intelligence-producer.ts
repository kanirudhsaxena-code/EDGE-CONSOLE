import { VISION_MODEL } from './vision-producer';
import { validateNormalizedInput, type JsonRecord } from './normalization';

export const INTELLIGENCE_MODEL=VISION_MODEL;
export const INTELLIGENCE_FALLBACK_MODEL='@cf/zai-org/glm-4.7-flash';

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
  event_transmission:'BULLISH'|'BEARISH'|'TWO_SIDED';
  convexity_warranted:boolean;
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
  if(!['BULLISH','BEARISH','TWO_SIDED'].includes(String(raw.event_transmission)))errors.push('event_transmission is invalid');
  if(typeof raw.convexity_warranted!=='boolean')errors.push('convexity_warranted must be boolean');
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
      const probabilities=slot.probabilities;
      const low=slot.zone_low;
      const high=slot.zone_high;
      if(typeof direction!=='string'||!HORIZON_DIRECTIONS.has(direction))errors.push(`horizon_slots.${horizon}.direction must be BULLISH, RANGE or BEARISH`);
      if(!isObject(probabilities)){
        errors.push(`horizon_slots.${horizon}.probabilities must contain BULL, RANGE and BEAR`);
      }else{
        const keys=['BULL','RANGE','BEAR'] as const;
        for(const key of keys)if(!finite(probabilities[key])||Number(probabilities[key])<0||Number(probabilities[key])>100)errors.push(`horizon_slots.${horizon}.probabilities.${key} must be 0..100`);
        if(keys.every(key=>finite(probabilities[key]))){
          const sum=keys.reduce((acc,key)=>acc+Number(probabilities[key]),0);
          if(Math.abs(sum-100)>0.02)errors.push(`horizon_slots.${horizon}.probabilities must sum to 100`);
          const directionKey=direction==='BULLISH'?'BULL':direction==='BEARISH'?'BEAR':'RANGE';
          const selected=Number(probabilities[directionKey]);
          const max=Math.max(...keys.map(key=>Number(probabilities[key])));
          if(Math.abs(selected-max)>0.02)errors.push(`horizon_slots.${horizon}.direction must match the highest scenario probability`);
        }
      }
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
    event_transmission:judgment.event_transmission,
    convexity_warranted:judgment.convexity_warranted,
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


export const INTELLIGENCE_DETERMINISTIC_FALLBACK_MODEL='DETERMINISTIC_DEGRADED_V1';

function inferenceCapacityFailure(error:unknown):boolean{
  const message=error instanceof Error?error.message:String(error??'');
  return /\b4006\b|daily free allocation|quota|capacity|rate.?limit|temporar(?:y|ily) unavailable/i.test(message);
}

function numberValue(value:unknown):number|null{
  if(finite(value))return value;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
}

function recordAt(value:unknown,key:string):JsonRecord|null{
  return isObject(value)&&isObject(value[key])?value[key] as JsonRecord:null;
}

function arrayRecords(value:unknown):JsonRecord[]{
  return Array.isArray(value)?value.filter(isObject):[];
}

function marketObservation(packet:unknown,category:string):JsonRecord|null{
  if(!isObject(packet))return null;
  return arrayRecords(packet.market_observations).find(item=>item.category===category)??null;
}

function researchObservation(packet:unknown,category:string):JsonRecord|null{
  if(!isObject(packet))return null;
  return arrayRecords(packet.research).find(item=>item.category===category&&item.status==='RETRIEVED')??null;
}

function sourceRef(item:JsonRecord|null,allowed:Set<string>):string|null{
  const ref=item&&typeof item.source_ref==='string'?item.source_ref:null;
  return ref&&allowed.has(ref)?ref:null;
}

function trendRaw(state:unknown):RawScore{
  const s=String(state??'').toUpperCase();
  if(s.includes('UPTREND'))return 2;
  if(s.includes('DOWNTREND'))return -2;
  return 0;
}

function combineRaw(a:RawScore,b:RawScore):RawScore{
  const total=a+b;
  if(total>=3)return 2;
  if(total>0)return 1;
  if(total<=-3)return -2;
  if(total<0)return -1;
  return 0;
}

function thresholdRaw(value:number|null,soft:number,strong:number,invert=false):RawScore{
  if(value===null)return 0;
  let out:RawScore=0;
  if(value>=strong)out=2;
  else if(value>=soft)out=1;
  else if(value<=-strong)out=-2;
  else if(value<=-soft)out=-1;
  return invert?(out===2?-2:out===1?-1:out===-1?1:out===-2?2:0):out;
}

function average(values:(number|null)[]):number|null{
  const usable=values.filter((v):v is number=>v!==null&&Number.isFinite(v));
  return usable.length?usable.reduce((a,b)=>a+b,0)/usable.length:null;
}

function instrumentChanges(value:unknown):number[]{
  if(!isObject(value)||!isObject(value.instruments))return [];
  return Object.values(value.instruments).filter(isObject)
    .map(row=>numberValue(row.change_pct_vs_previous_close))
    .filter((v):v is number=>v!==null);
}

function rangeForTimeframe(timeframes:JsonRecord,tf:string,spot:number):{low:number;high:number;state:string}|null{
  const row=recordAt(timeframes,tf);
  const range=row?recordAt(row,'range_event'):null;
  const low=numberValue(range?.prior_range_low);
  const high=numberValue(range?.prior_range_high);
  if(low===null||high===null||low<=0||high<low)return null;
  return {low:Math.min(low,spot),high:Math.max(high,spot),state:String(recordAt(row,'trend_structure')?.state??'MIXED_OR_TRANSITION_STRUCTURE')};
}

function scenarioForTrend(raw:RawScore):{direction:'BULLISH'|'RANGE'|'BEARISH';probabilities:{BULL:number;RANGE:number;BEAR:number}}{
  if(raw>0)return {direction:'BULLISH',probabilities:{BULL:45,RANGE:40,BEAR:15}};
  if(raw<0)return {direction:'BEARISH',probabilities:{BULL:15,RANGE:40,BEAR:45}};
  return {direction:'RANGE',probabilities:{BULL:25,RANGE:50,BEAR:25}};
}

function medianNumber(values:number[]):number|null{
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
}

function deterministicDegradedJudgment(packet:unknown,allowedSourceRefs:Set<string>):IntelligenceJudgment|null{
  const price=marketObservation(packet,'PRICE_TECHNICALS');
  const derivatives=marketObservation(packet,'DERIVATIVES_OI');
  const participation=marketObservation(packet,'MARKET_TRUST');
  const execution=marketObservation(packet,'EXECUTION_RISK');
  const event=researchObservation(packet,'EVENT_SHOCK');
  const refs=[
    sourceRef(price,allowedSourceRefs),
    sourceRef(derivatives,allowedSourceRefs),
    sourceRef(participation,allowedSourceRefs),
    sourceRef(event,allowedSourceRefs),
    sourceRef(execution,allowedSourceRefs),
  ];
  if(refs.some(ref=>!ref))return null;

  const priceData=recordAt(price,'structured_data');
  const chart=priceData?recordAt(priceData,'chart'):null;
  const timeframes=chart?recordAt(chart,'timeframes'):null;
  const nifty=priceData?recordAt(priceData,'nifty'):null;
  const spotRow=nifty?recordAt(nifty,'spot'):null;
  const spot=numberValue(spotRow?.last_price)
    ??numberValue(arrayRecords(price?.findings).find(row=>row.label==='Current Price')?.value);
  if(!timeframes||spot===null||spot<=0)return null;

  const daily=recordAt(timeframes,'1d');
  const hourly=recordAt(timeframes,'1h');
  const dailyRaw=trendRaw(recordAt(daily,'trend_structure')?.state);
  const hourlyRaw=trendRaw(recordAt(hourly,'trend_structure')?.state);
  const structureRaw=combineRaw(dailyRaw,hourlyRaw);

  const hourlyRange=hourly?recordAt(hourly,'range_event'):null;
  const closeState=String(hourlyRange?.close_state??'');
  const keyRaw:RawScore=closeState.includes('ABOVE')?1:closeState.includes('BELOW')?-1:0;
  const relativeVolume=numberValue(recordAt(hourly,'volume_confirmation')?.relative_to_median);
  const spotChange=numberValue(spotRow?.change_pct_vs_previous_close);
  const volumeRaw:RawScore=relativeVolume!==null&&relativeVolume>=1.2
    ?thresholdRaw(spotChange,0.15,0.75)
    :0;
  const persistenceRaw=thresholdRaw(spotChange,0.25,1.0);

  const derivData=recordAt(derivatives,'structured_data');
  const futures=derivData?recordAt(derivData,'nifty_futures'):null;
  const analytics=derivData?recordAt(derivData,'derivative_analytics'):null;
  const basisRaw=thresholdRaw(numberValue(futures?.basis_pct_of_spot),0.1,0.5);
  // OI alone is never permitted to create direction; ambiguous premium/volume
  // effects stay neutral in the deterministic fallback.
  const pvpoRaw={price_futures_basis:basisRaw,volume_participation:0 as RawScore,premium_behaviour:0 as RawScore,oi_structure_change:0 as RawScore};

  const participationData=recordAt(participation,'structured_data');
  const heavyweightChanges=instrumentChanges(participationData?.heavyweights);
  const sectorChanges=instrumentChanges(participationData?.sectors);
  const heavyweightRaw=thresholdRaw(average(heavyweightChanges),0.2,0.8);
  const sectorRaw=thresholdRaw(average(sectorChanges),0.15,0.6);
  const cash=participationData?recordAt(participationData,'fii_dii_cash'):null;
  const fii=cash?recordAt(cash,'fii'):null;
  const dii=cash?recordAt(cash,'dii'):null;
  const fiiNet=fii&&numberValue(fii.buy_amount)!==null&&numberValue(fii.sell_amount)!==null
    ?Number(fii.buy_amount)-Number(fii.sell_amount):null;
  const diiNet=dii&&numberValue(dii.buy_amount)!==null&&numberValue(dii.sell_amount)!==null
    ?Number(dii.buy_amount)-Number(dii.sell_amount):null;
  let institutionalRaw:RawScore=0;
  if(fiiNet!==null&&diiNet!==null){
    if(fiiNet>0&&diiNet>0)institutionalRaw=2;
    else if(fiiNet<0&&diiNet<0)institutionalRaw=-2;
    else institutionalRaw=thresholdRaw(fiiNet+diiNet,1000,7500);
  }

  const globalChanges=instrumentChanges(participationData?.global_risk);
  const globalRaw=thresholdRaw(average(globalChanges),0.2,0.8);
  let crudeMove:number|null=null;
  if(isObject(packet)){
    const moves:number[]=[];
    for(const item of arrayRecords(packet.research)){
      if(item.status!=='RETRIEVED'||!isObject(item.facts))continue;
      for(const key of ['wti_usd_per_barrel','brent_usd_per_barrel']){
        const fact=recordAt(item.facts,key),change=numberValue(fact?.change_from_first);
        if(change!==null)moves.push(change);
      }
    }
    crudeMove=average(moves);
  }
  const crudeRaw=thresholdRaw(crudeMove,2,5,true);

  const sameSign=(a:number,b:number)=>a!==0&&b!==0&&Math.sign(a)===Math.sign(b);
  const opposite=(a:number,b:number)=>a!==0&&b!==0&&Math.sign(a)!==Math.sign(b);
  const pvpoSignal=basisRaw;
  const participationSignal=combineRaw(heavyweightRaw,combineRaw(sectorRaw,institutionalRaw));
  const crossEngineConsistency=sameSign(structureRaw,pvpoSignal)||sameSign(structureRaw,participationSignal)
    ?65:opposite(structureRaw,pvpoSignal)||opposite(structureRaw,participationSignal)?35:50;

  const execData=recordAt(execution,'structured_data');
  const strikes=arrayRecords(execData?.sample_strikes);
  const spreads:number[]=[];
  let ivThetaRows=0;
  for(const strike of strikes){
    for(const side of ['CE','PE']){
      const leg=recordAt(strike,side);
      const spread=numberValue(leg?.bid_ask_spread_pct_mid);
      if(spread!==null)spreads.push(spread);
      if(numberValue(leg?.iv)!==null&&numberValue(leg?.theta)!==null)ivThetaRows++;
    }
  }
  const medianSpread=medianNumber(spreads);
  const liquidityScore=medianSpread===null?30:medianSpread<=0.5?90:medianSpread<=1?80:medianSpread<=1.5?65:medianSpread<=2.5?45:25;
  const selectedExpiry=typeof execData?.selected_expiry==='string'&&execData.selected_expiry?true:false;
  const hasRange=!!rangeForTimeframe(timeframes,'1h',spot);

  const horizonDefs:[string,string][]=[
    ['D+1','15m'],['D+2','30m'],['D+3','1h'],['D+4','1d'],['D+5','1d']
  ];
  const dailyRange=rangeForTimeframe(timeframes,'1d',spot);
  const hourlyEvidenceRange=rangeForTimeframe(timeframes,'1h',spot);
  if(!dailyRange&&!hourlyEvidenceRange)return null;
  const horizon_slots={} as Record<(typeof HORIZONS)[number],JsonRecord>;
  for(const [horizon,tf] of horizonDefs){
    const tfRow=recordAt(timeframes,tf);
    const trend=trendRaw(recordAt(tfRow,'trend_structure')?.state);
    const scenario=scenarioForTrend(trend);
    const range=rangeForTimeframe(timeframes,tf,spot)??(tf==='1d'?dailyRange:hourlyEvidenceRange)??dailyRange;
    if(!range)return null;
    horizon_slots[horizon as (typeof HORIZONS)[number]]={
      direction:scenario.direction,
      probabilities:scenario.probabilities,
      zone_low:range.low,
      zone_high:range.high,
      basis:`Deterministic degraded fallback: ${tf} ${range.state}; zone uses supplied prior-range bounds plus current spot only.`,
    };
  }

  const regime:'TREND'|'RANGE'|'TRANSITION'=
    dailyRaw!==0&&hourlyRaw!==0&&Math.sign(dailyRaw)===Math.sign(hourlyRaw)?'TREND':
    dailyRaw!==0&&hourlyRaw!==0&&Math.sign(dailyRaw)!==Math.sign(hourlyRaw)?'TRANSITION':'RANGE';

  return {
    verification:'DEGRADED',
    source_refs:refs as string[],
    regime,
    directional_raw:{
      PRICE_STRUCTURE:{
        daily_1h_structure:structureRaw,
        key_level_acceptance_rejection:keyRaw,
        volume_confirmation:volumeRaw,
        persistence_close:persistenceRaw,
      },
      PVPO:pvpoRaw,
      PARTICIPATION:{
        heavyweight_contribution:heavyweightRaw,
        sector_leadership_breadth:sectorRaw,
        institutional_cash_participation:institutionalRaw,
      },
      MACRO_CATALYSTS:{
        global_risk_environment:globalRaw,
        india_macro_rbi_inr_rates:0,
        crude_commodities_geopolitics:crudeRaw,
        scheduled_high_impact_catalysts:0,
      },
    },
    market_trust_inputs:{
      price_confirmation:daily&&hourly?65:45,
      pvpo_confirmation:numberValue(futures?.basis_pct_of_spot)!==null&&numberValue(recordAt(analytics,'pcr')?.pcr)!==null?65:45,
      participation_confirmation:heavyweightChanges.length&&sectorChanges.length&&fiiNet!==null&&diiNet!==null?65:45,
      cross_engine_consistency:crossEngineConsistency,
      closing_confirmation:spotChange!==null?70:45,
      evidence_freshness_completeness:80,
    },
    event_shock:'MODERATE',
    event_transmission:'TWO_SIDED',
    convexity_warranted:false,
    execution_inputs:{
      rr_score:0,
      premium_iv_theta_score:ivThetaRows>=4?60:ivThetaRows?45:25,
      strike_expiry_fit_score:selectedExpiry&&strikes.length>=3?65:selectedExpiry?45:25,
      liquidity_spread_score:liquidityScore,
      entry_invalidation_score:hasRange?60:30,
    },
    data_adequate:false,
    expected_rr:0,
    horizon_slots,
    limitations:[
      'Workers AI inference capacity was unavailable; deterministic degraded reconciliation was used.',
      'Fallback uses only supplied structured evidence and exact supplied source references.',
      'Ambiguous directional components remain neutral rather than being inferred.',
      'Event shock is conservatively MODERATE/TWO_SIDED because the fallback does not semantically infer absence of event risk.',
      'data_adequate=false and expected_rr=0 prevent the degraded fallback from qualifying a trade on its own.',
    ],
  };
}

function inferenceErrorLabel(error:unknown):string{
  const raw=error instanceof Error?error.message:String(error??'unknown');
  return raw.replace(/\s+/g,' ').slice(0,240);
}

async function runGovernedInference(ai:AiBinding,input:Record<string,unknown>):Promise<{raw:unknown;model:string}>{
  const failures:string[]=[];
  for(const model of [INTELLIGENCE_MODEL,INTELLIGENCE_FALLBACK_MODEL]){
    try{
      return {raw:await ai.run(model,input),model};
    }catch(error){
      failures.push(`${model}:${inferenceErrorLabel(error)}`);
    }
  }
  throw new Error(`all governed intelligence inference models unavailable: ${failures.join(' | ')}`);
}

const prompt=(packet:unknown)=>`You are the governed intelligence reconciliation layer for the frozen 5DR V2.2.3 methodology. You are NOT the deterministic 5DR engine. Use only the supplied market observations (automated structured evidence or screenshot fallback) and system-research snapshots. Never invent a missing fact and never cite a source_ref not present in the packet. If critical evidence is absent or ambiguous, mark verification DEGRADED or UNAVAILABLE and set data_adequate=false. Do not output the FINAL overall five-day forecast/probability, trade recommendation, DES5, Market Trust score or Execution Edge score; those are deterministic downstream outputs. You MUST, however, produce the governed D+1 through D+5 forecast PATH in horizon_slots because those slots are required forecast-path inputs and do not determine DES5. IMPORTANT: source_refs must include at least one supplied evidence reference from EACH required family in the packet: PRICE_TECHNICALS, DERIVATIVES_OI, MARKET_TRUST, EVENT_SHOCK, and EXECUTION_RISK. You may cite multiple refs per family when useful.\n\nApply these frozen raw-score semantics inside each directional subcomponent only: +2 strong bullish, +1 bullish, 0 neutral/balanced, -1 bearish, -2 strong bearish. OI alone cannot create direction. PRICE→VOLUME→PREMIUM→OI is mandatory for PVPO. Execution factors affect tradeability only, not direction. Event Shock levels are LOW/MODERATE/HIGH/EXTREME; EXTREME is the governed kill-switch state and is derived later by code. For MACRO_CATALYSTS, actively interpret every supplied official macro fact and relevant retrieved text on global policy/risk, the latest FOMC decision, RBI policy rates, INR/rates, crude/commodities/geopolitics and scheduled high-impact events. Do not compress material macro evidence into a generic neutral/supportive label. A fresh Fed hike/tightening is an adverse global-liquidity/risk input unless supplied evidence clearly establishes an offset; a large recent rise in WTI/Brent is adverse for India through inflation/import/current-account sensitivity and MUST NOT be scored bullish/supportive merely because crude data was successfully retrieved. INR levels without a comparable baseline are risk context, not invented direction. A recent or upcoming FOMC/MPC event inside the D+1 to D+5 horizon must be reflected in scheduled_high_impact_catalysts. If macro sources conflict with one another, score conservatively and state the conflict in limitations. If a subcomponent truly cannot be determined, score it 0 and name the exact missing or ambiguous fact. Prefer structured research facts when present, but interpret material facts from retrieved text when structured extraction is incomplete. For PARTICIPATION, use official NIFTY 50 advances/declines and available multi-period index performance as real participation evidence; do not score participation_confirmation as zero merely because sector-level breadth is absent if official index breadth is available. For MACRO_CATALYSTS, use structured RBI policy-rate facts and EIA crude facts when present, and distinguish "partially verified" from "not verified". For PRICE_STRUCTURE and PVPO, use the supplied market observations directly. Automated UPSTOX_STRUCTURED observations may expose facts in structured_data and findings; screenshot fallback exposes interpreted findings. Use visible/structured trend, support/resistance, strike-level LTP, OI, change OI, volume, IV, Greeks and bid/ask evidence when supplied. Do not claim fields are missing when they are present in either evidence form.\n\nReturn JSON only with exactly: {"verification":"VERIFIED|DEGRADED|UNAVAILABLE","source_refs":["only refs supplied"],"regime":"TREND|RANGE|TRANSITION|EVENT_SHOCK","directional_raw":{"PRICE_STRUCTURE":{"daily_1h_structure":0,"key_level_acceptance_rejection":0,"volume_confirmation":0,"persistence_close":0},"PVPO":{"price_futures_basis":0,"volume_participation":0,"premium_behaviour":0,"oi_structure_change":0},"PARTICIPATION":{"heavyweight_contribution":0,"sector_leadership_breadth":0,"institutional_cash_participation":0},"MACRO_CATALYSTS":{"global_risk_environment":0,"india_macro_rbi_inr_rates":0,"crude_commodities_geopolitics":0,"scheduled_high_impact_catalysts":0}},"market_trust_inputs":{"price_confirmation":0,"pvpo_confirmation":0,"participation_confirmation":0,"cross_engine_consistency":0,"closing_confirmation":0,"evidence_freshness_completeness":0},"event_shock":"LOW|MODERATE|HIGH|EXTREME","event_transmission":"BULLISH|BEARISH|TWO_SIDED","convexity_warranted":false,"execution_inputs":{"rr_score":0,"premium_iv_theta_score":0,"strike_expiry_fit_score":0,"liquidity_spread_score":0,"entry_invalidation_score":0},"data_adequate":false,"expected_rr":0,"horizon_slots":{"D+1":{"direction":"BULLISH|RANGE|BEARISH","probabilities":{"BULL":0,"RANGE":0,"BEAR":0},"zone_low":0,"zone_high":0,"basis":"brief evidence-grounded path rationale"},"D+2":{"direction":"BULLISH|RANGE|BEARISH","probabilities":{"BULL":0,"RANGE":0,"BEAR":0},"zone_low":0,"zone_high":0,"basis":"brief evidence-grounded path rationale"},"D+3":{"direction":"BULLISH|RANGE|BEARISH","probabilities":{"BULL":0,"RANGE":0,"BEAR":0},"zone_low":0,"zone_high":0,"basis":"brief evidence-grounded path rationale"},"D+4":{"direction":"BULLISH|RANGE|BEARISH","probabilities":{"BULL":0,"RANGE":0,"BEAR":0},"zone_low":0,"zone_high":0,"basis":"brief evidence-grounded path rationale"},"D+5":{"direction":"BULLISH|RANGE|BEARISH","probabilities":{"BULL":0,"RANGE":0,"BEAR":0},"zone_low":0,"zone_high":0,"basis":"brief evidence-grounded path rationale"}},"limitations":["string"]}. Market Trust and Execution input values are 0..100 evidence-quality/execution judgments under the frozen definitions, not final aggregate scores. Horizon slots are the day-wise forecast path and MUST be populated for every publishable VERIFIED or DEGRADED judgment, including NO-TRADE cases. For each D+1..D+5 slot, use the supplied NIFTY spot, multi-timeframe structure, prior ranges/support-resistance and derivatives positioning to state an evidence-grounded session bias, a complete Bull/Range/Bear probability vector totaling 100%, and an expected NIFTY zone. The selected direction MUST equal the highest of the three scenario probabilities; do not emit a standalone confidence probability. A NO TRADE decision or weak Execution Edge does not justify empty forecast slots. Widen zones or reduce probability when uncertainty rises. Never fabricate a level that cannot be anchored to supplied price/range/positioning evidence; if the market evidence truly cannot support any five-day path, set verification=UNAVAILABLE and data_adequate=false instead of publishing empty slots.\n\nEvidence packet:\n${JSON.stringify(packet)}`;

export async function produceIntelligence(ai:AiBinding,packet:unknown,allowedSourceRefs:Set<string>):Promise<{judgment:IntelligenceJudgment|null;normalized:JsonRecord|null;errors:string[];model:string}>{
  let model=INTELLIGENCE_MODEL;
  try{
    const allowed=[...allowedSourceRefs];
    const system='Reconcile evidence under frozen 5DR rules. Output governed JSON only.';
    const userPrompt=prompt(packet)+'\n\nAllowed source_refs (copy EXACTLY, never rewrite):\n'+JSON.stringify(allowed);
    const initial=await runGovernedInference(ai,{messages:[{role:'system',content:system},{role:'user',content:userPrompt}],max_tokens:3200,temperature:0,chat_template_kwargs:{enable_thinking:false}});
    model=initial.model;
    let parsed=parseJson(initial.raw);let validation=validateIntelligenceJudgment(parsed,allowedSourceRefs);
    if(!validation.judgment&&validation.errors.length===1&&validation.errors[0]==='source_refs must only contain supplied evidence references'&&isObject(parsed)){
      const repairPrompt='Your prior JSON was rejected ONLY because source_refs contained a value that was not supplied. Do not change any evidence interpretation, scores, regime, limitations or horizon fields. Return the same JSON with source_refs corrected to use ONLY exact strings from this allowed list. If a family cannot be cited from this list, remove the unsupported claim by degrading verification/data_adequate rather than inventing a ref. Allowed source_refs: '+JSON.stringify(allowed)+'\nPrior JSON:\n'+JSON.stringify(parsed);
      const repaired=await runGovernedInference(ai,{messages:[{role:'system',content:system},{role:'user',content:repairPrompt}],max_tokens:3200,temperature:0,chat_template_kwargs:{enable_thinking:false}});
      model=repaired.model;
      parsed=parseJson(repaired.raw);validation=validateIntelligenceJudgment(parsed,allowedSourceRefs);
    }
    if(!validation.judgment&&validation.errors.length>0&&validation.errors.every(error=>error.startsWith('horizon_slots.'))&&isObject(parsed)){
      const repairPrompt='Your prior JSON was rejected because the D+1..D+5 forecast path was incomplete or invalid. Preserve all other evidence interpretation, raw scores, source_refs, regime, event shock, execution inputs and limitations. Using ONLY the supplied evidence packet, populate EACH horizon slot with exactly an evidence-grounded direction (BULLISH|RANGE|BEARISH), a probabilities object containing BULL/RANGE/BEAR values that each lie within 0..100 and total 100%, positive numeric zone_low, positive numeric zone_high with zone_high >= zone_low, and a brief basis. The selected direction must be the highest-probability scenario. NO TRADE or weak execution is not a reason to leave forecast-path slots empty. If the supplied PRICE_TECHNICALS evidence truly cannot support a path, set verification=UNAVAILABLE and data_adequate=false. Evidence packet:\n'+JSON.stringify(packet)+'\nPrior JSON:\n'+JSON.stringify(parsed);
      const repaired=await runGovernedInference(ai,{messages:[{role:'system',content:system},{role:'user',content:repairPrompt}],max_tokens:3200,temperature:0,chat_template_kwargs:{enable_thinking:false}});
      model=repaired.model;
      parsed=parseJson(repaired.raw);validation=validateIntelligenceJudgment(parsed,allowedSourceRefs);
    }
    if(!validation.judgment)return {judgment:null,normalized:null,errors:validation.errors.length?validation.errors:['intelligence model returned invalid JSON'],model};
    return {judgment:validation.judgment,normalized:normalizeIntelligenceJudgment(validation.judgment),errors:[],model};
  }catch(error){
    if(inferenceCapacityFailure(error)){
      const fallback=deterministicDegradedJudgment(packet,allowedSourceRefs);
      if(fallback){
        const validation=validateIntelligenceJudgment(fallback,allowedSourceRefs);
        if(validation.judgment){
          return {
            judgment:validation.judgment,
            normalized:normalizeIntelligenceJudgment(validation.judgment),
            errors:[],
            model:INTELLIGENCE_DETERMINISTIC_FALLBACK_MODEL,
          };
        }
      }
    }
    return {judgment:null,normalized:null,errors:[`intelligence inference unavailable: ${inferenceErrorLabel(error)}`],model};
  }
}
