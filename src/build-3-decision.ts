import { neon } from '@neondatabase/serverless';
import { canonicalBuild3EvidenceJson } from './build-3-evidence-snapshot';
import type { Build3Forecast, Build3Direction } from './build-3-forecast-contract';

export const BUILD3_DECISION_VERSION='MDOS_BUILD_3_DECISION_V1' as const;

export type Build3GateResult={
  gate:string;
  passed:boolean|null;
  observed:unknown;
  threshold:string|null;
};

export type Build3NoTradeCounterfactual={
  applicable:boolean;
  diagnostic_only:true;
  issued_trade:false;
  availability:'AVAILABLE'|'PARTIAL'|'NOT_AVAILABLE';
  direction_candidate:'BULL'|'RANGE'|'BEAR'|null;
  instrument_expression:string|null;
  entry_logic:string|null;
  invalidation:string|null;
  expected_rr:number|null;
  target1:number|null;
  target2:number|null;
  rejecting_gates:string[];
};

export type Build3ExecutionSnapshot={
  applicable:boolean;
  availability:'COMPLETE'|'PARTIAL'|'NOT_AVAILABLE';
  action:'LONG_ENTRY'|'LONG_EXIT'|'OPTION_CALL'|'OPTION_PUT'|'OPTION_CONVEXITY'|'NONE'|'UNKNOWN';
  instrument_expression:string|null;
  entry_low:number|null;
  entry_high:number|null;
  stop:number|null;
  target1:number|null;
  target2:number|null;
  time_exit:string|null;
  exact_contract_verified:boolean;
  reason:string|null;
};

export type Build3DecisionRecord={
  decision_version:typeof BUILD3_DECISION_VERSION;
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  issued_at:string;
  forecast_direction:Build3Direction;
  decision_state:'ACTIONABLE'|'NO_TRADE';
  recommendation:string;
  tradeable:boolean;
  evidence_snapshot_id:string;
  evidence_hash:string;
  gate_results:Build3GateResult[];
  rejecting_gates:string[];
  counterfactual:Build3NoTradeCounterfactual;
  execution_snapshot:Build3ExecutionSnapshot;
};

const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const num=(value:unknown):number|null=>{
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
};
const textOrNull=(value:unknown):string|null=>{
  const text=String(value??'').trim();
  return text?text:null;
};
const boolOrNull=(value:unknown):boolean|null=>typeof value==='boolean'?value:null;
const unique=(values:string[])=>[...new Set(values.map(value=>value.trim()).filter(Boolean))];

function directionFrom(value:unknown,fallback:Build3Direction):Build3Direction{
  const upper=String(value??'').trim().toUpperCase();
  if(upper==='BULL'||upper==='BULLISH')return 'BULL';
  if(upper==='BEAR'||upper==='BEARISH')return 'BEAR';
  if(upper==='RANGE'||upper==='BASE'||upper==='BASE_RANGE')return 'RANGE';
  return fallback;
}

function emptyCounterfactual():Build3NoTradeCounterfactual{
  return {
    applicable:false,diagnostic_only:true,issued_trade:false,availability:'NOT_AVAILABLE',
    direction_candidate:null,instrument_expression:null,entry_logic:null,invalidation:null,
    expected_rr:null,target1:null,target2:null,rejecting_gates:[],
  };
}

function emptyExecution(reason:string):Build3ExecutionSnapshot{
  return {
    applicable:false,availability:'NOT_AVAILABLE',action:'NONE',instrument_expression:null,
    entry_low:null,entry_high:null,stop:null,target1:null,target2:null,time_exit:null,
    exact_contract_verified:false,reason,
  };
}

function executionAvailability(values:Array<unknown>):'COMPLETE'|'PARTIAL'|'NOT_AVAILABLE'{
  const present=values.filter(value=>value!==null&&value!==undefined&&value!=='').length;
  if(present===0)return 'NOT_AVAILABLE';
  if(present===values.length)return 'COMPLETE';
  return 'PARTIAL';
}

