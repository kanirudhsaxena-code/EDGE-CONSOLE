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
  assert.ok(institutional.some(s=>s.id==='NSE_FII_DII_API'));
  assert.ok(institutional.some(s=>s.id==='NSE_FII_DII_ACTIVITY'));
  assert.ok(institutional.every(s=>s.authority==='OFFICIAL_MARKET'));
});

test('research manifest fails closed when any mandatory dimension has no retrieved source',async()=>{
  const fetcher=async(url:RequestInfo|URL)=>{
    const u=String(url);
    if(u.includes('/api/fiidiiTradeReact')||u.includes('/reports/fii-dii'))return new Response('blocked',{status:503});
    return new Response('<html>current official evidence</html>',{status:200,headers:{'content-type':'text/html'}});
  };
  const result=await acquireSystemResearch(fetcher as typeof fetch);
  assert.equal(result.research_manifest_complete,false);
  assert.ok(result.missing_dimensions.includes('INSTITUTIONAL_FLOWS'));
});

test('research manifest passes only when every dimension has attributable retrieved evidence',async()=>{
  const fetcher=async(url:RequestInfo|URL)=>{
    const u=String(url);
    if(u.includes('/api/fiidiiTradeReact'))return new Response(
      JSON.stringify([
        {category:'DII',date:'03-Oct-2026',buyValue:'13,209.23',sellValue:'11,599.76',netValue:'1,609.47'},
        {category:'FII/FPI',date:'03-Oct-2026',buyValue:'11,634.11',sellValue:'11,769.68',netValue:'-135.57'}
      ]),
      {status:200,headers:{'content-type':'application/json'}}
    );
    if(u.includes('/reports/fii-dii'))return new Response('<html>official report shell</html>',{status:200,headers:{'content-type':'text/html'}});
    if(u.includes('federalreserve.gov/monetarypolicy.htm'))return new Response('<html>FOMC Statement: Released September 16, 2026</html>',{status:200,headers:{'content-type':'text/html'}});
    if(u.includes('monetary20260916a.htm'))return new Response('<html>The Committee decided to raise the target range for the federal funds rate to 3-3/4 to 4 percent.</html>',{status:200,headers:{'content-type':'text/html'}});
    if(u==='https://www.rbi.org.in/'||u==='https://m.rbi.org.in/')return new Response('<html>Policy Repo Rate : 5.50% Standing Deposit Facility Rate : 5.25% Marginal Standing Facility Rate : 5.75% INR / 1 USD : 97.08 (As at 1.00pm of October 7, 2026)<a href="/Scripts/BS_PressReleaseDisplay.aspx?prid=999">Resolution of the Monetary Policy Committee October 5 to 7, 2026</a></html>',{status:200,headers:{'content-type':'text/html'}});
    if(u.includes('BS_PressReleaseDisplay.aspx?prid=999'))return new Response('<html>The Monetary Policy Committee decided to increase the policy repo rate by 25 basis points to 5.50 per cent and shift to calibrated tightening. October 7, 2026</html>',{status:200,headers:{'content-type':'text/html'}});
    if(u.includes('/api/'))return new Response('{"data":[],"marketState":[]}',{status:200,headers:{'content-type':'application/json'}});
    return new Response('<html>current official evidence</html>',{status:200,headers:{'content-type':'text/html'}});
  };
  const result=await acquireSystemResearch(fetcher as typeof fetch);
  assert.equal(result.research_manifest_complete,true);
  assert.deepEqual(result.missing_dimensions,[]);
  assert.deepEqual(result.fact_blockers,[]);
  assert.ok(result.by_dimension.MACRO_RATES_FX.source_ids.includes('RBI_LATEST_POLICY_DECISION'));
  assert.ok(result.by_dimension.MACRO_RATES_FX.source_ids.includes('FED_LATEST_FOMC_STATEMENT'));
  for(const dimension of REQUIRED_NIFTY_RESEARCH_DIMENSIONS){
    assert.equal(result.by_dimension[dimension].ready_for_interpretation,true);
    assert.ok(result.by_dimension[dimension].source_ids.length>0);
  }
});


test('institutional-flow manifest requires parsed FII and DII values, not HTTP 200 alone',async()=>{
  const fetcher=async(url:RequestInfo|URL)=>{
    const u=String(url);
    if(u.includes('/api/fiidiiTradeReact'))return new Response('[]',{status:200,headers:{'content-type':'application/json'}});
    if(u.includes('/reports/fii-dii'))return new Response('<html>FII/FPI and DII report shell without values</html>',{status:200,headers:{'content-type':'text/html'}});
    if(u.includes('/api/'))return new Response('{"data":[],"marketState":[]}',{status:200,headers:{'content-type':'application/json'}});
    return new Response('<html>current official evidence</html>',{status:200,headers:{'content-type':'text/html'}});
  };
  const result=await acquireSystemResearch(fetcher as typeof fetch);
  assert.equal(result.by_dimension.INSTITUTIONAL_FLOWS.ready_for_interpretation,false);
  assert.ok(result.missing_dimensions.includes('INSTITUTIONAL_FLOWS'));
});

