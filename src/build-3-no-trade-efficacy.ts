import { neon } from '@neondatabase/serverless';
import { canonicalBuild3EvidenceJson } from './build-3-evidence-snapshot';
import { build3MaturedThroughDate } from './build-3-outcome-evaluator';
import type { Build3DecisionRecord } from './build-3-decision';

export const BUILD3_NO_TRADE_OUTCOME_VERSION='MDOS_BUILD_3_NO_TRADE_OUTCOME_V1' as const;

export type Build3NoTradeClassification=
  |'GOOD_AVOID'
  |'MISSED_OPPORTUNITY'
  |'AMBIGUOUS'
  |'DATA_FAILURE'
  |'EVIDENCE_CONFLICT'
  |'EXECUTION_REJECTION'
  |'NOT_SCORABLE';

export type Build3NoTradeQualityHint='PROTECTED'|'MISSED'|'INCONCLUSIVE'|null;

export type Build3NoTradeTruthRow={
  horizon:'D'|'D+1'|'D+2'|'D+3'|'D+4';
  target_session:string;
  direction_result:'HIT'|'MISS'|'NOT_SCORABLE';
  scorability_state:'SCORABLE'|'NOT_SCORABLE';
  scorability_reason:string|null;
};

export type Build3NoTradeOutcomeRecord={
  decision_outcome_version:typeof BUILD3_NO_TRADE_OUTCOME_VERSION;
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  evaluated_at:string;
  scorability_state:'SCORABLE'|'NOT_SCORABLE';
  outcome_classification:Build3NoTradeClassification;
  quality_hint:Build3NoTradeQualityHint;
  counterfactual_direction:'BULL'|'RANGE'|'BEAR'|null;
  counterfactual_availability:'AVAILABLE'|'PARTIAL'|'NOT_AVAILABLE';
  direction_hits:number;
  direction_misses:number;
  horizons_evaluated:number;
  failed_gate_names:string[];
  execution_only_rejection:boolean;
  evidence_conflict:boolean;
  reason:string;
  truth:Build3NoTradeTruthRow[];
};

export type Build3NoTradeOutcomeSummary={
  total:number;
  scorable:number;
  not_scorable:number;
  good_avoid:number;
  missed_opportunity:number;
  ambiguous:number;
  data_failure:number;
  evidence_conflict:number;
  execution_rejection:number;
  protected_hint:number;
  missed_hint:number;
  inconclusive_hint:number;
};

const EXPECTED_HORIZONS=['D','D+1','D+2','D+3','D+4'] as const;
const EXECUTION_GATES=new Set(['EXECUTION_EDGE','EXPECTED_RR','EXECUTION_RR','EXECUTION_QUALITY']);

function conflictText(value:unknown):boolean{
  if(value===null||value===undefined)return false;
  if(typeof value==='string')return /CONFLICT|CONFLICTED|CONTRADICT/i.test(value);
  try{return /CONFLICT|CONFLICTED|CONTRADICT/i.test(JSON.stringify(value));}
  catch{return false;}
}

function failedGates(decision:Build3DecisionRecord):string[]{
  return [...new Set(
    decision.gate_results
      .filter(row=>row.passed===false)
      .map(row=>String(row.gate??'').trim().toUpperCase())
      .filter(Boolean)
  )];
}

function hasEvidenceConflict(decision:Build3DecisionRecord):boolean{
  return decision.gate_results.some(row=>conflictText(row.observed))
    ||decision.rejecting_gates.some(conflictText);
}

function qualityHint(
  direction:'BULL'|'RANGE'|'BEAR'|null,
  hits:number,
  misses:number,
):Build3NoTradeQualityHint{
  const supported=hits>=4;
  const rejected=misses>=4;
  if(!supported&&!rejected)return 'INCONCLUSIVE';
  if(direction==='RANGE')return supported?'PROTECTED':'INCONCLUSIVE';
  if(supported)return 'MISSED';
  if(rejected)return 'PROTECTED';
  return 'INCONCLUSIVE';
}

