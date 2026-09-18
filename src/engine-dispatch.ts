export type EngineDispatchEnv={
  GITHUB_ACTIONS_TOKEN?:string;
  FIVEDR_REPOSITORY?:string;
  FIVEDR_WORKFLOW?:string;
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
const DEFAULT_REF='main';

const safeDetail=(status:number)=>status===401||status===403
  ?'GitHub workflow dispatch authentication/permission rejected'
  :status===404
    ?'5DR workflow dispatch endpoint was not found'
    :`GitHub workflow dispatch returned HTTP ${status}`;

export async function dispatch5drEngine(
  env:EngineDispatchEnv,
  requestId:string,
  consoleUrl:string,
  fetcher:typeof fetch=fetch,
  executionPacket?:unknown
):Promise<EngineDispatchResult>{
  const repository=env.FIVEDR_REPOSITORY?.trim()||DEFAULT_REPOSITORY;
  const workflow=env.FIVEDR_WORKFLOW?.trim()||DEFAULT_WORKFLOW;
  const ref=env.FIVEDR_WORKFLOW_REF?.trim()||DEFAULT_REF;
  const token=env.GITHUB_ACTIONS_TOKEN?.trim();
  if(!requestId.trim()||!consoleUrl.trim()||!token){
    return {ok:false,status:'CONFIGURATION_BLOCKED',repository,workflow,detail:'GitHub workflow dispatch secret or governed request metadata is not configured'};
  }
  let origin:string;
  try{origin=new URL(env.FIVEDR_CALLBACK_URL?.trim()||consoleUrl).origin}catch{
    return {ok:false,status:'CONFIGURATION_BLOCKED',repository,workflow,detail:'Console callback origin is invalid'};
  }
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
      body:JSON.stringify({ref,inputs:{
        request_id:requestId,
        console_url:origin,
        execution_packet:executionPacket===undefined?'':JSON.stringify(executionPacket)
      }})
    });
    if(response.status===204)return {ok:true,status:'DISPATCHED',repository,workflow};
    return {ok:false,status:'DISPATCH_REJECTED',repository,workflow,detail:safeDetail(response.status)};
  }catch{
    return {ok:false,status:'DISPATCH_UNAVAILABLE',repository,workflow,detail:'GitHub workflow dispatch network request failed'};
  }
}
