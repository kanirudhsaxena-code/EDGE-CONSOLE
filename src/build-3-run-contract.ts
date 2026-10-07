export const BUILD3_RUN_CONTRACT_VERSION = 'MDOS_BUILD_3_RUN_V1' as const;
export const BUILD3_HORIZONS = ['D','D+1','D+2','D+3','D+4'] as const;
export const BUILD3_TRIGGER_TYPES = ['MANUAL','AUTOMATIC'] as const;
export const BUILD3_MARKET_PHASES = ['PRE_OPEN','OPEN','INTRADAY','POST_CLOSE','CLOSED_SESSION'] as const;
export const BUILD3_DATA_QUALITY_STATES = ['VERIFIED','PARTIAL','MISSING','STALE'] as const;

export type Build3Horizon = (typeof BUILD3_HORIZONS)[number];
export type Build3TriggerType = (typeof BUILD3_TRIGGER_TYPES)[number];
export type Build3MarketPhase = (typeof BUILD3_MARKET_PHASES)[number];
export type Build3DataQualityState = (typeof BUILD3_DATA_QUALITY_STATES)[number];
export type Build3Engine = '5DR' | 'EDGE_STOCKS';

export type Build3TargetSession = {
  horizon: Build3Horizon;
  target_session: string;
};

export type Build3RunContract = {
  contract_version: typeof BUILD3_RUN_CONTRACT_VERSION;
  engine: Build3Engine;
  instrument: string;
  run_id: string;
  model_version: string;
  run_timestamp: string;
  trigger_type: Build3TriggerType;
  market_phase: Build3MarketPhase;
  reference_price_p0: number;
  evidence_snapshot_id: string;
  evidence_hash: string;
  data_quality: Build3DataQualityState;
  target_sessions: Build3TargetSession[];
};

type UnknownRecord = Record<string, unknown>;
const isRecord=(value:unknown):value is UnknownRecord=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const nonEmpty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
const isoDate=(value:unknown):value is string=>nonEmpty(value)&&/^\d{4}-\d{2}-\d{2}$/.test(value);
const isoTimestamp=(value:unknown):value is string=>nonEmpty(value)&&!Number.isNaN(Date.parse(value));

/**
 * Build 3.0 run identity contract.
 *
 * Trigger source and market phase are descriptive lineage only. They must never
 * change the mandatory identity/evidence/session shape of a valid learning run.
 */
export function validateBuild3RunContract(value:unknown):string[]{
  const errors:string[]=[];
  if(!isRecord(value)) return ['run must be an object'];
  if(value.contract_version!==BUILD3_RUN_CONTRACT_VERSION) errors.push(`contract_version must be ${BUILD3_RUN_CONTRACT_VERSION}`);
  if(value.engine!=='5DR'&&value.engine!=='EDGE_STOCKS') errors.push('engine must be 5DR or EDGE_STOCKS');
  for(const key of ['instrument','run_id','model_version','evidence_snapshot_id','evidence_hash'] as const){
    if(!nonEmpty(value[key])) errors.push(`${key} is mandatory`);
  }
  if(!isoTimestamp(value.run_timestamp)) errors.push('run_timestamp must be a valid ISO timestamp');
  if(!BUILD3_TRIGGER_TYPES.includes(value.trigger_type as Build3TriggerType)) errors.push('trigger_type must be MANUAL or AUTOMATIC');
  if(!BUILD3_MARKET_PHASES.includes(value.market_phase as Build3MarketPhase)) errors.push('market_phase is invalid');
  if(!BUILD3_DATA_QUALITY_STATES.includes(value.data_quality as Build3DataQualityState)) errors.push('data_quality is invalid');
  if(typeof value.reference_price_p0!=='number'||!Number.isFinite(value.reference_price_p0)||value.reference_price_p0<=0)
    errors.push('reference_price_p0 must be a positive finite number');

  if(!Array.isArray(value.target_sessions)) return [...errors,'target_sessions must be an array'];
  if(value.target_sessions.length!==BUILD3_HORIZONS.length) errors.push('target_sessions must contain exactly D through D+4');

  let previous='';
  value.target_sessions.forEach((row,index)=>{
    if(!isRecord(row)){errors.push(`target_sessions[${index}] must be an object`);return;}
    const expected=BUILD3_HORIZONS[index];
    if(row.horizon!==expected) errors.push(`target_sessions[${index}].horizon must be ${expected}`);
    if(!isoDate(row.target_session)) errors.push(`target_sessions[${index}].target_session must be YYYY-MM-DD`);
    const target=String(row.target_session??'');
    if(previous&&target<=previous) errors.push('target_sessions must be strictly increasing trading sessions');
    previous=target;
  });
  return errors;
}

export function assertBuild3RunContract(value:unknown):asserts value is Build3RunContract{
  const errors=validateBuild3RunContract(value);
  if(errors.length) throw new Error(`BUILD3_RUN_CONTRACT_INVALID:${errors.join('|')}`);
}
