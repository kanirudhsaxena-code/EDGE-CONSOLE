export type EngineDispatchEnv={
  GITHUB_ACTIONS_TOKEN?:string;
  FIVEDR_REPOSITORY?:string;
  FIVEDR_WORKFLOW?:string;
  FIVEDR_ACQUIRE_WORKFLOW?:string;
  FIVEDR_WORKFLOW_REF?:string;
  FIVEDR_CALLBACK_URL?:string;
};

export type EngineDispatchResult={
  ok:boolean;
  status:'DISPATCHED'|'CONFIGURATION_BLOCKED'|'DISPATCH_REJECTED'|'DISPATCH_UNAVAILABLE';
  repository:string;
  workflow:string;
  detail?:string;
};

const DEFAULT_REPOSITORY='kanirudhsaxena-code/5DR-V2';
const DEFAULT_WORKFLOW='console-execute.yml';
const DEFAULT_ACQUIRE_WORKFLOW='console-acquire.yml';
const DEFAULT_REF='main';

export type EngineDispatchHealth={
  ok:boolean;
  status:'READY'|'CONFIGURATION_BLOCKED'|'PERMISSION_BLOCKED'|'WORKFLOW_NOT_FOUND'|'UNAVAILABLE';
  repository:string;
  workflows:{acquisition:string;execution:string};
  detail?:string;
};

export async function check5drWorkflowAccess(
  env:EngineDispatchEnv,
  fetcher:typeof fetch=fetch
):Promise<EngineDispatchHealth>{
  const repository=env.FIVEDR_REPOSITORY?.trim()||DEFAULT_REPOSITORY;
  const acquisition=env.FIVEDR_ACQUIRE_WORKFLOW?.trim()||DEFAULT_ACQUIRE_WORKFLOW;
  const execution=env.FIVEDR_WORKFLOW?.trim()||DEFAULT_WORKFLOW;
  const token=env.GITHUB_ACTIONS_TOKEN?.trim();
  const workflows={acquisition,execution};
  if(!token)return {ok:false,status:'CONFIGURATION_BLOCKED',repository,workflows,detail:'5DR workflow dispatch credential is not configured'};
  try{
    for(const workflow of [acquisition,execution]){
      const response=await fetcher(`https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}`,{
        method:'GET',
        headers:{
          'accept':'application/vnd.github+json',
          'authorization':`Bearer ${token}`,
          'user-agent':'EDGE-CONSOLE-5DR-HEALTH',
          'x-github-api-version':'2022-11-28'
        }
      });
      if(response.ok)continue;
      if(response.status===401||response.status===403)return {ok:false,status:'PERMISSION_BLOCKED',repository,workflows,detail:'GitHub credential cannot access 5DR Actions'};
      if(response.status===404)return {ok:false,status:'WORKFLOW_NOT_FOUND',repository,workflows,detail:'Required 5DR workflow is not accessible'};
      return {ok:false,status:'UNAVAILABLE',repository,workflows,detail:`GitHub workflow health returned HTTP ${response.status}`};
    }
    return {ok:true,status:'READY',repository,workflows};
  }catch{
    return {ok:false,status:'UNAVAILABLE',repository,workflows,detail:'GitHub workflow health request failed'};
  }
}


const safeDetail=(status:number)=>status===401||status===403
  ?'GitHub workflow dispatch authentication/permission rejected'
  :status===404
    ?'5DR workflow dispatch endpoint was not found'
    :`GitHub workflow dispatch returned HTTP ${status}`;

async function dispatchWorkflow(
  env:EngineDispatchEnv,
  workflow:string,
  inputs:Record<string,string>,
  fetcher:typeof fetch
):Promise<EngineDispatchResult>{
  const repository=env.FIVEDR_REPOSITORY?.trim()||DEFAULT_REPOSITORY;
  const ref=env.FIVEDR_WORKFLOW_REF?.trim()||DEFAULT_REF;
  const token=env.GITHUB_ACTIONS_TOKEN?.trim();
  if(!token)return {ok:false,status:'CONFIGURATION_BLOCKED',repository,workflow,detail:'GitHub workflow dispatch secret is not configured'};
  try{
    const response=await fetcher(`https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,{
      method:'POST',
      headers:{
        'accept':'application/vnd.github+json',
        'authorization':`Bearer ${token}`,
        'content-type':'application/json',
        'user-agent':'EDGE-CONSOLE-5DR-DISPATCH',
        'x-github-api-version':'2022-11-28'
      },
      body:JSON.stringify({ref,inputs})
    });
    if(response.status===204)return {ok:true,status:'DISPATCHED',repository,workflow};
    return {ok:false,status:'DISPATCH_REJECTED',repository,workflow,detail:safeDetail(response.status)};
  }catch{
    return {ok:false,status:'DISPATCH_UNAVAILABLE',repository,workflow,detail:'GitHub workflow dispatch network request failed'};
  }
}

function callbackOrigin(env:EngineDispatchEnv,consoleUrl:string):string|null{
  try{return new URL(env.FIVEDR_CALLBACK_URL?.trim()||consoleUrl).origin}catch{return null}
}

export async function dispatch5drAcquisition(
  env:EngineDispatchEnv,
  requestId:string,
  consoleUrl:string,
  fetcher:typeof fetch=fetch
):Promise<EngineDispatchResult>{
  const workflow=env.FIVEDR_ACQUIRE_WORKFLOW?.trim()||DEFAULT_ACQUIRE_WORKFLOW;
  const origin=callbackOrigin(env,consoleUrl);
  const repository=env.FIVEDR_REPOSITORY?.trim()||DEFAULT_REPOSITORY;
  if(!requestId.trim()||!origin)return {ok:false,status:'CONFIGURATION_BLOCKED',repository,workflow,detail:'Governed request metadata or Console callback origin is invalid'};
  return dispatchWorkflow(env,workflow,{request_id:requestId,console_url:origin},fetcher);
}

export async function dispatch5drEngine(
  env:EngineDispatchEnv,
  requestId:string,
  consoleUrl:string,
  fetcher:typeof fetch=fetch,
  executionPacket?:unknown
):Promise<EngineDispatchResult>{
  const workflow=env.FIVEDR_WORKFLOW?.trim()||DEFAULT_WORKFLOW;
  const origin=callbackOrigin(env,consoleUrl);
  const repository=env.FIVEDR_REPOSITORY?.trim()||DEFAULT_REPOSITORY;
  if(!requestId.trim()||!origin)return {ok:false,status:'CONFIGURATION_BLOCKED',repository,workflow,detail:'Governed request metadata or Console callback origin is invalid'};
  return dispatchWorkflow(env,workflow,{
    request_id:requestId,
    console_url:origin,
    execution_packet:executionPacket===undefined?'':JSON.stringify(executionPacket)
  },fetcher);
}
