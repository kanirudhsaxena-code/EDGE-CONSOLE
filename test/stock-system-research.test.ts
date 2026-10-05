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


const validClaims=()=>[
  {evidence_category:'BUSINESS_FUNDAMENTALS',statement:'Fresh independent sources support reported operating context.',materiality:'MODERATE',direction:'POSITIVE',source_ids:['LTF_OFFICIAL_INVESTORS'],verification_status:'VERIFIED',independent_validation:true},
  {evidence_category:'INSTITUTIONAL_BEHAVIOUR',statement:'Fresh independent sources support bounded ownership context.',materiality:'MODERATE',direction:'NEUTRAL',source_ids:['LTF_SCREENER'],verification_status:'VERIFIED',independent_validation:true},
  {evidence_category:'NEWS_EVENTS_CATALYSTS',statement:'Fresh independent sources support the bounded catalyst assessment.',materiality:'MODERATE',direction:'NEUTRAL',source_ids:['LTF_OFFICIAL_NEWSROOM'],verification_status:'VERIFIED',independent_validation:true},
  {evidence_category:'VALUATION',statement:'Fresh independent sources support bounded valuation context.',materiality:'MODERATE',direction:'NEUTRAL',source_ids:['LTF_SCREENER'],verification_status:'VERIFIED',independent_validation:true},
  {evidence_category:'EVENT_SHOCK',statement:'No material event shock is identified in the bounded independent source set.',materiality:'HIGH',direction:'NEUTRAL',source_ids:['LTF_OFFICIAL_NEWSROOM','LTF_SCREENER'],verification_status:'VERIFIED',independent_validation:true},
];

const allLtfSources:any=async(url:string)=>{
  if(url.includes('ltfinance.com/news-room'))return html('Official newsroom current company updates.');
  if(url.includes('ltfinance.com/investors'))return html('Official investor results and disclosures.');
  if(url.includes('screener.in'))return html('Independent consolidated financial valuation and ownership snapshot.');
  if(url.includes('nseindia.com'))return html('NSE issuer and market page.');
  if(url.includes('news.google.com'))return html('Bounded recent news discovery feed.');
  return new Response('',{status:404});
};

test('system research repairs one malformed AI source reference without weakening source validation',async()=>{
  let aiCalls=0;
  const seenInputs:any[]=[];
  const env:any={AI:{run:async(_model:string,input:any)=>{
    aiCalls++; seenInputs.push(input);
    const claims=validClaims();
    if(aiCalls===1)claims[2]={...claims[2],source_ids:['INVENTED_SOURCE_ID']};
    return {response:JSON.stringify({claims,limitations:[]})};
  }}};
  const result=await produceStockSystemResearch(env,{
    ticker:'LTF',
    lifecycle_id:'EDGE-LC-2026-10-05-LTF-REPAIR',
    market_snapshot_id:'EDGE-MKT-LTF-20261005-100000-repair123456',
    data_captured_at:'2026-10-05T10:00:00.000Z',
    market_payload:{market:{observations:[],payloads:{}},provider_research:{observations:[],payloads:{}}}
  },allLtfSources);
  assert.equal(aiCalls,2);
  assert.ok(JSON.stringify(seenInputs[1]).includes('STOCK_RESEARCH_AI_INVALID_SOURCE_REF'));
  assert.ok(JSON.stringify(seenInputs[1]).includes('LTF_OFFICIAL_NEWSROOM'));
  assert.ok(result.bundle.claims.every(claim=>claim.source_ids.every(id=>result.bundle.sources.some(source=>source.source_id===id))));
});

test('provider DATA claims are supplied only as claims-to-test while research citations remain independent',async()=>{
  let captured='';
  const env:any={AI:{run:async(_model:string,input:any)=>{
    captured=JSON.stringify(input);
    return {response:JSON.stringify({claims:validClaims(),limitations:[]})};
  }}};
  const result=await produceStockSystemResearch(env,{
    ticker:'LTF',
    lifecycle_id:'EDGE-LC-2026-10-05-LTF-CONTEXT',
    market_snapshot_id:'EDGE-MKT-LTF-20261005-101000-context1234',
    data_captured_at:'2026-10-05T10:10:00.000Z',
    market_payload:{
      market:{observations:[],payloads:{}},
      provider_research:{
        observations:[],
        payloads:{
          'upstox:/v2/news#sha256=test':{
            status:'success',
            data:[{heading:'Provider warning headline',summary:'Provider-only event flag to test independently'}]
          }
        }
      }
    }
  },allLtfSources);
  assert.match(captured,/provider_claims_to_test/);
  assert.match(captured,/Provider warning headline/);
  assert.match(captured,/NOT independent evidence/);
  assert.ok(result.bundle.sources.every(source=>source.provider==='SYSTEM_WEB'));
  assert.ok(result.bundle.claims.flatMap(claim=>claim.source_ids).every(id=>!id.startsWith('upstox:')));
});

