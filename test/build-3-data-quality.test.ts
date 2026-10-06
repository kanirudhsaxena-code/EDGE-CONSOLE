import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBuild3EvidenceSnapshot } from '../src/build-3-evidence-snapshot';
import { assessBuild3FiveDrDataQuality, assessBuild3StockDataQuality } from '../src/build-3-data-quality';

const normalized={
  regime:'TREND',
  component_scores:{PRICE_STRUCTURE:40,PVPO:35,PARTICIPATION:20,MACRO_CATALYSTS:10},
  market_trust_inputs:{price_confirmation:70,pvpo_confirmation:65,participation_confirmation:60,cross_engine_consistency:70,closing_confirmation:75,evidence_freshness_completeness:90},
  event_shock:'LOW',event_transmission:'TWO_SIDED',convexity_warranted:false,
  execution_inputs:{rr_score:75,premium_iv_theta_score:70,strike_expiry_fit_score:80,liquidity_spread_score:85,entry_invalidation_score:70},
  data_adequate:true,event_kill_switch:false,expected_rr:2.4,
  horizon_slots:{'D+1':{},'D+2':{},'D+3':{},'D+4':{},'D+5':{}}
};

test('5DR data-quality gate verifies complete fresh mandatory evidence',async()=>{
  const snapshot=await buildBuild3EvidenceSnapshot({
    engine:'5DR',instrument:'NIFTY',source_id:'q-1',
    frozen_at:'2026-10-06T06:30:00Z',
    evidence:{engine_input:{evidence:[{
      evidence_type:'STRUCTURED',source_ref:'evidence://fresh',
      captured_at:'2026-10-06T06:20:00Z',normalized
    }]}}
  });
  const quality=assessBuild3FiveDrDataQuality(snapshot,'INTRADAY');
  assert.equal(quality.overall_state,'VERIFIED');
  assert.equal(quality.valid_for_forecast,true);
  assert.equal(quality.blockers.length,0);
});

test('5DR data-quality gate fails closed on stale mandatory evidence',async()=>{
  const snapshot=await buildBuild3EvidenceSnapshot({
    engine:'5DR',instrument:'NIFTY',source_id:'q-2',
    frozen_at:'2026-10-06T06:30:00Z',
    evidence:{engine_input:{evidence:[{
      evidence_type:'STRUCTURED',source_ref:'evidence://stale',
      captured_at:'2026-10-06T05:00:00Z',normalized
    }]}}
  });
  const quality=assessBuild3FiveDrDataQuality(snapshot,'INTRADAY');
  assert.equal(quality.overall_state,'STALE');
  assert.equal(quality.valid_for_forecast,false);
});

test('5DR data-quality gate exposes missing mandatory inputs',async()=>{
  const snapshot=await buildBuild3EvidenceSnapshot({
    engine:'5DR',instrument:'NIFTY',source_id:'q-3',
    frozen_at:'2026-10-06T06:30:00Z',
    evidence:{engine_input:{evidence:[{
      evidence_type:'STRUCTURED',source_ref:'evidence://partial',
      captured_at:'2026-10-06T06:20:00Z',normalized:{regime:'TREND'}
    }]}}
  });
  const quality=assessBuild3FiveDrDataQuality(snapshot,'INTRADAY');
  assert.equal(quality.overall_state,'MISSING');
  assert.ok(quality.blockers.some(blocker=>blocker.startsWith('component_scores:MISSING')));
});

test('stock gate requires mandatory verified research but keeps optional gaps non-blocking',async()=>{
  const categories=['BUSINESS_FUNDAMENTALS','INSTITUTIONAL_BEHAVIOUR','NEWS_EVENTS_CATALYSTS','VALUATION','EVENT_SHOCK'];
  const claims=categories.map((category,index)=>({
    claim_id:`c${index}`,evidence_category:category,verification_status:'VERIFIED',
    independent_validation:true,source_ids:[`s${index}`]
  }));
  const snapshot=await buildBuild3EvidenceSnapshot({
    engine:'EDGE_STOCKS',instrument:'LTF',source_id:'lc-1',
    frozen_at:'2026-10-06T04:00:00Z',
    evidence:{
      lifecycle:{trigger_type:'USER'},
      market_snapshot:{snapshot_id:'m1',status:'DATA_READY',payload_hash:'a'.repeat(64),captured_at:'2026-10-06T03:55:00Z'},
      research_bundle:{bundle_id:'r1',status:'READY',payload_hash:'b'.repeat(64),research_fresh_at:'2026-10-06T03:50:00Z',payload:{claims}},
      auction_snapshot:null
    }
  });
  const quality=assessBuild3StockDataQuality(snapshot);
  assert.equal(quality.valid_for_forecast,true);
  assert.equal(quality.overall_state,'VERIFIED');
  assert.ok(quality.optional_inputs.every(item=>item.state==='MISSING'));
});

test('scheduled stock run requires fresh auction evidence',async()=>{
  const categories=['BUSINESS_FUNDAMENTALS','INSTITUTIONAL_BEHAVIOUR','NEWS_EVENTS_CATALYSTS','VALUATION','EVENT_SHOCK'];
  const claims=categories.map((category,index)=>({
    claim_id:`c${index}`,evidence_category:category,verification_status:'VERIFIED',
    independent_validation:true,source_ids:[`s${index}`]
  }));
  const snapshot=await buildBuild3EvidenceSnapshot({
    engine:'EDGE_STOCKS',instrument:'LTF',source_id:'lc-2',
    frozen_at:'2026-10-06T03:45:00Z',
    evidence:{
      lifecycle:{trigger_type:'SCHEDULED'},
      market_snapshot:{snapshot_id:'m2',status:'DATA_READY',payload_hash:'a'.repeat(64),captured_at:'2026-10-06T03:20:00Z'},
      research_bundle:{bundle_id:'r2',status:'READY',payload_hash:'b'.repeat(64),research_fresh_at:'2026-10-06T03:35:00Z',payload:{claims}},
      auction_snapshot:null
    }
  });
  const quality=assessBuild3StockDataQuality(snapshot);
  assert.equal(quality.valid_for_forecast,false);
  assert.ok(quality.blockers.includes('AUCTION_DATA:MISSING'));
});
