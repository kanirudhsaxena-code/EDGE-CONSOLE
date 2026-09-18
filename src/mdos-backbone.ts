export type MdosEngineId='5DR'|'EDGE_STOCKS'|'EDGE_IPO';

export type MdosEngineRegistration={
  engine:MdosEngineId;
  repository:string;
  workflow:string;
  ref:string;
  invocation_mode:'PROMPT_GUARD'|'PROMPT_AUTONOMOUS'|'SCHEDULED_OR_MANUAL';
  methodology_boundary:'FROZEN_ENGINE_OWNED';
  trading_enabled:false;
  automatic_learning_adoption:false;
};

export type MdosCommandPlan={
  engine:MdosEngineId;
  command:string;
  target?:string;
};

export const MDOS_LEARNING_RUNTIME_CONTRACT={
  schema:'mdos-learning-runtime-v1',
  statuses:['DEFERRED','OBSERVING','CANDIDATE','VALIDATING','APPROVAL_REQUIRED','ADOPTED','REJECTED'] as const,
  automatic_adoption:false,
  required_fields:[
    'engine','cycle_id','status','sample_size','candidate_count',
    'source_ref','occurred_at','automatic_adoption','methodology_changed'
  ] as const,
  governance:{
    outcome_tracking_required:true,
    independent_validation_required_before_adoption:true,
    explicit_promotion_decision_required:true,
    historical_checkpoint_mutation_prohibited:true,
    trading_execution_prohibited:true,
  }
} as const;

export const MDOS_ENGINE_REGISTRY:readonly MdosEngineRegistration[]=[
  {
    engine:'5DR',
    repository:'kanirudhsaxena-code/5DR-V2',
    workflow:'5dr-prompt-invocation.yml',
    ref:'main',
    invocation_mode:'PROMPT_GUARD',
    methodology_boundary:'FROZEN_ENGINE_OWNED',
    trading_enabled:false,
    automatic_learning_adoption:false,
  },
  {
    engine:'EDGE_STOCKS',
    repository:'kanirudhsaxena-code/EDGE---V1',
    workflow:'autonomous-publish.yml',
    ref:'main',
    invocation_mode:'PROMPT_AUTONOMOUS',
    methodology_boundary:'FROZEN_ENGINE_OWNED',
    trading_enabled:false,
    automatic_learning_adoption:false,
  },
  {
    engine:'EDGE_IPO',
    repository:'kanirudhsaxena-code/IPO-EDGE',
    workflow:'live_v11.yml',
    ref:'main',
    invocation_mode:'SCHEDULED_OR_MANUAL',
    methodology_boundary:'FROZEN_ENGINE_OWNED',
    trading_enabled:false,
    automatic_learning_adoption:false,
  },
] as const;

export function parseMdosCommand(input:unknown):MdosCommandPlan|null{
  if(typeof input!=='string')return null;
  const command=input.trim().replace(/\s+/g,' ');
  const upper=command.toUpperCase();
  if(upper==='5DR'||upper==='5DR NIFTY')return {engine:'5DR',command:upper};
  if(upper==='IPO EDGE'||upper==='EDGE IPO'||upper==='IPO EDGE RUN'){
    return {engine:'EDGE_IPO',command:upper};
  }
  const edge=command.match(/^EDGE\s+(.+)$/i);
  if(edge&&edge[1].trim()){
    return {engine:'EDGE_STOCKS',command,target:edge[1].trim()};
  }
  return null;
}

type DispatchArgs={
  token:string;
  engine:MdosEngineId;
  command:string;
  requestId:string;
  requestedAt:string;
  fetcher?:typeof fetch;
};

export async function dispatchRegisteredEngine(args:DispatchArgs):Promise<{
  ok:boolean;
  status:number;
  engine:MdosEngineId;
  repository:string;
  workflow:string;
  error?:string;
}>{
  const registration=MDOS_ENGINE_REGISTRY.find(x=>x.engine===args.engine);
  if(!registration)throw new Error('unregistered MDOS engine');
  if(!args.token.trim())return {
    ok:false,status:503,engine:args.engine,
    repository:registration.repository,workflow:registration.workflow,
    error:'MDOS GitHub dispatch credential is not configured'
  };
  if(!args.requestId.trim()||Number.isNaN(Date.parse(args.requestedAt))){
    return {
      ok:false,status:422,engine:args.engine,
      repository:registration.repository,workflow:registration.workflow,
      error:'governed request metadata is invalid'
    };
  }
  const fetcher=args.fetcher??fetch;
  const inputs:Record<string,string>={};
  if(args.engine==='5DR'){
    inputs.command=args.command;
    inputs.request_id=args.requestId;
    inputs.requested_at=args.requestedAt;
  }
  const response=await fetcher(
    `https://api.github.com/repos/${registration.repository}/actions/workflows/${encodeURIComponent(registration.workflow)}/dispatches`,
    {
      method:'POST',
      headers:{
        accept:'application/vnd.github+json',
        authorization:`Bearer ${args.token}`,
        'content-type':'application/json',
        'user-agent':'MDOS-SHARED-CONTROL-PLANE',
        'x-github-api-version':'2022-11-28',
      },
      body:JSON.stringify({
        ref:registration.ref,
        ...(Object.keys(inputs).length?{inputs}:{}),
      }),
    }
  );
  if(response.status===204)return {
    ok:true,status:204,engine:args.engine,
    repository:registration.repository,workflow:registration.workflow,
  };
  return {
    ok:false,status:response.status,engine:args.engine,
    repository:registration.repository,workflow:registration.workflow,
    error:`GitHub workflow dispatch returned HTTP ${response.status}`,
  };
}
