type JsonRecord=Record<string,unknown>;

const isObject=(value:unknown):value is JsonRecord=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const nonEmpty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
const scenarioKeys=['BULL','RANGE','BEAR'] as const;

function probabilities(value:unknown):Record<(typeof scenarioKeys)[number],number>{
  if(!isObject(value))throw new Error('5DR release blocked: overall probabilities missing');
  const out={BULL:Number(value.BULL),RANGE:Number(value.RANGE),BEAR:Number(value.BEAR)};
  if(Object.values(out).some(v=>!Number.isFinite(v)||v<0||v>100))throw new Error('5DR release blocked: overall probabilities invalid');
  if(Math.abs(out.BULL+out.RANGE+out.BEAR-100)>0.02)throw new Error('5DR release blocked: overall probabilities must total 100');
  return out;
}

function selectedScenario(probs:Record<string,number>):'BULL'|'RANGE'|'BEAR'{
  const entries=(['BULL','RANGE','BEAR'] as const).map(key=>[key,Number(probs[key])] as const);
  entries.sort((a,b)=>b[1]-a[1]);
  return entries[0][0];
}

function classification(current:'BULL'|'RANGE'|'BEAR',previous:'BULL'|'RANGE'|'BEAR'|null):'IMPROVED'|'UNCHANGED'|'WORSENED'|'REVERSED'{
  if(!previous||current===previous)return 'UNCHANGED';
  if((current==='BULL'&&previous==='BEAR')||(current==='BEAR'&&previous==='BULL'))return 'REVERSED';
  if(previous==='RANGE'&&current!=='RANGE')return 'IMPROVED';
  if(current==='RANGE'&&previous!=='RANGE')return 'WORSENED';
  return 'REVERSED';
}

function strongestComponents(value:unknown):string{
  if(!isObject(value))return 'No component-score detail was preserved.';
  return Object.entries(value)
    .filter(([,score])=>finite(score))
    .sort((a,b)=>Math.abs(Number(b[1]))-Math.abs(Number(a[1])))
    .slice(0,2)
    .map(([name,score])=>`${name.replaceAll('_',' ')} ${Number(score).toFixed(1)}`)
    .join(' · ')||'No component-score detail was preserved.';
}

function probabilityDelta(current:Record<string,number>,previous:Record<string,number>|null):string{
  if(!previous)return 'No predecessor was available for comparison.';
  return scenarioKeys.map(key=>{
    const delta=current[key]-Number(previous[key]);
    return `${key} ${delta>=0?'+':''}${delta.toFixed(1)}pp`;
  }).join(' · ');
}

function requiredAssessmentSnapshot(row:unknown):{snapshot:JsonRecord;metrics:JsonRecord;ledger:unknown[]}{
  if(!isObject(row))throw new Error('5DR release blocked: assessment snapshot unavailable');
  const metrics=isObject(row.metrics)?row.metrics:null;
  if(!metrics||metrics.assessment_snapshot_complete!==true)throw new Error('5DR release blocked: assessment snapshot is incomplete');
  const ledger=Array.isArray(metrics.recommendation_ledger)?metrics.recommendation_ledger:null;
  if(!ledger||metrics.recommendation_ledger_complete!==true)throw new Error('5DR release blocked: recommendation ledger is incomplete');
  return {
    snapshot:{
      source_id:row.source_id??null,
      assessed_at:row.assessed_at??null,
      headline:row.headline??null,
      score:row.score??null,
      metrics
    },
    metrics,
    ledger
  };
}

function eventState(metadata:JsonRecord):JsonRecord{
  const reconciliation=isObject(metadata.intelligence_reconciliation)?metadata.intelligence_reconciliation:{};
  const judgment=isObject(reconciliation.judgment)?reconciliation.judgment:{};
  const handoff=isObject(metadata.intelligence_handoff)?metadata.intelligence_handoff:{};
  const normalized=isObject(handoff.normalized)?handoff.normalized:{};
  const level=String(judgment.event_shock??normalized.event_shock??'');
  const transmission=String(judgment.event_shock_transmission??'');
  const convexity=judgment.convexity_warranted;
  if(!['LOW','MODERATE','HIGH','EXTREME'].includes(level))throw new Error('5DR release blocked: Event Shock level missing');
  if(!['BULLISH','BEARISH','TWO_SIDED'].includes(transmission))throw new Error('5DR release blocked: Event Shock transmission missing');
  if(typeof convexity!=='boolean')throw new Error('5DR release blocked: Convexity Warranted missing');
  return {level,expected_transmission:transmission,convexity_warranted:convexity?'YES':'NO',kill_switch:level==='EXTREME'};
}

