import test from 'node:test';
import assert from 'node:assert/strict';
import {assessAutomatedMarketEvidence,AUTOMATED_MARKET_EVIDENCE_SCHEMA} from '../src/automated-market-evidence';

const stamp='2026-09-19T05:00:00.000Z';
const item=(category:string)=>({category,source_kind:'UPSTOX_STRUCTURED',source_ref:'upstox-bundle://'+'a'.repeat(64)+'#'+category.toLowerCase(),observed_at:stamp,retrieved_at:stamp,verification:'VERIFIED',findings:[],structured_data:{value:1},limitations:[]});
const ready=()=>({schema:AUTOMATED_MARKET_EVIDENCE_SCHEMA,request_id:'5drreq_test',status:'AUTOMATED_MARKET_DATA_READY',provider:'UPSTOX',captured_at:stamp,bundle_sha256:'a'.repeat(64),observations:[item('PRICE_TECHNICALS'),item('DERIVATIVES_OI'),item('MARKET_TRUST'),item('EXECUTION_RISK')],blockers:[],trading_enabled:false,forecast_release_enabled:false,methodology_changed:false});

test('valid Upstox envelope crosses automated evidence gate',()=>{const r=assessAutomatedMarketEvidence(ready(),'5drreq_test');assert.equal(r.ready,true);assert.deepEqual(r.errors,[])});
test('missing derivatives evidence fails closed',()=>{const p=ready();p.observations=p.observations.filter(x=>x.category!=='DERIVATIVES_OI');const r=assessAutomatedMarketEvidence(p,'5drreq_test');assert.equal(r.ready,false);assert.ok(r.errors.some(x=>x.includes('DERIVATIVES_OI')))});
test('request mismatch fails closed',()=>{const r=assessAutomatedMarketEvidence(ready(),'5drreq_other');assert.equal(r.ready,false);assert.ok(r.errors.some(x=>x.includes('request_id')))});
test('blocked envelope is accepted only as fallback signal',()=>{const p:any={schema:AUTOMATED_MARKET_EVIDENCE_SCHEMA,request_id:'5drreq_test',status:'AUTOMATED_MARKET_DATA_BLOCKED',provider:'UPSTOX',captured_at:stamp,observations:[],blockers:['UPSTOX_UNAVAILABLE'],trading_enabled:false,forecast_release_enabled:false,methodology_changed:false};const r=assessAutomatedMarketEvidence(p,'5drreq_test');assert.equal(r.ready,false);assert.equal(r.blocked,true);assert.deepEqual(r.errors,[])});
test('secret-shaped field is rejected',()=>{const p:any=ready();p.access_token='secret';const r=assessAutomatedMarketEvidence(p,'5drreq_test');assert.equal(r.ready,false);assert.ok(r.errors.some(x=>x.includes('forbidden')))});