function niftyExecutionSnapshot(
  recommendation:string,
  result:Record<string,unknown>,
):Build3ExecutionSnapshot{
  if(recommendation==='NO_TRADE')return emptyExecution('NO_ISSUED_TRADE');
  const supplied=isObject(result.execution_snapshot)
    ?result.execution_snapshot
    :isObject(result.execution_plan)?result.execution_plan:{};
  const instrument=textOrNull(supplied.contract_symbol??supplied.instrument_expression??supplied.instrument);
  const entryLow=num(supplied.entry_low??supplied.entry??supplied.observed_premium);
  const entryHigh=num(supplied.entry_high??supplied.entry??supplied.observed_premium);
  const stop=num(supplied.stop??supplied.stop_price??supplied.stop_premium);
  const target1=num(supplied.target1??supplied.target1_premium);
  const target2=num(supplied.target2??supplied.target2_premium);
  const timeExit=textOrNull(supplied.time_exit??supplied.expiry);
  const action=recommendation==='BUY_CE'?'OPTION_CALL'
    :recommendation==='BUY_PE'?'OPTION_PUT'
    :recommendation==='BUY_CONVEXITY'?'OPTION_CONVEXITY'
    :'UNKNOWN';
  const availability=executionAvailability([instrument,entryLow,entryHigh,stop,target1]);
  return {
    applicable:true,availability,action,instrument_expression:instrument,
    entry_low:entryLow,entry_high:entryHigh,stop,target1,target2,time_exit:timeExit,
    exact_contract_verified:availability==='COMPLETE'&&!!instrument,
    reason:availability==='COMPLETE'?null:'EXACT_ISSUED_EXECUTION_PACKET_NOT_BOUND',
  };
}

function stockExecutionSnapshot(
  recommendation:string,
  execution:Record<string,unknown>,
):Build3ExecutionSnapshot{
  const actionable=new Set(['STRONG BUY','BUY','ACCUMULATE','SELL','REDUCE']);
  if(!actionable.has(recommendation))return emptyExecution('NO_ISSUED_TRADE');
  const instrument=textOrNull(execution.instrument);
  const entryLow=num(execution.entry_low);
  const entryHigh=num(execution.entry_high);
  const stop=num(execution.stop_price);
  const target1=num(execution.target1);
  const target2=num(execution.target2);
  const timeExit=textOrNull(execution.time_exit);
  const availability=executionAvailability([instrument,entryLow,entryHigh,stop,target1]);
  const action=['STRONG BUY','BUY','ACCUMULATE'].includes(recommendation)?'LONG_ENTRY':'LONG_EXIT';
  return {
    applicable:true,availability,action,instrument_expression:instrument,
    entry_low:entryLow,entry_high:entryHigh,stop,target1,target2,time_exit:timeExit,
    exact_contract_verified:availability==='COMPLETE'&&['EQUITY','EQUITY_EXIT'].includes(String(instrument??'').toUpperCase()),
    reason:availability==='COMPLETE'?null:'ISSUED_EXECUTION_LEVELS_INCOMPLETE',
  };
}

