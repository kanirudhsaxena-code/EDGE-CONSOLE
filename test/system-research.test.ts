import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireResearchSource,acquireSystemResearch,REQUIRED_NIFTY_RESEARCH_DIMENSIONS,SYSTEM_RESEARCH_SOURCES} from '../src/system-research';

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


test('NIFTY manifest enumerates all eight mandatory deep-research dimensions',()=>{
  assert.deepEqual(REQUIRED_NIFTY_RESEARCH_DIMENSIONS,[
    'GLOBAL_MARKET_REGIME',
    'MACRO_RATES_FX',
    'COMMODITIES_CROSS_ASSET',
    'INSTITUTIONAL_FLOWS',
    'BREADTH_SECTOR_LEADERSHIP',
    'DERIVATIVES_VOLATILITY',
    'NEWS_CATALYSTS',
    'EVENT_SHOCK'
  ]);
  const institutional=SYSTEM_RESEARCH_SOURCES.filter(s=>s.dimensions.includes('INSTITUTIONAL_FLOWS'));
  assert.ok(institutional.some(s=>s.id==='NSE_FII_DII_ACTIVITY'));
  assert.ok(institutional.every(s=>s.authority==='OFFICIAL_MARKET'));
});

test('research manifest fails closed when any mandatory dimension has no retrieved source',async()=>{
  const fetcher=async(url:RequestInfo|URL)=>{
    const u=String(url);
    if(u.includes('/reports/fii-dii'))return new Response('blocked',{status:503});
    return new Response('<html>current official evidence</html>',{status:200,headers:{'content-type':'text/html'}});
  };
  const result=await acquireSystemResearch(fetcher as typeof fetch);
  assert.equal(result.research_manifest_complete,false);
  assert.ok(result.missing_dimensions.includes('INSTITUTIONAL_FLOWS'));
});

test('research manifest passes only when every dimension has attributable retrieved evidence',async()=>{
  const fetcher=async(url:RequestInfo|URL)=>{
    const u=String(url);
    if(u.includes('/api/'))return new Response('{"data":[],"marketState":[]}',{status:200,headers:{'content-type':'application/json'}});
    return new Response('<html>current official evidence</html>',{status:200,headers:{'content-type':'text/html'}});
  };
  const result=await acquireSystemResearch(fetcher as typeof fetch);
  assert.equal(result.research_manifest_complete,true);
  assert.deepEqual(result.missing_dimensions,[]);
  for(const dimension of REQUIRED_NIFTY_RESEARCH_DIMENSIONS){
    assert.equal(result.by_dimension[dimension].ready_for_interpretation,true);
    assert.ok(result.by_dimension[dimension].source_ids.length>0);
  }
});
