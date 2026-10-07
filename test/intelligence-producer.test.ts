import test from 'node:test';
import assert from 'node:assert/strict';
import {INTELLIGENCE_DETERMINISTIC_FALLBACK_MODEL,INTELLIGENCE_FALLBACK_MODEL,INTELLIGENCE_MODEL,normalizeIntelligenceJudgment,produceIntelligence,validateIntelligenceJudgment,type IntelligenceJudgment} from '../src/intelligence-producer';

const judgment:IntelligenceJudgment={
  verification:'VERIFIED',source_refs:['evidence:1','https://www.nseindia.com/api/marketStatus'],regime:'TREND',
  directional_raw:{
    PRICE_STRUCTURE:{daily_1h_structure:2,key_level_acceptance_rejection:1,volume_confirmation:0,persistence_close:-1},
    PVPO:{price_futures_basis:1,volume_participation:1,premium_behaviour:0,oi_structure_change:-1},
    PARTICIPATION:{heavyweight_contribution:1,sector_leadership_breadth:0,institutional_cash_participation:-1},
    MACRO_CATALYSTS:{global_risk_environment:0,india_macro_rbi_inr_rates:1,crude_commodities_geopolitics:-1,scheduled_high_impact_catalysts:0}
  },
  market_trust_inputs:{price_confirmation:70,pvpo_confirmation:65,participation_confirmation:55,cross_engine_consistency:65,closing_confirmation:70,evidence_freshness_completeness:90},
  event_shock:'LOW',
  event_transmission:'TWO_SIDED',
  convexity_warranted:false,execution_inputs:{rr_score:80,premium_iv_theta_score:70,strike_expiry_fit_score:75,liquidity_spread_score:85,entry_invalidation_score:75},
  data_adequate:true,expected_rr:2.5,horizon_slots:{
    'D+1':{direction:'BULLISH',probabilities:{BULL:58,RANGE:30,BEAR:12},zone_low:23000,zone_high:23300,basis:'Price structure'},
    'D+2':{direction:'BULLISH',probabilities:{BULL:57,RANGE:31,BEAR:12},zone_low:22950,zone_high:23400,basis:'Price structure'},
    'D+3':{direction:'RANGE',probabilities:{BULL:25,RANGE:55,BEAR:20},zone_low:22900,zone_high:23450,basis:'Mixed confirmation'},
    'D+4':{direction:'RANGE',probabilities:{BULL:23,RANGE:54,BEAR:23},zone_low:22850,zone_high:23500,basis:'Mixed confirmation'},
    'D+5':{direction:'RANGE',probabilities:{BULL:24,RANGE:53,BEAR:23},zone_low:22800,zone_high:23550,basis:'Wider uncertainty'}
  },limitations:[]
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


test('rejects publishable judgments with empty D+1 to D+5 forecast slots',()=>{
  const empty={...judgment,horizon_slots:{'D+1':{},'D+2':{},'D+3':{},'D+4':{},'D+5':{}}};
  const result=validateIntelligenceJudgment(empty,new Set(judgment.source_refs));
  assert.equal(result.judgment,null);
  assert.ok(result.errors.some(error=>error.includes('D+1')));
});

test('day-wise forecast path remains required even when trade execution is weak',()=>{
  const weak={...judgment,data_adequate:false,expected_rr:0,execution_inputs:{rr_score:0,premium_iv_theta_score:0,strike_expiry_fit_score:0,liquidity_spread_score:0,entry_invalidation_score:0}};
  const result=validateIntelligenceJudgment(weak,new Set(judgment.source_refs));
  assert.ok(result.judgment);
  assert.equal(result.judgment?.horizon_slots['D+5'].direction,'RANGE');
});




test('rejects day-wise probability vectors that do not total 100',()=>{
  const bad=structuredClone(judgment) as IntelligenceJudgment;
  (bad.horizon_slots['D+1'] as any).probabilities={BULL:58,RANGE:30,BEAR:20};
  const result=validateIntelligenceJudgment(bad,new Set(judgment.source_refs));
  assert.equal(result.judgment,null);
  assert.ok(result.errors.some(error=>error.includes('sum to 100')));
});

test('rejects a day-wise direction that is not the highest-probability scenario',()=>{
  const bad=structuredClone(judgment) as IntelligenceJudgment;
  (bad.horizon_slots['D+1'] as any).direction='BEARISH';
  const result=validateIntelligenceJudgment(bad,new Set(judgment.source_refs));
  assert.equal(result.judgment,null);
  assert.ok(result.errors.some(error=>error.includes('highest scenario probability')));
});

test('falls back to secondary governed model only when primary inference throws',async()=>{
  const calls:string[]=[];
  const ai={
    run:async(model:string)=>{
      calls.push(model);
      if(model===INTELLIGENCE_MODEL)throw new Error('capacity unavailable');
      return {response:JSON.stringify(judgment)};
    }
  };
  const result=await produceIntelligence(ai,{demo:true},new Set(judgment.source_refs));
  assert.equal(result.model,INTELLIGENCE_FALLBACK_MODEL);
  assert.ok(result.judgment);
  assert.equal(result.errors.length,0);
  assert.deepEqual(calls,[INTELLIGENCE_MODEL,INTELLIGENCE_FALLBACK_MODEL]);
});

test('remains fail closed if primary and fallback inference are both unavailable',async()=>{
  const ai={run:async()=>{throw new Error('capacity unavailable')}};
  const result=await produceIntelligence(ai,{demo:true},new Set(judgment.source_refs));
  assert.equal(result.judgment,null);
  assert.equal(result.normalized,null);
  assert.ok(result.errors[0].includes('all governed intelligence inference models unavailable'));
});


test('quota exhaustion uses deterministic degraded reconciliation only from supplied structured evidence',async()=>{
  const refs={
    price:'upstox-bundle://x#price-technicals',
    derivatives:'upstox-bundle://x#derivatives-oi',
    trust:'upstox-bundle://x#market-trust',
    execution:'upstox-bundle://x#execution-risk',
    event:'https://www.rbi.org.in/'
  };
  const tf=(state:string,low:number,high:number)=>({
    trend_structure:{state},
    range_event:{prior_range_low:low,prior_range_high:high,close_state:'CLOSE_INSIDE_PRIOR_RANGE'},
    volume_confirmation:{relative_to_median:null}
  });
  const packet={
    market_observations:[
      {category:'PRICE_TECHNICALS',source_ref:refs.price,structured_data:{
        nifty:{spot:{last_price:22555.75,change_pct_vs_previous_close:0.6}},
        chart:{timeframes:{
          '15m':tf('UPTREND_STRUCTURE',22397.1,22569.4),
          '30m':tf('MIXED_OR_TRANSITION_STRUCTURE',22217.3,22621.8),
          '1h':tf('MIXED_OR_TRANSITION_STRUCTURE',22217.3,22809.35),
          '1d':tf('DOWNTREND_STRUCTURE',22569.65,24025.4),
        }}
      },findings:[{label:'Current Price',value:22555.75}]},
      {category:'DERIVATIVES_OI',source_ref:refs.derivatives,structured_data:{
        nifty_futures:{basis_pct_of_spot:0.30},
        derivative_analytics:{pcr:{pcr:0.91}}
      }},
      {category:'MARKET_TRUST',source_ref:refs.trust,structured_data:{
        heavyweights:{instruments:{a:{change_pct_vs_previous_close:1.2},b:{change_pct_vs_previous_close:-0.3}}},
        sectors:{instruments:{a:{change_pct_vs_previous_close:0.4},b:{change_pct_vs_previous_close:0.2}}},
        fii_dii_cash:{fii:{buy_amount:100,sell_amount:200},dii:{buy_amount:300,sell_amount:100}},
        global_risk:{instruments:{a:{change_pct_vs_previous_close:0.5},b:{change_pct_vs_previous_close:0.3}}}
      }},
      {category:'EXECUTION_RISK',source_ref:refs.execution,structured_data:{
        selected_expiry:'2026-10-06',
        sample_strikes:[
          {CE:{bid_ask_spread_pct_mid:0.7,iv:16,theta:-30},PE:{bid_ask_spread_pct_mid:0.8,iv:17,theta:-31}},
          {CE:{bid_ask_spread_pct_mid:0.9,iv:16,theta:-30},PE:{bid_ask_spread_pct_mid:1.0,iv:17,theta:-31}},
          {CE:{bid_ask_spread_pct_mid:0.6,iv:16,theta:-30},PE:{bid_ask_spread_pct_mid:0.7,iv:17,theta:-31}}
        ]
      }}
    ],
    research:[
      {category:'EVENT_SHOCK',status:'RETRIEVED',source_ref:refs.event,facts:{
        wti_usd_per_barrel:{change_from_first:3.2},
        brent_usd_per_barrel:{change_from_first:2.8}
      }}
    ]
  };
  const ai={run:async()=>{throw new Error('4006: you have used up your daily free allocation of 10,000 neurons')}};
  const result=await produceIntelligence(ai,packet,new Set(Object.values(refs)));
  assert.equal(result.model,INTELLIGENCE_DETERMINISTIC_FALLBACK_MODEL);
  assert.equal(result.errors.length,0);
  assert.equal(result.judgment?.verification,'DEGRADED');
  assert.equal(result.judgment?.data_adequate,false);
  assert.equal(result.judgment?.expected_rr,0);
  assert.deepEqual(new Set(result.judgment?.source_refs),new Set(Object.values(refs)));
  assert.equal(result.judgment?.horizon_slots['D+1'].direction,'BULLISH');
  assert.equal(result.judgment?.horizon_slots['D+4'].direction,'BEARISH');
  assert.ok(result.normalized);
  assert.equal(result.normalized?.event_kill_switch,false);
});

test('deterministic quota fallback remains fail closed if a required evidence family is absent',async()=>{
  const ai={run:async()=>{throw new Error('4006: daily free allocation exhausted')}};
  const packet={market_observations:[
    {category:'PRICE_TECHNICALS',source_ref:'price',structured_data:{}},
    {category:'DERIVATIVES_OI',source_ref:'derivatives',structured_data:{}},
    {category:'MARKET_TRUST',source_ref:'trust',structured_data:{}},
    {category:'EXECUTION_RISK',source_ref:'execution',structured_data:{}}
  ],research:[]};
  const result=await produceIntelligence(ai,packet,new Set(['price','derivatives','trust','execution']));
  assert.equal(result.judgment,null);
  assert.equal(result.normalized,null);
  assert.ok(result.errors[0].includes('intelligence inference unavailable'));
});


test('rejects intelligence judgment with zero expected R:R and non-zero rr_score',()=>{
  const bad={...judgment,expected_rr:0,execution_inputs:{...judgment.execution_inputs,rr_score:60}};
  const result=validateIntelligenceJudgment(bad,new Set(judgment.source_refs));
  assert.equal(result.judgment,null);
  assert.ok(result.errors.some(error=>error.includes('rr_score must be 0 when expected_rr is 0')));
});


test('producer conservatively repairs only the zero-RR semantic mismatch',async()=>{
  const bad={...judgment,expected_rr:0,execution_inputs:{...judgment.execution_inputs,rr_score:60}};
  const ai={run:async()=>({response:JSON.stringify(bad)})};
  const result=await produceIntelligence(ai,{demo:true},new Set(judgment.source_refs));
  assert.ok(result.judgment);
  assert.equal(result.judgment?.expected_rr,0);
  assert.equal(result.judgment?.execution_inputs.rr_score,0);
  assert.ok(result.judgment?.limitations.some(x=>x.includes('Build 2.75 semantic invariant')));
});
