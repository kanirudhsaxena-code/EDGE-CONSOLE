import test from 'node:test';
import assert from 'node:assert/strict';
import {check5drWorkflowAccess,dispatch5drAssessmentRefresh,dispatch5drPreopenAcquisition,dispatch5drEngine,dispatchBuild3RecommendationIntradayTruth} from '../src/engine-dispatch';

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
  assert.equal(urls.length,3);
  assert.match(urls[0],/5DR-V2\/actions\/workflows\/console-acquire\.yml$/);
  assert.match(urls[1],/5DR-V2\/actions\/workflows\/console-execute\.yml$/);
  assert.match(urls[2],/5DR-V2\/actions\/workflows\/assessment-refresh\.yml$/);
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


test('dispatches assessment refresh with same request identity and governed Console origin',async()=>{
  let seenUrl='';let seenInit:RequestInit|undefined;
  const fetcher=async(url:RequestInfo|URL,init?:RequestInit)=>{seenUrl=String(url);seenInit=init;return new Response(null,{status:204});};
  const result=await dispatch5drAssessmentRefresh(
    {GITHUB_ACTIONS_TOKEN:'secret-value'},
    '5drreq_test',
    'https://edge-console.example.test/api/5dr/run-requests/5drreq_test/resume-processing',
    fetcher as typeof fetch
  );
  assert.equal(result.ok,true);
  assert.equal(result.status,'DISPATCHED');
  assert.match(seenUrl,/5DR-V2\/actions\/workflows\/assessment-refresh\.yml\/dispatches$/);
  const body=JSON.parse(String(seenInit?.body));
  assert.deepEqual(body,{ref:'main',inputs:{}});
  assert.equal(String(seenInit?.body).includes('secret-value'),false);
});

test('assessment refresh transport may use EDGE V1 while acquisition and canonical implementation authority remain separate',async()=>{
  let seenUrl='';let seenInit:RequestInit|undefined;
  const fetcher=async(url:RequestInfo|URL,init?:RequestInit)=>{seenUrl=String(url);seenInit=init;return new Response(null,{status:204});};
  const result=await dispatch5drAssessmentRefresh({
    GITHUB_ACTIONS_TOKEN:'secret-value',
    FIVEDR_REPOSITORY:'kanirudhsaxena-code/EDGE---V1',
    FIVEDR_ASSESSMENT_REPOSITORY:'kanirudhsaxena-code/EDGE---V1',
    FIVEDR_ASSESSMENT_WORKFLOW:'5dr-assessment-refresh-proxy.yml'
  },'5drreq_test','https://edge-console.example.test',fetcher as typeof fetch);
  assert.equal(result.ok,true);
  assert.equal(result.repository,'kanirudhsaxena-code/EDGE---V1');
  assert.match(seenUrl,/EDGE---V1\/actions\/workflows\/5dr-assessment-refresh-proxy\.yml\/dispatches$/);
  const body=JSON.parse(String(seenInit?.body));
  assert.deepEqual(body.inputs,{request_id:'5drreq_test',console_url:'https://edge-console.example.test'});
});

test('assessment refresh dispatch fails closed without GitHub credential',async()=>{
  const result=await dispatch5drAssessmentRefresh({},'5drreq_test','https://edge-console.example.test',async()=>new Response(null,{status:204}) as any);
  assert.equal(result.ok,false);
  assert.equal(result.status,'CONFIGURATION_BLOCKED');
});


test('dispatches dedicated pre-open acquisition workflow',async()=>{
  let seenUrl='';let seenInit:RequestInit|undefined;
  const fetcher=async(url:RequestInfo|URL,init?:RequestInit)=>{seenUrl=String(url);seenInit=init;return new Response(null,{status:204});};
  const result=await dispatch5drPreopenAcquisition(
    {GITHUB_ACTIONS_TOKEN:'secret-value',FIVEDR_REPOSITORY:'kanirudhsaxena-code/EDGE---V1',FIVEDR_PREOPEN_ACQUIRE_WORKFLOW:'5dr-console-preopen-acquire-proxy.yml'},
    '5drreq_test',
    'https://edge-console.example.test/api/5dr/automated-runs',
    fetcher as typeof fetch
  );
  assert.equal(result.ok,true);
  assert.match(seenUrl,/5dr-console-preopen-acquire-proxy\.yml\/dispatches$/);
  const body=JSON.parse(String(seenInit?.body));
  assert.deepEqual(body,{ref:'main',inputs:{request_id:'5drreq_test',console_url:'https://edge-console.example.test'}});
});


