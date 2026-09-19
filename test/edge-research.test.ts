import test from 'node:test';
import assert from 'node:assert/strict';
import {EDGE_RESEARCH_BUNDLE_VERSION,researchBundleCanPublish,validateEdgeResearchBundle} from '../src/edge-research';

const NOW=new Date('2026-09-19T09:00:00Z');
const base=()=>({
  contract_version:EDGE_RESEARCH_BUNDLE_VERSION,
  bundle_id:'EDGE-RESEARCH-TITAN-20260919-090000',
  ticker:'TITAN',
  command:'EDGE TITAN',
  created_at:'2026-09-19T08:55:00Z',
  research_fresh_at:'2026-09-19T08:55:00Z',
  research_authority:'CHATGPT',
  retrieval_providers:['CHATGPT_WEB','EXA','UPSTOX'],
  sources:[
    {source_id:'s1',provider:'UPSTOX',authority:'BROKER_PROVIDER',url:'https://api.upstox.com/example',title:'Upstox structured evidence',retrieved_at:'2026-09-19T08:54:00Z'},
    {source_id:'s2',provider:'CHATGPT_WEB',authority:'EXCHANGE',url:'https://www.nseindia.com/example',title:'NSE primary evidence',retrieved_at:'2026-09-19T08:54:30Z',publication_date:'2026-09-18T00:00:00Z',event_date:'2026-09-18T00:00:00Z'},
    {source_id:'s3',provider:'EXA',authority:'REPUTABLE_SECONDARY',url:'https://example.com/news',title:'Independent current report',retrieved_at:'2026-09-19T08:54:40Z',publication_date:'2026-09-19T00:00:00Z'}
  ],
  claims:[
    {claim_id:'c1',evidence_category:'NEWS_EVENTS_CATALYSTS',statement:'Material catalyst independently corroborated.',materiality:'HIGH',direction:'POSITIVE',source_ids:['s1','s2'],verification_status:'VERIFIED',independent_validation:true},
    {claim_id:'c2',evidence_category:'BUSINESS_FUNDAMENTALS',statement:'Latest reported fundamentals were checked.',materiality:'MODERATE',direction:'NEUTRAL',source_ids:['s1','s2'],verification_status:'VERIFIED',independent_validation:true}
  ],
  limitations:[]
});

test('valid bundle requires ChatGPT authority and independent material validation',()=>{
  assert.deepEqual(validateEdgeResearchBundle(base(),NOW),[]);
  assert.equal(researchBundleCanPublish(base(),NOW).ready,true);
});

test('CHATGPT_WEB is mandatory even when Exa and Upstox are present',()=>{
  const b:any=base(); b.retrieval_providers=['EXA','UPSTOX'];
  assert.ok(validateEdgeResearchBundle(b,NOW).some(e=>e.includes('CHATGPT_WEB is mandatory')));
});

test('material Upstox-only claim cannot be VERIFIED',()=>{
  const b:any=base(); b.claims[0].source_ids=['s1'];
  assert.ok(validateEdgeResearchBundle(b,NOW).some(e=>e.includes('provider-only')));
});

test('stale research bundle fails closed',()=>{
  const b:any=base(); b.research_fresh_at='2026-09-17T08:00:00Z';
  assert.ok(validateEdgeResearchBundle(b,NOW).some(e=>e.includes('stale')));
});

test('unresolved HIGH conflict blocks publication',()=>{
  const b:any=base(); b.claims[0].verification_status='CONFLICTED'; b.claims[0].independent_validation=false; b.claims[0].conflict_note='Primary and secondary sources disagree.';
  const result=researchBundleCanPublish(b,NOW);
  assert.equal(result.ready,false);
  assert.ok(result.errors.some(e=>e.includes('HIGH/CRITICAL claims are unresolved')));
});

test('moderate unverified claim is retained but does not self-validate',()=>{
  const b:any=base(); b.claims[1].verification_status='NOT_VERIFIED'; b.claims[1].independent_validation=false;
  assert.equal(researchBundleCanPublish(b,NOW).ready,true);
});
