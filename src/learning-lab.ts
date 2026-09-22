export const LEARNING_ENGINES=['5DR','EDGE_STOCKS'] as const;
export const LEARNING_RUN_ROLES=['CANONICAL','DIAGNOSTIC','MANUAL','SHADOW'] as const;
export const LEARNING_SNAPSHOT_STATUSES=['COMPLETE','PARTIAL'] as const;
export type JsonRecord=Record<string,unknown>;

const isObject=(value:unknown):value is JsonRecord=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const nonEmpty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
const nonNegativeInteger=(value:unknown)=>Number.isInteger(value)&&Number(value)>=0;
const validDate=(value:unknown)=>nonEmpty(value)&&!Number.isNaN(Date.parse(value));

export function stableJson(value:unknown):string{
  if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';
  if(isObject(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableJson(value[key])).join(',')+'}';
  return JSON.stringify(value);
}

export async function sha256Hex(value:unknown):Promise<string>{
  const bytes=new TextEncoder().encode(stableJson(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function validateLearningObservation(body:unknown):string[]{
  const errors:string[]=[];
  if(!isObject(body))return['body must be an object'];
  if(!nonEmpty(body.observation_id))errors.push('observation_id is mandatory');
  if(!LEARNING_ENGINES.includes(String(body.engine) as typeof LEARNING_ENGINES[number]))errors.push('engine must be 5DR or EDGE_STOCKS');
  if(!nonEmpty(body.source_run_id))errors.push('source_run_id is mandatory');
  if(!LEARNING_RUN_ROLES.includes(String(body.run_role) as typeof LEARNING_RUN_ROLES[number]))errors.push('run_role is invalid');
  if(typeof body.official_efficacy_eligible!=='boolean')errors.push('official_efficacy_eligible must be boolean');
  if(!validDate(body.target_trading_date))errors.push('target_trading_date must be a date');
  if(!nonEmpty(body.horizon))errors.push('horizon is mandatory');
  if(!nonEmpty(body.dimension))errors.push('dimension is mandatory');
  if(!nonEmpty(body.observation_type))errors.push('observation_type is mandatory');
  if(!isObject(body.metrics))errors.push('metrics must be an object');
  if(!isObject(body.evidence))errors.push('evidence must be an object');
  if(!validDate(body.observed_at))errors.push('observed_at must be an ISO timestamp');
  if(!nonEmpty(body.source_ref))errors.push('source_ref is mandatory');
  if(body.official_efficacy_eligible===false&&!nonEmpty(body.exclusion_reason))errors.push('exclusion_reason is mandatory when official_efficacy_eligible=false');
  return errors;
}

export function validateLearningSnapshot(body:unknown):string[]{
  const errors:string[]=[];
  if(!isObject(body))return['body must be an object'];
  if(!nonEmpty(body.snapshot_id))errors.push('snapshot_id is mandatory');
  if(!LEARNING_ENGINES.includes(String(body.engine) as typeof LEARNING_ENGINES[number]))errors.push('engine must be 5DR or EDGE_STOCKS');
  if(!nonEmpty(body.cycle_id))errors.push('cycle_id is mandatory');
  if(!validDate(body.as_of))errors.push('as_of must be an ISO timestamp');
  if(!LEARNING_SNAPSHOT_STATUSES.includes(String(body.snapshot_status) as typeof LEARNING_SNAPSHOT_STATUSES[number]))errors.push('snapshot_status must be COMPLETE or PARTIAL');
  if(!nonEmpty(body.data_quality_state))errors.push('data_quality_state is mandatory');
  if(!isObject(body.methodology_versions))errors.push('methodology_versions must be an object');
  if(!isObject(body.source_lineage))errors.push('source_lineage must be an object');
  if(!isObject(body.snapshot))errors.push('snapshot must be an object');
  const counts=isObject(body.counts)?body.counts:null;
  if(!counts){errors.push('counts must be an object');return errors}
  const required=['runs_analyzed','canonical_runs','diagnostic_runs','manual_runs','shadow_runs','matured_outcomes','scorable_outcomes','data_gap_outcomes','new_observations','active_hypotheses','active_challengers','approval_required'];
  for(const key of required)if(!nonNegativeInteger(counts[key]))errors.push('counts.'+key+' must be a non-negative integer');
  if(required.every(key=>nonNegativeInteger(counts[key]))){
    const roleTotal=Number(counts.canonical_runs)+Number(counts.diagnostic_runs)+Number(counts.manual_runs)+Number(counts.shadow_runs);
    if(roleTotal>Number(counts.runs_analyzed))errors.push('run-role counts cannot exceed runs_analyzed');
    if(Number(counts.scorable_outcomes)+Number(counts.data_gap_outcomes)>Number(counts.matured_outcomes))errors.push('scorable + data-gap outcomes cannot exceed matured_outcomes');
  }
  return errors;
}

export function learningSnapshotOverview(row:JsonRecord|null){
  if(!row)return null;
  const approval=Number(row.approval_required??0);
  return {
    snapshot_id:row.snapshot_id??null,
    engine:row.engine??null,
    as_of:row.as_of??null,
    status:row.snapshot_status??null,
    data_quality_state:row.data_quality_state??null,
    runs_analyzed:Number(row.runs_analyzed??0),
    run_roles:{
      canonical:Number(row.canonical_runs??0),
      diagnostic:Number(row.diagnostic_runs??0),
      manual:Number(row.manual_runs??0),
      shadow:Number(row.shadow_runs??0),
    },
    matured_outcomes:Number(row.matured_outcomes??0),
    scorable_outcomes:Number(row.scorable_outcomes??0),
    data_gap_outcomes:Number(row.data_gap_outcomes??0),
    new_observations:Number(row.new_observations??0),
    active_hypotheses:Number(row.active_hypotheses??0),
    active_challengers:Number(row.active_challengers??0),
    approval_required:approval,
    action_state:approval>0?'APPROVAL_REQUIRED':'NO_ACTION_REQUIRED',
    production_change_allowed:false,
  };
}