test('institutional-flow parser admits explicit current FII and DII net-flow facts from the official NSE API',async()=>{
  const fetcher=async(url:RequestInfo|URL)=>{
    const u=String(url);
    if(u.includes('/api/fiidiiTradeReact'))return new Response(
      JSON.stringify([
        {category:'DII',date:'03-Oct-2026',buyValue:'13,209.23',sellValue:'11,599.76',netValue:'1,609.47'},
        {category:'FII/FPI',date:'03-Oct-2026',buyValue:'11,634.11',sellValue:'11,769.68',netValue:'-135.57'}
      ]),
      {status:200,headers:{'content-type':'application/json'}}
    );
    if(u.includes('/reports/fii-dii'))return new Response('<html>report shell without injected rows</html>',{status:200,headers:{'content-type':'text/html'}});
    if(u.includes('/api/'))return new Response('{"data":[],"marketState":[]}',{status:200,headers:{'content-type':'application/json'}});
    return new Response('<html>current official evidence</html>',{status:200,headers:{'content-type':'text/html'}});
  };
  const result=await acquireSystemResearch(fetcher as typeof fetch);
  assert.equal(result.by_dimension.INSTITUTIONAL_FLOWS.ready_for_interpretation,true);
  assert.ok(result.by_dimension.INSTITUTIONAL_FLOWS.source_ids.includes('NSE_FII_DII_API'));
  const row=result.snapshots.find(s=>s.source_id==='NSE_FII_DII_API');
  assert.deepEqual(row?.facts?.dii,{date:'03-Oct-2026',buy_crore:13209.23,sell_crore:11599.76,net_crore:1609.47});
  assert.deepEqual(row?.facts?.fii_fpi,{date:'03-Oct-2026',buy_crore:11634.11,sell_crore:11769.68,net_crore:-135.57});
});


test('macro research cannot pass on HTTP 200 shells without factual RBI and Fed policy decisions',async()=>{
  const fetcher=async(url:RequestInfo|URL)=>{
    const u=String(url);
    if(u.includes('/api/fiidiiTradeReact'))return new Response(JSON.stringify([
      {category:'DII',date:'07-Oct-2026',buyValue:'100',sellValue:'90',netValue:'10'},
      {category:'FII/FPI',date:'07-Oct-2026',buyValue:'80',sellValue:'100',netValue:'-20'}
    ]),{status:200,headers:{'content-type':'application/json'}});
    if(u.includes('/api/'))return new Response('{"data":[],"marketState":[]}',{status:200,headers:{'content-type':'application/json'}});
    return new Response('<html>official page successfully retrieved but no current policy facts</html>',{status:200,headers:{'content-type':'text/html'}});
  };
  const result=await acquireSystemResearch(fetcher as typeof fetch);
  assert.equal(result.by_dimension.MACRO_RATES_FX.ready_for_interpretation,false);
  assert.ok(result.missing_dimensions.includes('MACRO_RATES_FX'));
  assert.ok(result.fact_blockers.includes('RBI_CURRENT_POLICY_RATE_FACT_MISSING'));
  assert.ok(result.fact_blockers.includes('FED_LATEST_POLICY_DECISION_UNRESOLVED'));
});

test('fresh RBI policy link blocks the manifest unless the linked policy decision is factually resolved',async()=>{
  const fetcher=async(url:RequestInfo|URL)=>{
    const u=String(url);
    if(u.includes('/api/fiidiiTradeReact'))return new Response(JSON.stringify([
      {category:'DII',date:'07-Oct-2026',buyValue:'100',sellValue:'90',netValue:'10'},
      {category:'FII/FPI',date:'07-Oct-2026',buyValue:'80',sellValue:'100',netValue:'-20'}
    ]),{status:200,headers:{'content-type':'application/json'}});
    if(u.includes('federalreserve.gov/monetarypolicy.htm'))return new Response('<html>FOMC Statement: Released September 16, 2026</html>',{status:200});
    if(u.includes('monetary20260916a.htm'))return new Response('<html>The Committee decided to raise the target range for the federal funds rate to 3-3/4 to 4 percent.</html>',{status:200});
    if(u==='https://www.rbi.org.in/'||u==='https://m.rbi.org.in/')return new Response('<html>Policy Repo Rate : 5.50%<a href="/Scripts/BS_PressReleaseDisplay.aspx?prid=999">Resolution of the Monetary Policy Committee October 5 to 7, 2026</a></html>',{status:200});
    if(u.includes('prid=999'))return new Response('<html>policy page loaded but decision text missing</html>',{status:200});
    if(u.includes('/api/'))return new Response('{"data":[],"marketState":[]}',{status:200});
    return new Response('<html>official evidence</html>',{status:200});
  };
  const result=await acquireSystemResearch(fetcher as typeof fetch);
  assert.equal(result.research_manifest_complete,false);
  assert.ok(result.fact_blockers.includes('RBI_LATEST_POLICY_DECISION_UNRESOLVED'));
  assert.ok(result.missing_dimensions.includes('MACRO_RATES_FX'));
});

