import test from 'node:test';
import assert from 'node:assert/strict';
import {sync5drAcquisitionResult} from '../src/engine-result-sync';

test('pulls validated acquisition handoff from governed workflow logs',async()=>{
  const requestId='5drreq_test';
  const payload={schema:'5dr-console-market-evidence-v1',request_id:requestId,status:'AUTOMATED_MARKET_DATA_BLOCKED',provider:'UPSTOX',captured_at:new Date().toISOString(),observations:[],blockers:['NON_TRADING_SESSION'],trading_enabled:false,forecast_release_enabled:false,methodology_changed:false};
  const marker=Buffer.from(JSON.stringify(payload),'utf8').toString('base64');
  const fetcher=async(url:RequestInfo|URL)=>{
    const s=String(url);
    if(s.includes('/actions/workflows/'))return new Response(JSON.stringify({workflow_runs:[{id:101,status:'completed',conclusion:'success',display_title:'5DR Automated Evidence · '+requestId}]}),{status:200});
    if(s.includes('/actions/runs/101/jobs'))return new Response(JSON.stringify({jobs:[{id:202,name:'acquire'}]}),{status:200});
    if(s.includes('/actions/jobs/202/logs'))return new Response('prefix\nEDGE_CONSOLE_MARKET_EVIDENCE_B64::'+marker+'\nsuffix',{status:200});
    return new Response('',{status:404});
  };
  const result=await sync5drAcquisitionResult({
    GITHUB_ACTIONS_TOKEN:'secret',
    FIVEDR_REPOSITORY:'kanirudhsaxena-code/EDGE---V1',
    FIVEDR_ACQUIRE_WORKFLOW:'5dr-console-acquire-proxy.yml'
  },requestId,fetcher as typeof fetch);
  assert.equal(result.ok,true);
  assert.equal(result.status,'SUCCEEDED');
  assert.equal(result.workflow_run_id,101);
  assert.deepEqual(result.evidence,payload);
});

test('acquisition handoff with wrong request id fails closed',async()=>{
  const marker=Buffer.from(JSON.stringify({request_id:'5drreq_other'}),'utf8').toString('base64');
  const fetcher=async(url:RequestInfo|URL)=>{
    const s=String(url);
    if(s.includes('/actions/workflows/'))return new Response(JSON.stringify({workflow_runs:[{id:101,status:'completed',conclusion:'success',display_title:'5DR Automated Evidence · 5drreq_test'}]}),{status:200});
    if(s.includes('/actions/runs/101/jobs'))return new Response(JSON.stringify({jobs:[{id:202,name:'acquire'}]}),{status:200});
    if(s.includes('/actions/jobs/202/logs'))return new Response('EDGE_CONSOLE_MARKET_EVIDENCE_B64::'+marker,{status:200});
    return new Response('',{status:404});
  };
  const result=await sync5drAcquisitionResult({GITHUB_ACTIONS_TOKEN:'secret'},'5drreq_test',fetcher as typeof fetch);
  assert.equal(result.ok,false);
  assert.equal(result.status,'UNAVAILABLE');
  assert.match(result.detail??'',/did not match/);
});

test('in-progress acquisition remains resumable',async()=>{
  const fetcher=async()=>new Response(JSON.stringify({workflow_runs:[{id:77,status:'in_progress',conclusion:null,display_title:'5DR Automated Evidence · 5drreq_test'}]}),{status:200});
  const result=await sync5drAcquisitionResult({GITHUB_ACTIONS_TOKEN:'secret'},'5drreq_test',fetcher as typeof fetch);
  assert.equal(result.ok,true);
  assert.equal(result.status,'PROCESSING');
  assert.equal(result.workflow_run_id,77);
});