function normalizedState(metadata:JsonRecord):JsonRecord{
  const handoff=isObject(metadata.intelligence_handoff)?metadata.intelligence_handoff:{};
  const normalized=isObject(handoff.normalized)?handoff.normalized:null;
  if(!normalized)throw new Error('5DR release blocked: normalized intelligence missing');
  return normalized;
}

function previousResult(previousRun:unknown):JsonRecord|null{
  if(!isObject(previousRun)||!isObject(previousRun.result))return null;
  return previousRun.result;
}

function currentRecommendation(result:JsonRecord,metadata:JsonRecord,event:JsonRecord):{recommendation:string;assessment:string;tradePlan:JsonRecord}{
  const normalized=normalizedState(metadata);
  const expectedRr=Number(normalized.expected_rr??0);
  const des=Number(result.des5);
  const trust=Number(result.market_trust);
  const edge=Number(result.execution_edge);
  const tradeable=result.tradeable===true;
  const plan=isObject(metadata.trade_plan)?metadata.trade_plan:null;
  const completePlan=!!plan&&nonEmpty(plan.recommendation)&&['BUY_CE','BUY_PE','BUY_CONVEXITY'].includes(String(plan.recommendation))&&nonEmpty(plan.expiry)&&finite(plan.strike)&&finite(plan.entry_low)&&finite(plan.entry_high)&&finite(plan.stop)&&finite(plan.target1)&&finite(plan.target2);
  const permitted=tradeable&&completePlan;
  const recommendation=permitted?String(plan!.recommendation):'NO_TRADE';
  const blockers=Array.isArray(result.tradeability_blockers)?result.tradeability_blockers.map(String):[];
  if(tradeable&&!completePlan)blockers.push('EXECUTION_PLAN_INCOMPLETE');
  const assessment=(permitted?'PERMITTED':'REJECTED')+
    ` — |DES5| ${Math.abs(des).toFixed(1)} ${Math.abs(des)>=30?'passes':'fails'} 30; Market Trust ${trust.toFixed(1)} ${trust>=50?'passes':'fails'} 50; Execution Edge ${edge.toFixed(1)} ${edge>=65?'passes':'fails'} 65; R:R ${expectedRr.toFixed(2)} ${expectedRr>=2?'passes':'fails'} 2.0; Event Shock ${String(event.level)} / Kill Switch ${event.kill_switch?'ACTIVE':'inactive'}.`+
    (blockers.length?` Trade-specific risk/blocker: ${blockers.join(', ')}.`:' No additional trade-specific blocker was preserved.');
  const tradePlan=completePlan?{...plan}:{
    recommendation:'NO_TRADE',instrument:'NONE',strike:null,expiry:null,entry_low:null,entry_high:null,stop:null,target1:null,target2:null,expected_rr:expectedRr,time_exit:null
  };
  return {recommendation,assessment,tradePlan};
}