export function buildNiftyBuild3Decision(
  forecast:Build3Forecast,
  result:Record<string,unknown>,
):Build3DecisionRecord{
  if(forecast.engine!=='5DR')throw new Error('BUILD3_DECISION_NIFTY_FORECAST_REQUIRED');
  const recommendation=String(result.recommendation??'').trim().toUpperCase();
  if(!['BUY_CE','BUY_PE','BUY_CONVEXITY','NO_TRADE'].includes(recommendation)){
    throw new Error('BUILD3_DECISION_NIFTY_RECOMMENDATION_INVALID');
  }
  if(typeof result.tradeable!=='boolean')throw new Error('BUILD3_DECISION_NIFTY_TRADEABLE_MISSING');
  const tradeable=result.tradeable;
  if((recommendation==='NO_TRADE')===tradeable)throw new Error('BUILD3_DECISION_NIFTY_STATE_CONFLICT');

  const engineDiagnostics=isObject(result.engine_diagnostics)?result.engine_diagnostics:{};
  const event=isObject(result.event_shock)?result.event_shock:{};
  const trust=num(result.market_trust);
  const des=num(result.des5);
  const edge=num(result.execution_edge);
  const rr=num(result.expected_rr);
  const dataAdequate=boolOrNull(engineDiagnostics.data_adequate);
  const killSwitch=boolOrNull(event.kill_switch);
  const gates:Build3GateResult[]=[
    {gate:'DATA_ADEQUATE',passed:dataAdequate,observed:dataAdequate,threshold:'true'},
    {gate:'MARKET_TRUST',passed:trust===null?null:trust>=50,observed:trust,threshold:'>=50'},
    {gate:'ABS_DES5',passed:des===null?null:Math.abs(des)>=30,observed:des,threshold:'abs >=30'},
    {gate:'EXECUTION_EDGE',passed:edge===null?null:edge>=65,observed:edge,threshold:'>=65'},
    {gate:'EVENT_KILL_SWITCH_INACTIVE',passed:killSwitch===null?null:!killSwitch,observed:killSwitch,threshold:'false'},
    {gate:'EXPECTED_RR',passed:rr===null?null:rr>=2,observed:rr,threshold:'>=2.0'},
  ];
  const blockers=Array.isArray(result.tradeability_blockers)?result.tradeability_blockers.map(String):[];
  const rejecting=unique([
    ...blockers,
    ...gates.filter(gate=>gate.passed===false).map(gate=>gate.gate),
  ]);
  const forecastDirection=directionFrom(result.definitive_forecast,forecast.horizons[0].direction);
  let counterfactual=emptyCounterfactual();
  if(recommendation==='NO_TRADE'){
    const supplied=isObject(result.rejected_counterfactual)?result.rejected_counterfactual:{};
    const entry=textOrNull(supplied.entry_logic);
    const invalidation=textOrNull(supplied.invalidation);
    const instrument=textOrNull(supplied.instrument_expression);
    const t1=num(supplied.target1);
    const t2=num(supplied.target2);
    const hasExecution=!!(entry||invalidation||instrument||t1!==null||t2!==null);
    counterfactual={
      applicable:true,
      diagnostic_only:true,
      issued_trade:false,
      availability:hasExecution?'AVAILABLE':rr!==null?'PARTIAL':'NOT_AVAILABLE',
      direction_candidate:forecastDirection,
      instrument_expression:instrument,
      entry_logic:entry,
      invalidation,
      expected_rr:rr,
      target1:t1,
      target2:t2,
      rejecting_gates:rejecting,
    };
  }
  return {
    decision_version:BUILD3_DECISION_VERSION,
    engine:'5DR',
    instrument:forecast.instrument,
    source_id:forecast.source_id,
    issued_at:forecast.issued_at,
    forecast_direction:forecastDirection,
    decision_state:recommendation==='NO_TRADE'?'NO_TRADE':'ACTIONABLE',
    recommendation,
    tradeable,
    evidence_snapshot_id:forecast.evidence_snapshot_id,
    evidence_hash:forecast.evidence_hash,
    gate_results:gates,
    rejecting_gates:rejecting,
    counterfactual,
    execution_snapshot:niftyExecutionSnapshot(recommendation,result),
  };
}

export type Build3StockDecisionSource={
  definitive_forecast:unknown;
  definitive_recommendation:unknown;
  des:unknown;
  market_trust_score:unknown;
  bot_grade:unknown;
  decision_ladder:unknown;
  evidence_gate_status:unknown;
  event_shock_level:unknown;
  active_override:unknown;
  rationale:unknown;
  execution_plan?:Record<string,unknown>|null;
};

