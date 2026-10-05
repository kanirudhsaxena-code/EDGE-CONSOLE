import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EDGE_RESEARCH_BUNDLE_LEGACY_VERSION,
  EDGE_RESEARCH_BUNDLE_VERSION,
  researchBundleCanPublish,
  validateEdgeResearchBundle
} from '../src/edge-research';

const NOW=new Date('2026-09-19T09:00:00Z');

const claims=(independentSource='src2')=>[
  {claim_id:'claim1',evidence_category:'NEWS_EVENTS_CATALYSTS',statement:'Material catalyst independently corroborated.',materiality:'HIGH',direction:'POSITIVE',source_ids:['src1',independentSource],verification_status:'VERIFIED',independent_validation:true},
  {claim_id:'claim2',evidence_category:'BUSINESS_FUNDAMENTALS',statement:'Latest reported fundamentals were checked.',materiality:'MODERATE',direction:'NEUTRAL',source_ids:[independentSource],verification_status:'VERIFIED',independent_validation:true},
  {claim_id:'claim3',evidence_category:'INSTITUTIONAL_BEHAVIOUR',statement:'Latest institutional ownership evidence was checked.',materiality:'MODERATE',direction:'NEUTRAL',source_ids:[independentSource],verification_status:'VERIFIED',independent_validation:true},
  {claim_id:'claim4',evidence_category:'VALUATION',statement:'Valuation was independently checked against current evidence.',materiality:'MODERATE',direction:'NEUTRAL',source_ids:[independentSource],verification_status:'VERIFIED',independent_validation:true},
  {claim_id:'claim5',evidence_category:'EVENT_SHOCK',statement:'No material event shock was identified in the bounded evidence set.',materiality:'HIGH',direction:'NEUTRAL',source_ids:[independentSource],verification_status:'VERIFIED',independent_validation:true}
];

const legacy=()=>({
  contract_version:EDGE_RESEARCH_BUNDLE_LEGACY_VERSION,
  bundle_id:'EDGE-RESEARCH-TITAN-20260919-090000',
  ticker:'TITAN',
  command:'EDGE TITAN',
  created_at:'2026-09-19T08:55:00Z',
  research_fresh_at:'2026-09-19T08:55:00Z',
  research_authority:'CHATGPT',
  retrieval_providers:['CHATGPT_WEB','EXA','UPSTOX'],
  sources:[
    {source_id:'src1',provider:'UPSTOX',authority:'BROKER_PROVIDER',url:'https://api.upstox.com/example',title:'Upstox structured evidence',retrieved_at:'2026-09-19T08:54:00Z'},
    {source_id:'src2',provider:'CHATGPT_WEB',authority:'EXCHANGE',url:'https://www.nseindia.com/example',title:'NSE primary evidence',retrieved_at:'2026-09-19T08:54:30Z'},
    {source_id:'src3',provider:'EXA',authority:'REPUTABLE_SECONDARY',url:'https://example.com/news',title:'Independent current report',retrieved_at:'2026-09-19T08:54:40Z'}
  ],
  claims:claims(),
  limitations:[]
});

const v2=()=>({
  contract_version:EDGE_RESEARCH_BUNDLE_VERSION,
  bundle_id:'ER2-TITAN-abcdef1234567890',
  ticker:'TITAN',
  command:'EDGE TITAN',
  created_at:'2026-09-19T08:55:00Z',
  research_fresh_at:'2026-09-19T08:55:00Z',
  research_authority:'EDGE_SYSTEM',
  lifecycle_id:'EDGE-LC-2026-09-19-TITAN-PREOPEN',
  market_snapshot_id:'EDGE-MKT-TITAN-20260919-085000-abcdef123456',
  retrieval_providers:['SYSTEM_WEB'],
  sources:[
    {source_id:'src1',provider:'UPSTOX',authority:'BROKER_PROVIDER',url:'https://api.upstox.com/example',title:'Run-bound provider evidence',retrieved_at:'2026-09-19T08:50:00Z'},
    {source_id:'src2',provider:'SYSTEM_WEB',authority:'COMPANY',url:'https://example.com/company',title:'Fresh independent company evidence',retrieved_at:'2026-09-19T08:54:30Z'}
  ],
  claims:claims(),
  limitations:[]
});

test('legacy V1 remains valid only with CHATGPT + CHATGPT_WEB',()=>{
  assert.deepEqual(validateEdgeResearchBundle(legacy(),NOW),[]);
  assert.equal(researchBundleCanPublish(legacy(),NOW).ready,true);
  const b:any=legacy(); b.retrieval_providers=['EXA','UPSTOX'];
  assert.ok(validateEdgeResearchBundle(b,NOW).some(e=>e.includes('CHATGPT_WEB')));
});

test('V2 autonomous research requires EDGE_SYSTEM, SYSTEM_WEB and run lineage',()=>{
  assert.deepEqual(validateEdgeResearchBundle(v2(),NOW),[]);
  assert.equal(researchBundleCanPublish(v2(),NOW).ready,true);
  const noLifecycle:any=v2(); delete noLifecycle.lifecycle_id;
  assert.ok(validateEdgeResearchBundle(noLifecycle,NOW).some(e=>e.includes('lifecycle_id')));
  const noSnapshot:any=v2(); delete noSnapshot.market_snapshot_id;
  assert.ok(validateEdgeResearchBundle(noSnapshot,NOW).some(e=>e.includes('market_snapshot_id')));
  const wrongAuthority:any=v2(); wrongAuthority.research_authority='CHATGPT';
  assert.ok(validateEdgeResearchBundle(wrongAuthority,NOW).some(e=>e.includes('EDGE_SYSTEM')));
  const noSystemWeb:any=v2(); noSystemWeb.retrieval_providers=['UPSTOX'];
  assert.ok(validateEdgeResearchBundle(noSystemWeb,NOW).some(e=>e.includes('SYSTEM_WEB')));
});

test('material Upstox-only claim cannot be VERIFIED',()=>{
  const b:any=v2(); b.claims[0].source_ids=['src1'];
  assert.ok(validateEdgeResearchBundle(b,NOW).some(e=>e.includes('provider-only')));
});

test('stale research bundle fails closed',()=>{
  const b:any=v2(); b.research_fresh_at='2026-09-17T08:00:00Z';
  assert.ok(validateEdgeResearchBundle(b,NOW).some(e=>e.includes('stale')));
});

test('unresolved HIGH conflict blocks publication',()=>{
  const b:any=v2();
  b.claims[0].verification_status='CONFLICTED';
  b.claims[0].independent_validation=false;
  b.claims[0].conflict_note='Primary and secondary sources disagree.';
  const result=researchBundleCanPublish(b,NOW);
  assert.equal(result.ready,false);
  assert.ok(result.errors.some(e=>e.includes('HIGH/CRITICAL claims are unresolved')));
});

test('missing independently verified mandatory dimension blocks publication',()=>{
  const b:any=v2(); b.claims[1].verification_status='NOT_VERIFIED'; b.claims[1].independent_validation=false;
  const result=researchBundleCanPublish(b,NOW);
  assert.equal(result.ready,false);
  assert.ok(result.errors.some(e=>e.includes('mandatory research coverage incomplete')));
  assert.ok(result.errors.some(e=>e.includes('BUSINESS_FUNDAMENTALS')));
});