function record(
  decision:Build3DecisionRecord,
  truth:Build3NoTradeTruthRow[],
  classification:Build3NoTradeClassification,
  scorability:'SCORABLE'|'NOT_SCORABLE',
  reason:string,
  evaluatedAt:string,
):Build3NoTradeOutcomeRecord{
  const failed=failedGates(decision);
  const hits=truth.filter(row=>row.direction_result==='HIT').length;
  const misses=truth.filter(row=>row.direction_result==='MISS').length;
  const conflict=hasEvidenceConflict(decision);
  const executionOnly=failed.length>0&&failed.every(gate=>EXECUTION_GATES.has(gate));
  return {
    decision_outcome_version:BUILD3_NO_TRADE_OUTCOME_VERSION,
    engine:decision.engine,
    instrument:decision.instrument,
    source_id:decision.source_id,
    evaluated_at:evaluatedAt,
    scorability_state:scorability,
    outcome_classification:classification,
    quality_hint:qualityHint(decision.counterfactual.direction_candidate,hits,misses),
    counterfactual_direction:decision.counterfactual.direction_candidate,
    counterfactual_availability:decision.counterfactual.availability,
    direction_hits:hits,
    direction_misses:misses,
    horizons_evaluated:truth.length,
    failed_gate_names:failed,
    execution_only_rejection:executionOnly,
    evidence_conflict:conflict,
    reason,
    truth,
  };
}

export function scoreBuild3NoTradeOutcome(input:{
  decision:Build3DecisionRecord;
  truth:Build3NoTradeTruthRow[];
  evaluated_at?:string;
}):Build3NoTradeOutcomeRecord{
  const {decision}=input;
  const evaluatedAt=input.evaluated_at??new Date().toISOString();
  if(Number.isNaN(Date.parse(evaluatedAt)))throw new Error('BUILD3_NO_TRADE_EVALUATED_AT_INVALID');
  if(decision.decision_state!=='NO_TRADE'){
    throw new Error('BUILD3_NO_TRADE_DECISION_REQUIRED');
  }
  if(!decision.counterfactual.applicable||decision.counterfactual.issued_trade!==false){
    return record(decision,input.truth,'NOT_SCORABLE','NOT_SCORABLE','FROZEN_COUNTERFACTUAL_REQUIRED',evaluatedAt);
  }
  if(
    decision.counterfactual.availability==='NOT_AVAILABLE'
    ||decision.counterfactual.direction_candidate===null
  ){
    return record(decision,input.truth,'NOT_SCORABLE','NOT_SCORABLE','COUNTERFACTUAL_DIRECTION_NOT_FROZEN',evaluatedAt);
  }

  const byHorizon=new Map(input.truth.map(row=>[row.horizon,row]));
  if(byHorizon.size!==EXPECTED_HORIZONS.length||EXPECTED_HORIZONS.some(h=>!byHorizon.has(h))){
    return record(decision,input.truth,'DATA_FAILURE','NOT_SCORABLE','COMPLETE_D_TO_D_PLUS_4_TRUTH_REQUIRED',evaluatedAt);
  }
  const truth=EXPECTED_HORIZONS.map(h=>byHorizon.get(h) as Build3NoTradeTruthRow);
  if(truth.some(row=>row.scorability_state!=='SCORABLE'||row.direction_result==='NOT_SCORABLE')){
    return record(decision,truth,'DATA_FAILURE','NOT_SCORABLE','ONE_OR_MORE_HORIZONS_NOT_SCORABLE',evaluatedAt);
  }

  const failed=failedGates(decision);
  const conflict=hasEvidenceConflict(decision);
  const hits=truth.filter(row=>row.direction_result==='HIT').length;
  const misses=truth.filter(row=>row.direction_result==='MISS').length;
  const supported=hits>=4;
  const rejected=misses>=4;
  const executionOnly=failed.length>0&&failed.every(gate=>EXECUTION_GATES.has(gate));

  if(conflict){
    return record(
      decision,truth,'EVIDENCE_CONFLICT','SCORABLE',
      supported?'FROZEN_EVIDENCE_CONFLICT_REJECTED_A_COUNTERFACTUAL_LATER_SUPPORTED_BY_TRUTH'
        :rejected?'FROZEN_EVIDENCE_CONFLICT_COINCIDED_WITH_A_COUNTERFACTUAL_LATER_REJECTED_BY_TRUTH'
        :'FROZEN_EVIDENCE_CONFLICT_WITH_MIXED_REALIZED_TRUTH',
      evaluatedAt,
    );
  }
  if(!supported&&!rejected){
    return record(decision,truth,'AMBIGUOUS','SCORABLE','MIXED_D_TO_D_PLUS_4_COUNTERFACTUAL_DIRECTION_OUTCOMES',evaluatedAt);
  }
  if(decision.counterfactual.direction_candidate==='RANGE'){
    if(supported){
      return record(decision,truth,'GOOD_AVOID','SCORABLE','RANGE_COUNTERFACTUAL_VALIDATED_NO_DIRECTIONAL_TRADE_WAS_PREFERABLE',evaluatedAt);
    }
    return record(decision,truth,'AMBIGUOUS','SCORABLE','RANGE_COUNTERFACTUAL_FAILED_BUT_NO_DIRECTIONAL_ALTERNATIVE_WAS_FROZEN',evaluatedAt);
  }
  if(rejected){
    return record(decision,truth,'GOOD_AVOID','SCORABLE','DIRECTIONAL_COUNTERFACTUAL_REJECTED_BY_AT_LEAST_FOUR_OF_FIVE_HORIZONS',evaluatedAt);
  }
  if(executionOnly){
    return record(decision,truth,'EXECUTION_REJECTION','SCORABLE','DIRECTIONAL_COUNTERFACTUAL_SUPPORTED_BUT_REJECTED_ONLY_BY_EXECUTION_GATES',evaluatedAt);
  }
  return record(decision,truth,'MISSED_OPPORTUNITY','SCORABLE','DIRECTIONAL_COUNTERFACTUAL_SUPPORTED_BY_AT_LEAST_FOUR_OF_FIVE_HORIZONS',evaluatedAt);
}

