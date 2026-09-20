import test from 'node:test';
import assert from 'node:assert/strict';
import {check5drWorkflowAccess,dispatch5drEngine} from '../src/engine-dispatch';

test('fails closed when dispatch token is absent',async()=>{
  const result=await dispatch5drEngine({},'5drreq_test','https://edge-console.example.test/api/5dr/run-requests/5drreq_test/normalized',async()=>new Response(null,{status:204}) as any);
  assert.equal(result.ok,false);
  assert.equal(result.status,'CONFIGURATION_BLOCKED');
});

test('dispatches governed request without leaking token into payload',async()=>{
  let seenUrl='';let seenInit:RequestInit|undefined;
  const fetcher=async(url:RequestInfo|URL,init?:RequestInit)=>{seenUrl=String(url);seenInit=init;return new Response(null,{status:204});};
  const result=await dispatch5drEngine({GITHUB_ACTIONS_TOKEN:'secret-value'},'5drreq_test','https://edge-console.example.test/api/5dr/run-requests/5drreq_test/normalized',fetcher as typeof fetch);
  assert.equal(result.ok,true);
  assert.equal(result.status,'DISPATCHED');
  assert.match(seenUrl,/5DR-V2\/actions\/workflows\/console-execute\.yml\/dispatches$/);
  const body=JSON.parse(String(seenInit?.body));
  assert.deepEqual(body,{ref:'main',inputs:{request_id:'5drreq_test',console_url:'https://edge-console.example.test',execution_packet:''}});
  assert.equal(String(seenInit?.body).includes('secret-value'),false);
});

test('sanitizes GitHub permission failures',async()=>{
  const fetcher=async()=>new Response('provider response must not be surfaced',{status:403});
  const result=await dispatch5drEngine({GITHUB_ACTIONS_TOKEN:'secret-value'},'5drreq_test','https://edge-console.example.test',fetcher as typeof fetch);
  assert.equal(result.ok,false);
  assert.equal(result.status,'DISPATCH_REJECTED');
  assert.equal(result.detail,'GitHub workflow dispatch authentication/permission rejected');
});


test('carries governed execution packet inside workflow dispatch',async()=>{
  let seenInit:RequestInit|undefined;
  const fetcher=async(_url:RequestInfo|URL,init?:RequestInit)=>{seenInit=init;return new Response(null,{status:204});};
  const packet={request_id:'5drreq_test',provenance_mode:'HYBRID',framework_version:'5DR_V2_1',output_contract_version:'5DR_V2_1_2',evidence:[{normalized:{regime:'RANGE'}}]};
  const result=await dispatch5drEngine({GITHUB_ACTIONS_TOKEN:'secret-value'},'5drreq_test','https://edge-console.example.test',fetcher as typeof fetch,packet);
  assert.equal(result.ok,true);
  const body=JSON.parse(String(seenInit?.body));
  assert.deepEqual(JSON.parse(body.inputs.execution_packet),packet);
  assert.equal(String(seenInit?.body).includes('secret-value'),false);
});


test('5DR workflow health is ready only when both governed workflows are accessible',async()=>{
  const urls:string[]=[];
  const fetcher=async(url:RequestInfo|URL)=>{urls.push(String(url));return new Response('{}',{status:200,headers:{'content-type':'application/json'}});};
  const result=await check5drWorkflowAccess({GITHUB_ACTIONS_TOKEN:'secret-value'},fetcher as typeof fetch);
  assert.equal(result.ok,true);
  assert.equal(result.status,'READY');
  assert.equal(urls.length,2);
  assert.match(urls[0],/console-acquire\.yml$/);
  assert.match(urls[1],/console-execute\.yml$/);
});

test('5DR workflow health reports repository permission blocker without leaking provider body',async()=>{
  const fetcher=async()=>new Response('sensitive provider response',{status:403});
  const result=await check5drWorkflowAccess({GITHUB_ACTIONS_TOKEN:'secret-value'},fetcher as typeof fetch);
  assert.equal(result.ok,false);
  assert.equal(result.status,'PERMISSION_BLOCKED');
  assert.equal(result.detail,'GitHub credential cannot access 5DR Actions');
  assert.equal(JSON.stringify(result).includes('sensitive provider response'),false);
});

test('5DR workflow health fails closed when credential is absent',async()=>{
  const result=await check5drWorkflowAccess({},async()=>new Response('{}',{status:200}) as any);
  assert.equal(result.ok,false);
  assert.equal(result.status,'CONFIGURATION_BLOCKED');
});