export function buildStockBuild3Decision(
  forecast:Build3Forecast,
  source:Build3StockDecisionSource,
):Build3DecisionRecord{
  if(forecast.engine!=='EDGE_STOCKS')throw new Error('BUILD3_DECISION_STOCK_FORECAST_REQUIRED');
  const recommendation=String(source.definitive_recommendation??'').trim().toUpperCase();
  if(!recommendation)throw new Error('BUILD3_DECISION_STOCK_RECOMMENDATION_MISSING');
  const actionable=new Set(['STRONG BUY','BUY','ACCUMULATE','SELL','REDUCE']);
  const tradeable=actionable.has(recommendation);
  const noTrade=!tradeable;
  const forecastDirection=directionFrom(source.definitive_forecast,forecast.horizons[0].direction);
  const execution=isObject(source.execution_plan)?source.execution_plan:{};
  const rr=num(execution.rr_t1);
  const execQuality=num(execution.execution_quality_score);
  const evidence=String(source.evidence_gate_status??'').toUpperCase();
  const ladder=String(source.decision_ladder??'').toUpperCase();
  const override=String(source.active_override??'').toUpperCase();
  const eventBlocked=override==='O3'||(override==='O2'&&forecastDirection==='BULL');
  const gates:Build3GateResult[]=[
    {gate:'EVIDENCE_GATE',passed:evidence?evidence==='PASS':null,observed:evidence||null,threshold:'PASS'},
    {gate:'DECISION_LADDER_ACTIONABLE',passed:ladder?['PILOT','PARTIAL','FULL'].includes(ladder):null,observed:ladder||null,threshold:'PILOT|PARTIAL|FULL'},
    {gate:'EXECUTION_RR',passed:rr===null?null:rr>=1.2,observed:rr,threshold:'>=1.2 when available'},
    {gate:'EXECUTION_QUALITY',passed:execQuality===null?null:execQuality>=40,observed:execQuality,threshold:'>=40 minimum frozen rejection threshold'},
    {gate:'EVENT_OVERRIDE',passed:!eventBlocked,observed:override||null,threshold:'not O3; O2 blocks bullish new action'},
  ];
  const reasonCandidates=[
    textOrNull(source.rationale),
    textOrNull(execution.notes),
    textOrNull(execution.invalidation_text),
    ...gates.filter(gate=>gate.passed===false).map(gate=>gate.gate),
  ].filter((value):value is string=>value!==null);
  const rejecting=unique(noTrade?reasonCandidates:[]);
  let counterfactual=emptyCounterfactual();
  if(noTrade){
    const instrument=String(execution.instrument??'').toUpperCase();
    const expression=instrument&&instrument!=='NONE'?instrument:null;
    const entryLow=num(execution.entry_low);
    const entryHigh=num(execution.entry_high);
    const entry=entryLow!==null||entryHigh!==null
      ?`issued diagnostic entry band ${entryLow??'?'}..${entryHigh??'?'}`
      :null;
    const invalidation=textOrNull(execution.invalidation_text);
    const target1=num(execution.target1);
    const target2=num(execution.target2);
    const hasExecution=!!(expression||entry||invalidation||target1!==null||target2!==null);
    counterfactual={
      applicable:true,diagnostic_only:true,issued_trade:false,
      availability:hasExecution?'AVAILABLE':rr!==null?'PARTIAL':'NOT_AVAILABLE',
      direction_candidate:forecastDirection,
      instrument_expression:expression,
      entry_logic:entry,
      invalidation,
      expected_rr:rr,
      target1,
      target2,
      rejecting_gates:rejecting,
    };
  }
  return {
    decision_version:BUILD3_DECISION_VERSION,
    engine:'EDGE_STOCKS',
    instrument:forecast.instrument,
    source_id:forecast.source_id,
    issued_at:forecast.issued_at,
    forecast_direction:forecastDirection,
    decision_state:noTrade?'NO_TRADE':'ACTIONABLE',
    recommendation,
    tradeable,
    evidence_snapshot_id:forecast.evidence_snapshot_id,
    evidence_hash:forecast.evidence_hash,
    gate_results:gates,
    rejecting_gates:rejecting,
    counterfactual,
    execution_snapshot:stockExecutionSnapshot(recommendation,execution),
  };
}

export async function persistBuild3Decision(
  databaseUrl:string|undefined,
  decision:Build3DecisionRecord,
):Promise<Build3DecisionRecord>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_DECISION_DATABASE_NOT_CONFIGURED');
  const sql=neon(databaseUrl);
  await sql`
    insert into build3_decisions(
      decision_version,engine,instrument,source_id,issued_at,forecast_direction,
      decision_state,recommendation,tradeable,evidence_snapshot_id,evidence_hash,
      gate_results,rejecting_gates,counterfactual,execution_snapshot,payload
    ) values(
      ${decision.decision_version},${decision.engine},${decision.instrument},${decision.source_id},
      ${decision.issued_at},${decision.forecast_direction},${decision.decision_state},
      ${decision.recommendation},${decision.tradeable},${decision.evidence_snapshot_id},
      ${decision.evidence_hash},${JSON.stringify(decision.gate_results)}::jsonb,
      ${JSON.stringify(decision.rejecting_gates)}::jsonb,${JSON.stringify(decision.counterfactual)}::jsonb,
      ${JSON.stringify(decision.execution_snapshot)}::jsonb,${JSON.stringify(decision)}::jsonb
    )
    on conflict (engine,source_id) do nothing
  `;
  const rows=await sql`
    select payload from build3_decisions
     where engine=${decision.engine} and source_id=${decision.source_id}
     limit 1
  `;
  if(rows.length!==1)throw new Error('BUILD3_DECISION_READBACK_MISSING');
  const restored=rows[0].payload as Build3DecisionRecord;
  if(canonicalBuild3EvidenceJson(restored)!==canonicalBuild3EvidenceJson(decision)){
    throw new Error('BUILD3_DECISION_IMMUTABLE_CONFLICT');
  }
  return restored;
}