export async function persistBuild3NoTradeOutcome(
  databaseUrl:string|undefined,
  row:Build3NoTradeOutcomeRecord,
):Promise<Build3NoTradeOutcomeRecord>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_NO_TRADE_DATABASE_NOT_CONFIGURED');
  const sql=neon(databaseUrl);
  await sql`
    insert into build3_decision_outcomes(
      decision_outcome_version,engine,instrument,source_id,evaluated_at,
      scorability_state,outcome_classification,entry_price,exit_price,stop_hit,target1_hit,target2_hit,
      mfe_pct,mae_pct,r_multiple,pnl_pct,reason,payload
    ) values(
      ${row.decision_outcome_version},${row.engine},${row.instrument},${row.source_id},${row.evaluated_at},
      ${row.scorability_state},${row.outcome_classification},
      null,null,null,null,null,null,null,null,null,${row.reason},${JSON.stringify(row)}::jsonb
    )
    on conflict (engine,source_id) do nothing
  `;
  const rows=await sql`
    select payload from build3_decision_outcomes
     where engine=${row.engine} and source_id=${row.source_id}
     limit 1
  `;
  if(rows.length!==1)throw new Error('BUILD3_NO_TRADE_READBACK_MISSING');
  const restored=rows[0].payload as Build3NoTradeOutcomeRecord;
  if(canonicalBuild3EvidenceJson(restored)!==canonicalBuild3EvidenceJson(row)){
    throw new Error('BUILD3_NO_TRADE_IMMUTABLE_CONFLICT');
  }
  return restored;
}

export type Build3NoTradeEvaluationResult={
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  status:'SCORED'|'PENDING_SOURCE'|'NOT_SCORABLE';
  classification?:Build3NoTradeClassification;
  reason:string|null;
};