export function build5drReleaseEnvelope(args:{
  envelope:unknown;
  requestMetadata:unknown;
  assessmentRow:unknown;
  predecessorRun?:unknown;
}):JsonRecord{
  if(!isObject(args.envelope)||!isObject(args.envelope.result))throw new Error('5DR release blocked: raw engine envelope invalid');
  const envelope={...args.envelope};
  const result={...args.envelope.result};
  const metadata=isObject(args.requestMetadata)?args.requestMetadata:{};
  const normalized=normalizedState(metadata);
  const slots=isObject(result.horizon_slots)?result.horizon_slots:null;
  if(!slots||!isObject(slots['D+5']))throw new Error('5DR release blocked: D+5 expected zone missing');
  const d5=slots['D+5'] as JsonRecord;
  if(!finite(d5.zone_low)||!finite(d5.zone_high))throw new Error('5DR release blocked: D+5 expected zone invalid');

  const currentProbs=probabilities(result.probabilities);
  const currentScenario=selectedScenario(currentProbs);
  const prior=previousResult(args.predecessorRun);
  let priorProbs:Record<string,number>|null=null,priorScenario:'BULL'|'RANGE'|'BEAR'|null=null;
  if(prior){
    try{priorProbs=probabilities(prior.probabilities);priorScenario=selectedScenario(priorProbs)}catch{}
  }
  const assessmentClass=classification(currentScenario,priorScenario);
  const reconciliation=isObject(metadata.intelligence_reconciliation)?metadata.intelligence_reconciliation:{};
  const limitations=Array.isArray(reconciliation.limitations)?reconciliation.limitations.map(String):[];
  const event=eventState(metadata);
  const principalRisk=limitations[0]??(Array.isArray(result.tradeability_blockers)&&result.tradeability_blockers.length?String(result.tradeability_blockers[0]):`Event Shock ${String(event.level)}; thesis must be reassessed if the governed evidence set materially changes.`);
  const forecastAssessment=`${assessmentClass} — ${currentScenario} leads at ${currentProbs[currentScenario].toFixed(1)}%; DES5 ${Number(result.des5).toFixed(1)}; Market Trust ${Number(result.market_trust).toFixed(1)}/100. Supporting evidence: ${strongestComponents(normalized.component_scores)}. Material change versus predecessor: ${probabilityDelta(currentProbs,priorProbs)}. Principal risk/invalidation: ${principalRisk}`;

  const assessment=requiredAssessmentSnapshot(args.assessmentRow);
  const recommendation=currentRecommendation(result,metadata,event);
  const currentLedgerEntry={
    run_id:envelope.run_id??null,
    run_timestamp:envelope.generated_at??null,
    definitive_forecast:currentScenario==='BULL'?'BULLISH':currentScenario==='BEAR'?'BEARISH':'RANGE',
    probabilities:currentProbs,
    recommendation:recommendation.recommendation,
    execution:recommendation.tradePlan,
    lifecycle:{latest_event:recommendation.recommendation==='NO_TRADE'?'NO_TRADE':'ISSUED',event_timestamp:envelope.generated_at??null,pnl_pct:null,r_multiple:null},
    canonical_target_trading_date:null
  };
  const ledger=[...assessment.ledger,currentLedgerEntry];

  result.forecast_assessment=forecastAssessment;
  result.forecast_assessment_class=assessmentClass;
  result.recommendation_assessment=recommendation.assessment;
  result.assessment_snapshot_complete=true;
  result.assessment_snapshot=assessment.snapshot;
  result.recommendation_ledger_complete=true;
  result.recommendation_ledger=ledger;
  result.expected_nifty_zone={low:Number(d5.zone_low),high:Number(d5.zone_high),source_horizon:'D+5'};
  result.regime=normalized.regime;
  result.event_shock=event;
  result.directional_trade=result.tradeable===true;
  result.recommendation=recommendation.recommendation;
  result.trade_plan=recommendation.tradePlan;
  result.engine_diagnostics={
    component_scores:normalized.component_scores??null,
    market_trust_inputs:normalized.market_trust_inputs??null,
    execution_inputs:normalized.execution_inputs??null,
    expected_rr:normalized.expected_rr??null,
    data_adequate:normalized.data_adequate??null,
    limitations
  };
  result.evidence_delta={
    predecessor_run_id:isObject(args.predecessorRun)?args.predecessorRun.run_id??null:null,
    probability_delta:priorProbs?Object.fromEntries(scenarioKeys.map(key=>[key,Number((currentProbs[key]-Number(priorProbs![key])).toFixed(3))])):null,
    des5_delta:prior&&finite(prior.des5)?Number((Number(result.des5)-Number(prior.des5)).toFixed(3)):null,
    market_trust_delta:prior&&finite(prior.market_trust)?Number((Number(result.market_trust)-Number(prior.market_trust)).toFixed(3)):null
  };

  envelope.result=result;
  return envelope;
}
