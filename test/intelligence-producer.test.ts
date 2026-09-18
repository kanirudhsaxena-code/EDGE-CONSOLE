import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeIntelligenceJudgment,validateIntelligenceJudgment,type IntelligenceJudgment} from '../src/intelligence-producer';

const judgment:IntelligenceJudgment={
  verification:'VERIFIED',source_refs:['evidence:1','https://www.nseindia.com/api/marketStatus'],regime:'TREND',
  directional_raw:{
    PRICE_STRUCTURE:{daily_1h_structure:2,key_level_acceptance_rejection:1,volume_confirmation:0,persistence_close:-1},
    PVPO:{price_futures_basis:1,volume_participation:1,premium_behaviour:0,oi_structure_change:-1},
    PARTICIPATION:{heavyweight_contribution:1,sector_leadership_breadth:0,institutional_cash_participation:-1},
    MACRO_CATALYSTS:{global_risk_environment:0,india_macro_rbi_inr_rates:1,crude_commodities_geopolitics:-1,scheduled_high_impact_catalysts:0}
  },
  market_trust_inputs:{price_confirmation:70,pvpo_confirmation:65,participation_confirmation:55,cross_engine_consistency:65,closing_confirmation:70,evidence_freshness_completeness:90},
  event_shock:'LOW',execution_inputs:{rr_score:80,premium_iv_theta_score:70,strike_expiry_fit_score:75,liquidity_spread_score:85,entry_invalidation_score:75},
  data_adequate:true,expected_rr:2.5,horizon_slots:{'D+1':{},'D+2':{},'D+3':{},'D+4':{},'D+5':{}},limitations:[]
};

test('deterministically applies frozen internal directional weights',()=>{
  const normalized=normalizeIntelligenceJudgment(judgment);
  assert.deepEqual(normalized.component_scores,{PRICE_STRUCTURE:45,PVPO:12.5,PARTICIPATION:12.5,MACRO_CATALYSTS:0});
  assert.equal(normalized.event_kill_switch,false);
});

test('EXTREME event shock deterministically activates kill switch',()=>{
  const normalized=normalizeIntelligenceJudgment({...judgment,event_shock:'EXTREME'});
  assert.equal(normalized.event_kill_switch,true);
});

test('rejects invented provenance references',()=>{
  const result=validateIntelligenceJudgment({...judgment,source_refs:['invented://source']},new Set(judgment.source_refs));
  assert.equal(result.judgment,null);
  assert.ok(result.errors.some(error=>error.includes('source_refs')));
});

test('rejects unavailable judgment that claims adequate data',()=>{
  const result=validateIntelligenceJudgment({...judgment,verification:'UNAVAILABLE',data_adequate:true},new Set(judgment.source_refs));
  assert.equal(result.judgment,null);
  assert.ok(result.errors.some(error=>error.includes('data_adequate')));
});
