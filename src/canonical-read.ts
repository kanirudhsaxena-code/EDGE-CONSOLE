import {assertPresentationSnapshot, type PresentationEngine, type PresentationSnapshot} from './presentation-snapshot.js';

export type CanonicalReadEngine=PresentationEngine;
export type CanonicalKind='ORDINARY_CANONICAL'|'EXCEPTION_CANONICAL';
export type CandidateState='SELECTED'|'SUPERSEDED'|'REJECTED';

export type CanonicalReadSelector=Readonly<{
  engine:CanonicalReadEngine;
  trading_date?:string;
  run_id?:string;
  result_id?:string;
  recommendation_id?:string;
  checkpoint_id?:string;
}>;

export type CanonicalReadRecord=Readonly<{
  contract_version:'P0_12_CANONICAL_READ_V1';
  engine:CanonicalReadEngine;
  trading_date:string;
  canonical_type:CanonicalKind;
  canonical_timestamp:string;
  run_id:string;
  result_id:string;
  recommendation_id:string|null;
  checkpoint_id:string|null;
  selection_state:CandidateState;
  analytical_fields:Readonly<Record<string,unknown>>;
  component_records:readonly Readonly<Record<string,unknown>>[];
  evidence_lineage:readonly Readonly<Record<string,unknown>>[];
  execution_plan:Readonly<Record<string,unknown>>|null;
  outcome_checkpoints:readonly Readonly<Record<string,unknown>>[];
  efficacy:Readonly<Record<string,unknown>>|null;
  core_shadow_lineage:Readonly<Record<string,unknown>>|null;
  presentation_snapshot:PresentationSnapshot;
}>;

export type CanonicalReadFailure=Readonly<{ok:false;engine:CanonicalReadEngine;reason:'INVALID_SELECTOR'|'NOT_FOUND'|'STORE_UNAVAILABLE'|'NON_SELECTED'|'INVALID_PRESENTATION'|'IDENTITY_MISMATCH';detail:string}>;
export type CanonicalReadSuccess=Readonly<{ok:true;record:CanonicalReadRecord}>;
export type CanonicalReadResult=CanonicalReadSuccess|CanonicalReadFailure;
export type CanonicalReadAdapter=(selector:CanonicalReadSelector)=>Promise<CanonicalReadRecord|null>;
export type CanonicalReadAdapters=Readonly<Record<CanonicalReadEngine,CanonicalReadAdapter>>;

function invalid(engine:CanonicalReadEngine,reason:CanonicalReadFailure['reason'],detail:string):CanonicalReadFailure{return {ok:false,engine,reason,detail};}

/** Stable P0-12 gateway. Store credentials/routing remain behind engine adapters. */
export async function canonicalRead(selector:CanonicalReadSelector,adapters:CanonicalReadAdapters):Promise<CanonicalReadResult>{
  if(!selector.trading_date&&!selector.run_id&&!selector.result_id&&!selector.recommendation_id&&!selector.checkpoint_id)return invalid(selector.engine,'INVALID_SELECTOR','Exact date or immutable identity is required');
  let record:CanonicalReadRecord|null;
  try{record=await adapters[selector.engine](selector);}catch{return invalid(selector.engine,'STORE_UNAVAILABLE',`${selector.engine} canonical store is unavailable`);}
  if(!record)return invalid(selector.engine,'NOT_FOUND','No exact canonical matched the requested engine and selector');
  if(record.engine!==selector.engine)return invalid(selector.engine,'IDENTITY_MISMATCH','Returned canonical belongs to a different engine');
  if(record.selection_state!=='SELECTED')return invalid(selector.engine,'NON_SELECTED',`Matched candidate is ${record.selection_state}, not the selected canonical`);
  if(selector.trading_date&&record.trading_date!==selector.trading_date)return invalid(selector.engine,'IDENTITY_MISMATCH','Trading date mismatch');
  if(selector.run_id&&record.run_id!==selector.run_id)return invalid(selector.engine,'IDENTITY_MISMATCH','Run identity mismatch');
  if(selector.result_id&&record.result_id!==selector.result_id)return invalid(selector.engine,'IDENTITY_MISMATCH','Result identity mismatch');
  if(selector.recommendation_id&&record.recommendation_id!==selector.recommendation_id)return invalid(selector.engine,'IDENTITY_MISMATCH','Recommendation identity mismatch');
  if(selector.checkpoint_id&&record.checkpoint_id!==selector.checkpoint_id)return invalid(selector.engine,'IDENTITY_MISMATCH','Checkpoint identity mismatch');
  try{assertPresentationSnapshot(record.presentation_snapshot);}catch{return invalid(selector.engine,'INVALID_PRESENTATION','Persisted presentation snapshot failed semantic integrity validation');}
  const identity=record.presentation_snapshot.identity;
  if(record.presentation_snapshot.engine!==record.engine||identity.run_id!==record.run_id||identity.result_id!==record.result_id||identity.checkpoint_id!==record.checkpoint_id)return invalid(selector.engine,'IDENTITY_MISMATCH','Presentation snapshot is not bound to the exact canonical identity');
  return {ok:true,record};
}

/** Independent batch reads: one engine failure never cancels another engine read. */
export async function canonicalReadIndependent(selectors:readonly CanonicalReadSelector[],adapters:CanonicalReadAdapters):Promise<readonly CanonicalReadResult[]>{
  return Promise.all(selectors.map(selector=>canonicalRead(selector,adapters)));
}
