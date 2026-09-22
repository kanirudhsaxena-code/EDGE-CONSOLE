import test from 'node:test';
import assert from 'node:assert/strict';
import { canAdvanceIntelligenceHandoff } from '../src/intelligence-contract';
import { assessUserEvidenceReadiness } from '../src/evidence-readiness';

const now='2026-09-15T12:00:00.000Z';
const normalized=()=>({
  regime:'RANGE',
  component_scores:{PRICE_STRUCTURE:0,PVPO:0,PARTICIPATION:0,MACRO_CATALYSTS:0},
  market_trust_inputs:{price_confirmation:60,pvpo_confirmation:60,participation_confirmation:60,cross_engine_consistency:60,closing_confirmation:60,evidence_freshness_completeness:80},
  event_shock:'LOW',
  event_transmission:'TWO_SIDED',
  convexity_warranted:false,
  execution_inputs:{rr_score:70,premium_iv_theta_score:65,strike_expiry_fit_score:65,liquidity_spread_score:75,entry_invalidation_score:70},
  data_adequate:true,
  event_kill_switch:false,
  expected_rr:2,
  horizon_slots:{
    'D+1':{direction:'RANGE',probabilities:{BULL:25,RANGE:50,BEAR:25},zone_low:23000,zone_high:23500,basis:'test path 1'},
    'D+2':{direction:'RANGE',probabilities:{BULL:24,RANGE:52,BEAR:24},zone_low:22950,zone_high:23550,basis:'test path 2'},
    'D+3':{direction:'RANGE',probabilities:{BULL:23,RANGE:54,BEAR:23},zone_low:22900,zone_high:23600,basis:'test path 3'},
    'D+4':{direction:'RANGE',probabilities:{BULL:22,RANGE:56,BEAR:22},zone_low:22850,zone_high:23650,basis:'test path 4'},
    'D+5':{direction:'RANGE',probabilities:{BULL:21,RANGE:58,BEAR:21},zone_low:22800,zone_high:23700,basis:'test path 5'}
  }
});
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
