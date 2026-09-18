import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireResearchSource,acquireSystemResearch,SYSTEM_RESEARCH_SOURCES} from '../src/system-research';

test('retrieved source is timestamped and fingerprinted',async()=>{
  const source=SYSTEM_RESEARCH_SOURCES[0];
  const fetcher=async()=>new Response('{"marketState":"Open"}',{status:200,headers:{'content-type':'application/json'}});
  const result=await acquireResearchSource(source,fetcher as typeof fetch);
  assert.equal(result.status,'RETRIEVED');
  assert.equal(result.http_status,200);
  assert.match(result.sha256||'',/^[a-f0-9]{64}$/);
  assert.equal(result.source_ref,source.url);
});

test('failed source stays unavailable and is never converted to neutral evidence',async()=>{
  const source=SYSTEM_RESEARCH_SOURCES[0];
  const fetcher=async()=>new Response('blocked',{status:403});
  const result=await acquireResearchSource(source,fetcher as typeof fetch);
  assert.equal(result.status,'UNAVAILABLE');
  assert.equal(result.limitation,'SOURCE_HTTP_403');
  assert.equal('excerpt' in result,false);
});

test('category readiness requires at least one actually retrieved source',async()=>{
  const fetcher=async(url:RequestInfo|URL)=>String(url).includes('federalreserve.gov')
    ?new Response('<html>official event calendar</html>',{status:200,headers:{'content-type':'text/html'}})
    :new Response('blocked',{status:503});
  const result=await acquireSystemResearch(fetcher as typeof fetch);
  assert.equal(result.by_category.EVENT_SHOCK.ready_for_interpretation,true);
  assert.equal(result.by_category.MARKET_TRUST.ready_for_interpretation,false);
  assert.equal(result.by_category.EXECUTION_RISK.ready_for_interpretation,false);
});