export async function evaluateMaturedBuild3NoTrades(
  databaseUrl:string|undefined,
  options:{now?:Date;limit?:number}={},
):Promise<Build3NoTradeEvaluationResult[]>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_NO_TRADE_DATABASE_NOT_CONFIGURED');
  const now=options.now??new Date();
  if(Number.isNaN(now.getTime()))throw new Error('BUILD3_NO_TRADE_NOW_INVALID');
  const maturedThrough=build3MaturedThroughDate(now);
  const limit=Math.max(1,Math.min(100,Math.floor(options.limit??25)));
  const sql=neon(databaseUrl);
  const candidates=await sql`
    select d.engine,d.instrument,d.source_id,d.payload
      from build3_decisions d
      left join build3_decision_outcomes o
        on o.engine=d.engine and o.source_id=d.source_id
     where d.decision_state='NO_TRADE'
       and o.id is null
     order by d.issued_at asc,d.id asc
     limit ${limit}
  `;
  const results:Build3NoTradeEvaluationResult[]=[];
  for(const raw of candidates){
    const decision=raw.payload as Build3DecisionRecord;
    const rows=await sql`
      select f.horizon,f.horizon_index,f.target_session,
             o.direction_result,o.scorability_state,o.scorability_reason
        from build3_forecast_horizons f
        left join build3_precision_outcomes o
          on o.engine=f.engine and o.source_id=f.source_id and o.horizon=f.horizon
       where f.engine=${decision.engine}
         and f.source_id=${decision.source_id}
       order by f.horizon_index asc
    `;
    if(rows.length!==5){
      const scored=scoreBuild3NoTradeOutcome({
        decision,truth:[],evaluated_at:now.toISOString(),
      });
      const persisted=await persistBuild3NoTradeOutcome(databaseUrl,scored);
      results.push({
        engine:decision.engine,instrument:decision.instrument,source_id:decision.source_id,
        status:'NOT_SCORABLE',classification:persisted.outcome_classification,reason:persisted.reason,
      });
      continue;
    }
    const lastTarget=new Date(String(rows[rows.length-1].target_session)).toISOString().slice(0,10);
    if(lastTarget>maturedThrough)continue;
    if(rows.some(row=>row.direction_result===null||row.scorability_state===null)){
      results.push({
        engine:decision.engine,instrument:decision.instrument,source_id:decision.source_id,
        status:'PENDING_SOURCE',reason:'MATURED_HORIZON_TRUTH_NOT_YET_PERSISTED',
      });
      continue;
    }
    const truth=rows.map(row=>({
      horizon:String(row.horizon) as Build3NoTradeTruthRow['horizon'],
      target_session:new Date(String(row.target_session)).toISOString().slice(0,10),
      direction_result:String(row.direction_result) as Build3NoTradeTruthRow['direction_result'],
      scorability_state:String(row.scorability_state) as Build3NoTradeTruthRow['scorability_state'],
      scorability_reason:row.scorability_reason===null?null:String(row.scorability_reason),
    }));
    const scored=scoreBuild3NoTradeOutcome({
      decision,truth,evaluated_at:now.toISOString(),
    });
    const persisted=await persistBuild3NoTradeOutcome(databaseUrl,scored);
    results.push({
      engine:decision.engine,instrument:decision.instrument,source_id:decision.source_id,
      status:persisted.scorability_state==='SCORABLE'?'SCORED':'NOT_SCORABLE',
      classification:persisted.outcome_classification,reason:persisted.reason,
    });
  }
  return results;
}

export function summarizeBuild3NoTradeOutcomes(
  rows:Build3NoTradeOutcomeRecord[],
):Build3NoTradeOutcomeSummary{
  const count=(c:Build3NoTradeClassification)=>rows.filter(row=>row.outcome_classification===c).length;
  return {
    total:rows.length,
    scorable:rows.filter(row=>row.scorability_state==='SCORABLE').length,
    not_scorable:rows.filter(row=>row.scorability_state==='NOT_SCORABLE').length,
    good_avoid:count('GOOD_AVOID'),
    missed_opportunity:count('MISSED_OPPORTUNITY'),
    ambiguous:count('AMBIGUOUS'),
    data_failure:count('DATA_FAILURE'),
    evidence_conflict:count('EVIDENCE_CONFLICT'),
    execution_rejection:count('EXECUTION_REJECTION'),
    protected_hint:rows.filter(row=>row.quality_hint==='PROTECTED').length,
    missed_hint:rows.filter(row=>row.quality_hint==='MISSED').length,
    inconclusive_hint:rows.filter(row=>row.quality_hint==='INCONCLUSIVE').length,
  };
}

export async function readBuild3NoTradeOutcomeSummary(
  databaseUrl:string|undefined,
  engine?:'5DR'|'EDGE_STOCKS',
):Promise<Build3NoTradeOutcomeSummary>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_NO_TRADE_DATABASE_NOT_CONFIGURED');
  const sql=neon(databaseUrl);
  const rows=engine
    ?await sql`
      select payload from build3_decision_outcomes
       where engine=${engine}
         and decision_outcome_version=${BUILD3_NO_TRADE_OUTCOME_VERSION}
       order by evaluated_at,source_id
    `
    :await sql`
      select payload from build3_decision_outcomes
       where decision_outcome_version=${BUILD3_NO_TRADE_OUTCOME_VERSION}
       order by engine,evaluated_at,source_id
    `;
  return summarizeBuild3NoTradeOutcomes(rows.map(row=>row.payload as Build3NoTradeOutcomeRecord));
}