test('EVENT_SHOCK cannot be labelled POSITIVE and remains fail-closed after bounded repair',async()=>{
  let aiCalls=0;
  const env:any={AI:{run:async()=>{
    aiCalls++;
    const claims=validClaims();
    claims[4]={...claims[4],direction:'POSITIVE'};
    return {response:JSON.stringify({claims,limitations:[]})};
  }}};
  await assert.rejects(
    produceStockSystemResearch(env,{
      ticker:'LTF',
      lifecycle_id:'EDGE-LC-2026-10-05-LTF-EVENT',
      market_snapshot_id:'EDGE-MKT-LTF-20261005-102000-event123456',
      data_captured_at:'2026-10-05T10:20:00.000Z',
      market_payload:{market:{observations:[],payloads:{}},provider_research:{observations:[],payloads:{}}}
    },allLtfSources),
    /STOCK_RESEARCH_AI_INVALID_EVENT_SHOCK_DIRECTION/
  );
  assert.equal(aiCalls,2);
});


test('Workers AI quota exhaustion falls back to source-grounded governed research',async()=>{
  let aiCalls=0;
  const env:any={AI:{run:async()=>{
    aiCalls++;
    throw new Error('4006: you have used up your daily free allocation of 10,000 neurons');
  }}};
  const fetcher:any=async(url:string)=>{
    if(url.includes('ltfinance.com/news-room'))return html('Official newsroom announcement: quarterly results and business updates.');
    if(url.includes('ltfinance.com/investors'))return html('Investor reporting: revenue grew and margins improved in the reported period.');
    if(url.includes('screener.in'))return html('Market Cap ₹100 Cr. Stock P/E 20.0. Promoter holding 66%. Consolidated sales and profit snapshot.');
    if(url.includes('nseindia.com'))return html('NSE issuer page and shareholding information.');
    if(url.includes('news.google.com'))return html('Recent company results and expansion announcement; no material adverse event reported in this bounded feed.');
    return new Response('',{status:404});
  };
  const result=await produceStockSystemResearch(env,{
    ticker:'LTF',
    lifecycle_id:'EDGE-LC-2026-10-05-LTF-AI-CAPACITY',
    market_snapshot_id:'EDGE-MKT-LTF-20261005-110000-capacity1234',
    data_captured_at:'2026-10-05T11:00:00.000Z',
    market_payload:{market:{observations:[],payloads:{}},provider_research:{observations:[],payloads:{}}}
  },fetcher);

  assert.equal(aiCalls,2);
  assert.equal(result.model,'DETERMINISTIC_SOURCE_GROUNDED_V1');
  assert.equal(result.bundle.claims.length,5);
  assert.ok(result.bundle.claims.every(claim=>claim.verification_status==='VERIFIED'&&claim.independent_validation===true));
  assert.equal(result.bundle.claims.find(x=>x.evidence_category==='EVENT_SHOCK')?.direction,'NEUTRAL');
  assert.ok(result.bundle.limitations.some(x=>x.includes('Workers AI capacity was unavailable')));
});

test('deterministic fallback remains fail-closed when category source coverage is missing',async()=>{
  let aiCalls=0;
  const env:any={AI:{run:async()=>{
    aiCalls++;
    throw new Error('4006: daily free allocation exhausted');
  }}};
  const fetcher:any=async(url:string)=>{
    if(url.includes('ltfinance.com/news-room'))return html('Official newsroom announcement and results.');
    if(url.includes('ltfinance.com/investors'))return html('Official investor financial reporting and revenue.');
    if(url.includes('nseindia.com'))return html('NSE issuer page.');
    if(url.includes('news.google.com'))return html('Recent company news feed.');
    if(url.includes('screener.in'))return new Response('',{status:503});
    return new Response('',{status:404});
  };
  await assert.rejects(
    produceStockSystemResearch(env,{
      ticker:'LTF',
      lifecycle_id:'EDGE-LC-2026-10-05-LTF-AI-CAPACITY-NO-VALUATION',
      market_snapshot_id:'EDGE-MKT-LTF-20261005-111000-novaluation1',
      data_captured_at:'2026-10-05T11:10:00.000Z',
      market_payload:{market:{observations:[],payloads:{}},provider_research:{observations:[],payloads:{}}}
    },fetcher),
    /STOCK_RESEARCH_DETERMINISTIC_COVERAGE_INSUFFICIENT:VALUATION/
  );
  assert.equal(aiCalls,2);
});