test('5DR workflow health checks assessment permission in its configured authoritative repository',async()=>{
  const urls:string[]=[];
  const fetcher=async(url:RequestInfo|URL)=>{urls.push(String(url));return new Response('{}',{status:200,headers:{'content-type':'application/json'}});};
  const result=await check5drWorkflowAccess({
    GITHUB_ACTIONS_TOKEN:'secret-value',
    FIVEDR_REPOSITORY:'kanirudhsaxena-code/EDGE---V1',
    FIVEDR_ACQUIRE_WORKFLOW:'5dr-console-acquire-proxy.yml',
    FIVEDR_WORKFLOW:'5dr-console-execute-proxy.yml',
    FIVEDR_ASSESSMENT_REPOSITORY:'kanirudhsaxena-code/5DR-V2',
    FIVEDR_ASSESSMENT_WORKFLOW:'assessment-refresh.yml'
  },fetcher as typeof fetch);
  assert.equal(result.ok,true);
  assert.equal(urls.length,3);
  assert.match(urls[0],/EDGE---V1\/actions\/workflows\/5dr-console-acquire-proxy\.yml$/);
  assert.match(urls[1],/EDGE---V1\/actions\/workflows\/5dr-console-execute-proxy\.yml$/);
  assert.match(urls[2],/5DR-V2\/actions\/workflows\/assessment-refresh\.yml$/);
});


test('dispatches Build 3 one-minute truth on isolated configured workflow/ref',async()=>{
  let seenUrl='';let seenInit:RequestInit|undefined;
  const fetcher=async(url:RequestInfo|URL,init?:RequestInit)=>{seenUrl=String(url);seenInit=init;return new Response(null,{status:204});};
  const result=await dispatchBuild3RecommendationIntradayTruth({
    GITHUB_ACTIONS_TOKEN:'secret-value',
    FIVEDR_REPOSITORY:'kanirudhsaxena-code/EDGE---V1',
    BUILD3_TRUTH_REPOSITORY:'kanirudhsaxena-code/EDGE---V1',
    BUILD3_TRUTH_WORKFLOW:'build3-recommendation-intraday-truth.yml',
    BUILD3_TRUTH_REF:'build-3.0-accuracy-loop-20261006',
  },{
    engine:'5DR',
    source_id:'5drreq_test',
    provider_instrument_key:'NSE_FO|123',
    session_date:'2026-10-07',
  },'https://edge-console.example.test/api/build3/anything',fetcher as typeof fetch);
  assert.equal(result.ok,true);
  assert.match(seenUrl,/EDGE---V1\/actions\/workflows\/build3-recommendation-intraday-truth\.yml\/dispatches$/);
  const body=JSON.parse(String(seenInit?.body));
  assert.deepEqual(body,{
    ref:'build-3.0-accuracy-loop-20261006',
    inputs:{
      engine:'5DR',
      source_id:'5drreq_test',
      instrument_key:'NSE_FO|123',
      session_date:'2026-10-07',
      console_url:'https://edge-console.example.test',
    }
  });
  assert.equal(String(seenInit?.body).includes('secret-value'),false);
});

test('Build 3 truth dispatch fails closed on incomplete provider identity',async()=>{
  const result=await dispatchBuild3RecommendationIntradayTruth({
    GITHUB_ACTIONS_TOKEN:'secret-value',
  },{
    engine:'5DR',source_id:'5drreq_test',provider_instrument_key:'',session_date:'2026-10-07',
  },'https://edge-console.example.test',async()=>new Response(null,{status:204}) as any);
  assert.equal(result.ok,false);
  assert.equal(result.status,'CONFIGURATION_BLOCKED');
});
