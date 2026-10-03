export const AUTOMATED_MARKET_EVIDENCE_SCHEMA='5dr-console-market-evidence-v1';

export const AUTOMATED_MARKET_CATEGORIES=[
  'PRICE_TECHNICALS',
  'DERIVATIVES_OI',
  'MARKET_TRUST',
  'EXECUTION_RISK'
] as const;

export type AutomatedMarketCategory=typeof AUTOMATED_MARKET_CATEGORIES[number];

export type AutomatedMarketEvidenceAssessment={
  ready:boolean;
  blocked:boolean;
  errors:string[];
  observations:Array<Record<string,unknown>>;
};

const allowed=new Set<string>(AUTOMATED_MARKET_CATEGORIES);
const required=new Set<string>(['PRICE_TECHNICALS','DERIVATIVES_OI']);
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const validIso=(value:unknown)=>typeof value==='string'&&!Number.isNaN(Date.parse(value));
const sha256=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{64}$/i.test(value);
const dateOnly=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
const evidenceModes=new Set(['CLOSED_SESSION','PREOPEN','LIVE_INTRADAY','SESSION_FINAL']);
const triggerTypes=new Set(['USER','SCHEDULED']);
const benchmarkRoles=new Set(['NONE','SESSION_PREOPEN']);

function forbiddenKeyPresent(value:unknown):boolean{
  if(Array.isArray(value))return value.some(forbiddenKeyPresent);
  if(!isObject(value))return false;
  for(const [key,nested] of Object.entries(value)){
    if(/^(authorization|access_token|refresh_token|client_secret|raw_payload)$/i.test(key))return true;
    if(forbiddenKeyPresent(nested))return true;
  }
  return false;
}

export function assessAutomatedMarketEvidence(body:unknown,expectedRequestId:string):AutomatedMarketEvidenceAssessment{
  const errors:string[]=[];
  if(!isObject(body))return {ready:false,blocked:false,errors:['envelope must be an object'],observations:[]};
  if(body.schema!==AUTOMATED_MARKET_EVIDENCE_SCHEMA)errors.push('automated evidence schema is invalid');
  if(body.request_id!==expectedRequestId)errors.push('request_id does not match governed request');
  if(body.provider!=='UPSTOX')errors.push('provider must be UPSTOX');
  if(body.trading_enabled!==false)errors.push('trading_enabled must remain false');
  if(body.forecast_release_enabled!==false)errors.push('forecast_release_enabled must remain false');
  if(body.methodology_changed!==false)errors.push('methodology_changed must remain false');
  if(!validIso(body.captured_at))errors.push('captured_at must be a valid timestamp');
  if(forbiddenKeyPresent(body))errors.push('forbidden secret/raw provider field is present');

  const status=String(body.status??'');
  const observations=Array.isArray(body.observations)?body.observations.filter(isObject):[];
  const blockers=Array.isArray(body.blockers)?body.blockers.filter(x=>typeof x==='string'&&x.trim()).map(String):[];

  if(status==='AUTOMATED_MARKET_DATA_BLOCKED'){
    if(!blockers.length)errors.push('blocked automated evidence requires a blocker code');
    return {ready:false,blocked:errors.length===0,errors,observations:[]};
  }
  if(status!=='AUTOMATED_MARKET_DATA_READY')errors.push('automated evidence status is invalid');
  if(!triggerTypes.has(String(body.trigger_type??'')))errors.push('trigger_type is invalid');
  if(!evidenceModes.has(String(body.evidence_mode??'')))errors.push('evidence_mode is invalid');
  if(!dateOnly(body.market_session_as_of))errors.push('market_session_as_of must be YYYY-MM-DD');
  if(!validIso(body.research_as_of))errors.push('research_as_of must be a valid timestamp');
  if(body.target_session!==null&&!dateOnly(body.target_session))errors.push('target_session must be YYYY-MM-DD or null');
  if(!benchmarkRoles.has(String(body.benchmark_role??'')))errors.push('benchmark_role is invalid');
  if(body.trigger_type==='USER'&&body.benchmark_role!=='NONE')errors.push('user invocation cannot claim scheduled benchmark role');
  if(body.benchmark_role==='SESSION_PREOPEN'&&(body.trigger_type!=='SCHEDULED'||body.evidence_mode!=='PREOPEN'))errors.push('SESSION_PREOPEN benchmark requires scheduled PREOPEN evidence');
  if(!sha256(body.bundle_sha256))errors.push('bundle_sha256 is invalid');
  if(!observations.length)errors.push('automated evidence observations are missing');
  if(observations.length>12)errors.push('automated evidence observation count exceeds bound');

  const categories=new Set<string>();
  for(const item of observations){
    const category=String(item.category??'');
    categories.add(category);
    if(!allowed.has(category))errors.push('unknown automated evidence category: '+category);
    if(item.source_kind!=='UPSTOX_STRUCTURED')errors.push('automated evidence source_kind must be UPSTOX_STRUCTURED');
    if(typeof item.source_ref!=='string'||!item.source_ref.startsWith('upstox-bundle://'))errors.push('automated evidence source_ref is invalid');
    if(!validIso(item.observed_at)||!validIso(item.retrieved_at))errors.push('automated evidence timestamps are invalid');
    if(!['VERIFIED','DEGRADED'].includes(String(item.verification)))errors.push('automated evidence verification is invalid');
    if(!isObject(item.structured_data))errors.push('automated evidence structured_data is mandatory');
  }
  for(const category of required)if(!categories.has(category))errors.push('missing automated evidence category: '+category);

  return {ready:errors.length===0,blocked:false,errors,observations};
}