test('RBI latest policy decision parser extracts action, basis points and repo rate',async()=>{
  const source:any={id:'RBI_LATEST_POLICY_DECISION',category:'EVENT_SHOCK',dimensions:['MACRO_RATES_FX','NEWS_CATALYSTS','EVENT_SHOCK'],url:'https://www.rbi.org.in/policy',authority:'PRIMARY',accept:'text/html'};
  const result=await acquireResearchSource(source,async()=>new Response('<html>The Monetary Policy Committee decided to increase the policy repo rate by 25 basis points to 5.50 per cent and shift to calibrated tightening. October 7, 2026</html>',{status:200}) as any);
  assert.equal(result.facts?.policy_action,'increase');
  assert.equal(result.facts?.policy_change_bps,25);
  assert.equal(result.facts?.policy_repo_rate_pct,5.5);
});


test('RBI research prefers the newest MPC resolution and accepts official decision rate as current policy fact',async()=>{
  const fetcher=async(url:RequestInfo|URL)=>{
    const u=String(url);
    if(u.includes('/api/fiidiiTradeReact'))return new Response(JSON.stringify([
      {category:'DII',date:'07-Oct-2026',buyValue:'100',sellValue:'90',netValue:'10'},
      {category:'FII/FPI',date:'07-Oct-2026',buyValue:'80',sellValue:'90',netValue:'-10'}
    ]),{status:200,headers:{'content-type':'application/json'}});
    if(u.includes('federalreserve.gov/monetarypolicy.htm'))return new Response('<html>FOMC Statement: Released September 16, 2026</html>',{status:200});
    if(u.includes('monetary20260916a.htm'))return new Response('<html>The Committee decided to maintain the target range for the federal funds rate at 3-3/4 to 4 percent.</html>',{status:200});
    if(u==='https://www.rbi.org.in/')return new Response('<html><a href="/Scripts/BS_PressReleaseDisplay.aspx?prid=old">Monetary Policy Statement, 2020-21 Resolution of the Monetary Policy Committee October 7-9, 2020</a><a href="/Scripts/BS_PressReleaseDisplay.aspx?prid=current">Monetary Policy Statement, 2026-27 Resolution of the Monetary Policy Committee October 5 to 7, 2026</a></html>',{status:200});
    if(u==='https://m.rbi.org.in/')return new Response('<html>official current-rates page without embedded rate table</html>',{status:200});
    if(u.includes('prid=current'))return new Response('<html>The Monetary Policy Committee (MPC) decided to: keep the policy repo rate under the liquidity adjustment facility unchanged at 5.50 per cent. October 7, 2026</html>',{status:200});
    if(u.includes('prid=old'))return new Response('<html>The Monetary Policy Committee decided to: keep the policy repo rate unchanged at 4.00 per cent. October 9, 2020</html>',{status:200});
    if(u.includes('/api/'))return new Response('{"data":[],"marketState":[]}',{status:200,headers:{'content-type':'application/json'}});
    return new Response('<html>current official evidence</html>',{status:200});
  };
  const result=await acquireSystemResearch(fetcher as typeof fetch);
  const rbi=result.snapshots.find(row=>row.source_id==='RBI_LATEST_POLICY_DECISION');
  assert.ok(rbi?.source_ref.includes('prid=current'),rbi);
  assert.equal(rbi?.facts?.policy_action,'keep');
  assert.equal(rbi?.facts?.policy_repo_rate_pct,5.5);
  assert.ok(!result.fact_blockers.includes('RBI_CURRENT_POLICY_RATE_FACT_MISSING'),result.fact_blockers);
  assert.ok(!result.fact_blockers.includes('RBI_LATEST_POLICY_DECISION_UNRESOLVED'),result.fact_blockers);
});
