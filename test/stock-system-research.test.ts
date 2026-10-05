import test from 'node:test';
import assert from 'node:assert/strict';
import { produceStockSystemResearch } from '../src/stock-system-research';
import { EDGE_RESEARCH_BUNDLE_VERSION } from '../src/edge-research';

const html=(text:string)=>new Response('<html><body>'+text+'</body></html>',{
  status:200,
  headers:{'content-type':'text/html'}
});

test('system stock research is produced only as lifecycle-bound V2 after DATA context exists',async()=>{
  let aiCalls=0;
  const env:any={
    AI:{
      run:async()=>{
        aiCalls++;
        return {
          response:JSON.stringify({
            claims:[
              {evidence_category:'BUSINESS_FUNDAMENTALS',statement:'Bounded sources support the latest reported operating context.',materiality:'MODERATE',direction:'POSITIVE',source_ids:['LTF_OFFICIAL_NEWSROOM'],verification_status:'VERIFIED',independent_validation:true},
              {evidence_category:'INSTITUTIONAL_BEHAVIOUR',statement:'Bounded fresh sources support only historical ownership context.',materiality:'MODERATE',direction:'NEUTRAL',source_ids:['LTF_SCREENER'],verification_status:'VERIFIED',independent_validation:true},
              {evidence_category:'NEWS_EVENTS_CATALYSTS',statement:'The bounded official newsroom contains current company updates.',materiality:'MODERATE',direction:'POSITIVE',source_ids:['LTF_OFFICIAL_NEWSROOM'],verification_status:'VERIFIED',independent_validation:true},
              {evidence_category:'VALUATION',statement:'The bounded financial snapshot supplies valuation context.',materiality:'MODERATE',direction:'NEUTRAL',source_ids:['LTF_SCREENER'],verification_status:'VERIFIED',independent_validation:true},
              {evidence_category:'EVENT_SHOCK',statement:'No severe company-specific shock is identified in this bounded source set.',materiality:'HIGH',direction:'NEUTRAL',source_ids:['LTF_OFFICIAL_NEWSROOM','LTF_SCREENER'],verification_status:'VERIFIED',independent_validation:true}
            ],
            limitations:['Bounded fresh-source test fixture.']
          })
        };
      }
    }
  };
  const fetcher:any=async(url:string)=>{
    if(url.includes('news.google.com'))return html('LTF recent news feed with no additional material shock.');
    if(url.includes('ltfinance.com/news-room'))return html('Official newsroom: current business and corporate updates.');
    if(url.includes('ltfinance.com/investors'))return html('Official investor information and financial reporting.');
    if(url.includes('screener.in'))return html('Consolidated financial valuation and shareholding snapshot.');
    if(url.includes('nseindia.com'))return html('NSE issuer and market page.');
    return new Response('',{status:404});
  };

  const dataCapturedAt='2026-10-05T03:20:00.000Z';
  const result=await produceStockSystemResearch(env,{
    ticker:'LTF',
    lifecycle_id:'EDGE-LC-2026-10-05-LTF-PREOPEN',
    market_snapshot_id:'EDGE-MKT-LTF-20261005-032000-abcdef123456',
    data_captured_at:dataCapturedAt,
    market_payload:{
      market:{
        observations:[{category:'PRICE_STRUCTURE',evidence_type:'QUOTE_DAILY',detail:'Authenticated DATA snapshot',source_ref:'upstox:test',captured_at:dataCapturedAt}],
        payloads:{}
      },
      provider_research:{observations:[],payloads:{}}
    }
  },fetcher);

  assert.equal(aiCalls,1);
  assert.equal(result.bundle.contract_version,EDGE_RESEARCH_BUNDLE_VERSION);
  assert.equal(result.bundle.research_authority,'EDGE_SYSTEM');
  assert.equal(result.bundle.lifecycle_id,'EDGE-LC-2026-10-05-LTF-PREOPEN');
  assert.equal(result.bundle.market_snapshot_id,'EDGE-MKT-LTF-20261005-032000-abcdef123456');
  assert.ok(Date.parse(result.bundle.research_fresh_at)>=Date.parse(dataCapturedAt));
  assert.deepEqual(new Set(result.bundle.claims.map(x=>x.evidence_category)),new Set([
    'BUSINESS_FUNDAMENTALS','INSTITUTIONAL_BEHAVIOUR','NEWS_EVENTS_CATALYSTS','VALUATION','EVENT_SHOCK'
  ]));
});

test('system stock research fails closed before AI when independent source retrieval is insufficient',async()=>{
  let aiCalls=0;
  const env:any={AI:{run:async()=>{aiCalls++;return {}}}};
  const fetcher:any=async()=>new Response('',{status:503});
  await assert.rejects(
    produceStockSystemResearch(env,{
      ticker:'LTF',
      lifecycle_id:'EDGE-LC-2026-10-05-LTF-PREOPEN',
      market_snapshot_id:'EDGE-MKT-LTF-20261005-032000-abcdef123456',
      data_captured_at:'2026-10-05T03:20:00.000Z',
      market_payload:{market:{observations:[],payloads:{}},provider_research:{observations:[],payloads:{}}}
    },fetcher),
    /STOCK_RESEARCH_SOURCES_INSUFFICIENT/
  );
  assert.equal(aiCalls,0);
});
