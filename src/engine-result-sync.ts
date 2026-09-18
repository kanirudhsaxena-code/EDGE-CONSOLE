import type {EngineDispatchEnv} from './engine-dispatch';

export type EngineResultSyncStatus='NOT_FOUND'|'PROCESSING'|'SUCCEEDED'|'FAILED'|'UNAVAILABLE';

export type EngineResultSync={
  ok:boolean;
  status:EngineResultSyncStatus;
  repository:string;
  workflow:string;
  workflow_run_id?:number;
  envelope?:Record<string,unknown>;
  detail?:string;
};

const DEFAULT_REPOSITORY='kanirudhsaxena-code/5DR-V2';
const DEFAULT_WORKFLOW='console-execute.yml';

const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

const headers=(token:string)=>({
  'accept':'application/vnd.github+json',
  'authorization':`Bearer ${token}`,
  'user-agent':'EDGE-CONSOLE-5DR-SYNC',
  'x-github-api-version':'2022-11-28'
});

const decodeBase64Utf8=(value:string):string=>{
  const binary=atob(value);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

export async function sync5drEngineResult(
  env:EngineDispatchEnv,
  requestId:string,
  fetcher:typeof fetch=fetch
):Promise<EngineResultSync>{
  const repository=env.FIVEDR_REPOSITORY?.trim()||DEFAULT_REPOSITORY;
  const workflow=env.FIVEDR_WORKFLOW?.trim()||DEFAULT_WORKFLOW;
  const token=env.GITHUB_ACTIONS_TOKEN?.trim();
  if(!token||!requestId.trim())return {ok:false,status:'UNAVAILABLE',repository,workflow,detail:'GitHub Actions synchronization is not configured'};

  try{
    const runsResponse=await fetcher(`https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs?event=workflow_dispatch&per_page=30`,{headers:headers(token)});
    if(!runsResponse.ok)return {ok:false,status:'UNAVAILABLE',repository,workflow,detail:`GitHub workflow lookup returned HTTP ${runsResponse.status}`};
    const runsBody=await runsResponse.json();
    const runs=isObject(runsBody)&&Array.isArray(runsBody.workflow_runs)?runsBody.workflow_runs.filter(isObject):[];
    const run=runs.find(item=>String(item.display_title??item.name??'').includes(requestId));
    if(!run)return {ok:true,status:'NOT_FOUND',repository,workflow};
    const runId=Number(run.id);
    const runStatus=String(run.status??'');
    if(runStatus!=='completed')return {ok:true,status:'PROCESSING',repository,workflow,workflow_run_id:runId};
    if(String(run.conclusion)!=='success')return {ok:false,status:'FAILED',repository,workflow,workflow_run_id:runId,detail:'5DR engine workflow completed unsuccessfully before validated publication'};

    const jobsResponse=await fetcher(`https://api.github.com/repos/${repository}/actions/runs/${runId}/jobs?per_page=100`,{headers:headers(token)});
    if(!jobsResponse.ok)return {ok:false,status:'UNAVAILABLE',repository,workflow,workflow_run_id:runId,detail:`GitHub job lookup returned HTTP ${jobsResponse.status}`};
    const jobsBody=await jobsResponse.json();
    const jobs=isObject(jobsBody)&&Array.isArray(jobsBody.jobs)?jobsBody.jobs.filter(isObject):[];
    const job=jobs.find(item=>String(item.name)==='execute')??jobs[0];
    if(!job||!Number(job.id))return {ok:false,status:'UNAVAILABLE',repository,workflow,workflow_run_id:runId,detail:'5DR engine workflow job was not found'};

    const logsResponse=await fetcher(`https://api.github.com/repos/${repository}/actions/jobs/${Number(job.id)}/logs`,{headers:headers(token),redirect:'follow'});
    if(!logsResponse.ok)return {ok:false,status:'UNAVAILABLE',repository,workflow,workflow_run_id:runId,detail:`GitHub job logs returned HTTP ${logsResponse.status}`};
    const logs=await logsResponse.text();
    const matches=[...logs.matchAll(/EDGE_CONSOLE_ENVELOPE_B64::([A-Za-z0-9+/=]+)/g)];
    const marker=matches.at(-1)?.[1];
    if(!marker)return {ok:false,status:'UNAVAILABLE',repository,workflow,workflow_run_id:runId,detail:'Validated 5DR result handoff marker was not found in workflow logs'};
    let envelope:unknown;
    try{envelope=JSON.parse(decodeBase64Utf8(marker))}catch{return {ok:false,status:'UNAVAILABLE',repository,workflow,workflow_run_id:runId,detail:'Validated 5DR result handoff could not be decoded'}};
    if(!isObject(envelope)||String(envelope.request_id)!==requestId)return {ok:false,status:'UNAVAILABLE',repository,workflow,workflow_run_id:runId,detail:'Validated 5DR result handoff did not match the governed request'};
    return {ok:true,status:'SUCCEEDED',repository,workflow,workflow_run_id:runId,envelope};
  }catch{
    return {ok:false,status:'UNAVAILABLE',repository,workflow,detail:'GitHub Actions result synchronization failed'};
  }
}
