import test from 'node:test';
import assert from 'node:assert/strict';
import { canAdvanceIntelligenceHandoff } from '../src/intelligence-contract';
import { assessUserEvidenceReadiness } from '../src/evidence-readiness';

const now='2026-09-15T12:00:00.000Z';
const normalized=()=>({regime:{state:'RANGE'},component_scores:{trend:0},market_trust_inputs:{score:0},event_shock:{active:false},execution_inputs:{liquid:true},data_adequate:true,event_kill_switch:false,expected_rr:2,horizon_slots:{'D+1':{},'D+2':{},'D+3':{},'D+4':{},'D+5':{}}});
const packet=()=>({producer:'mobile-v1-intelligence',producer_version:'0.1.0',request_id:'5drreq_test',observations:[
{category:'PRICE_TECHNICALS',source_kind:'SCREENSHOT',source_ref:'evidence-chart-1',observed_at:now,retrieved_at:now,verification:'VERIFIED'},
{category:'DERIVATIVES_OI',source_kind:'SCREENSHOT',source_ref:'evidence-oi-1',observed_at:now,retrieved_at:now,verification:'VERIFIED'},
{category:'MARKET_TRUST',source_kind:'WEB_RESEARCH',source_ref:'source-market',observed_at:now,retrieved_at:now,verification:'VERIFIED'},
{category:'EVENT_SHOCK',source_kind:'WEB_RESEARCH',source_ref:'source-events',observed_at:now,retrieved_at:now,verification:'VERIFIED'},
{category:'EXECUTION_RISK',source_kind:'WEB_RESEARCH',source_ref:'source-execution',observed_at:now,retrieved_at:now,verification:'VERIFIED'}],normalized:normalized()});

test('Mobile V1 user boundary requires only two screenshot categories',()=>{const r=assessUserEvidenceReadiness(['PRICE_TECHNICALS','DERIVATIVES_OI']);assert.equal(r.ready,true);assert.deepEqual(r.missing,[])});
test('complete intelligence packet crosses governed handoff',()=>{const r=canAdvanceIntelligenceHandoff(packet());assert.equal(r.ready,true);assert.equal(r.degraded,false);assert.deepEqual(r.errors,[])});
test('missing derivatives screenshot interpretation fails closed',()=>{const p=packet();p.observations=p.observations.filter(x=>x.category!=='DERIVATIVES_OI');const r=canAdvanceIntelligenceHandoff(p);assert.equal(r.ready,false);assert.ok(r.errors.some(x=>x.includes('DERIVATIVES_OI')))});
test('all nine normalized inputs remain mandatory',()=>{const p=packet();delete (p.normalized as any).expected_rr;const r=canAdvanceIntelligenceHandoff(p);assert.equal(r.ready,false);assert.ok(r.errors.some(x=>x.includes('expected_rr')))});
