import { neon } from '@neondatabase/serverless';
import { canonicalBuild3EvidenceJson } from './build-3-evidence-snapshot';
import type { Build3DecisionRecord } from './build-3-decision';
import type { Build3SessionOhlcSource } from './build-3-outcome-types';
import { observeBuild3RecommendationFromDailySessions } from './build-3-recommendation-observation';
import {
  BUILD3_EFFICACY_SCORING_VERSION,
  scoreBuild3RecommendationEfficacy,
  summarizeBuild3RecommendationEfficacy,
  type Build3RecommendationEfficacy,
  type Build3RecommendationEfficacySummary,
} from './build-3-efficacy-contract';

export type Build3RecommendationEfficacyRecord=Build3RecommendationEfficacy&{
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  evaluated_at:string;
  primary_target_label:'T1';
  evidence:Record<string,unknown>;
};

export function buildBuild3RecommendationEfficacyRecord(input:{
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  evaluated_at?:string;
  entry_triggered:boolean;
  target_hit:boolean;
  sl_hit:boolean;
  lifecycle_complete:boolean;
  primary_target_label?:'T1';
  evidence?:Record<string,unknown>;
}):Build3RecommendationEfficacyRecord{
  if(!input.instrument.trim()||!input.source_id.trim())throw new Error('BUILD3_RECOMMENDATION_EFFICACY_IDENTITY_REQUIRED');
  const evaluatedAt=input.evaluated_at??new Date().toISOString();
  if(Number.isNaN(Date.parse(evaluatedAt)))throw new Error('BUILD3_RECOMMENDATION_EFFICACY_TIMESTAMP_INVALID');
  return {
    ...scoreBuild3RecommendationEfficacy(input),
    engine:input.engine,
    instrument:input.instrument.trim().toUpperCase(),
    source_id:input.source_id.trim(),
    evaluated_at:new Date(evaluatedAt).toISOString(),
    primary_target_label:input.primary_target_label??'T1',
    evidence:input.evidence??{},
  };
}

export async function persistBuild3RecommendationEfficacy(
  databaseUrl:string|undefined,
  row:Build3RecommendationEfficacyRecord,
):Promise<Build3RecommendationEfficacyRecord>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_RECOMMENDATION_EFFICACY_DATABASE_NOT_CONFIGURED');
  if(!row.lifecycle_complete)throw new Error('BUILD3_RECOMMENDATION_EFFICACY_FINAL_LIFECYCLE_REQUIRED');
  const sql=neon(databaseUrl);
  await sql`
    insert into build3_recommendation_efficacy(
      efficacy_version,engine,instrument,source_id,evaluated_at,
      entry_triggered,lifecycle_complete,primary_target_label,primary_target_hit,sl_hit,
      classification,conservative_result,liberal_result,finalized_triggered,evidence,payload
    ) values(
      ${BUILD3_EFFICACY_SCORING_VERSION},${row.engine},${row.instrument},${row.source_id},${row.evaluated_at},
      ${row.entry_triggered},${row.lifecycle_complete},${row.primary_target_label},${row.target_hit},${row.sl_hit},
      ${row.classification},${row.conservative_result},${row.liberal_result},${row.finalized_triggered},
      ${JSON.stringify(row.evidence)}::jsonb,${JSON.stringify(row)}::jsonb
    )
    on conflict (engine,source_id) do nothing
  `;
  const rows=await sql`
    select payload from build3_recommendation_efficacy
     where engine=${row.engine} and source_id=${row.source_id}
     limit 1
  `;
  if(rows.length!==1)throw new Error('BUILD3_RECOMMENDATION_EFFICACY_READBACK_MISSING');
  const restored=rows[0].payload as Build3RecommendationEfficacyRecord;
  if(canonicalBuild3EvidenceJson(restored)!==canonicalBuild3EvidenceJson(row)){
    throw new Error('BUILD3_RECOMMENDATION_EFFICACY_IMMUTABLE_CONFLICT');
  }
  return restored;
}

export async function readBuild3RecommendationEfficacySummary(
  databaseUrl:string|undefined,
  engine?:'5DR'|'EDGE_STOCKS',
):Promise<Build3RecommendationEfficacySummary>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_RECOMMENDATION_EFFICACY_DATABASE_NOT_CONFIGURED');
  const sql=neon(databaseUrl);
  const rows=engine
    ?await sql`select payload from build3_recommendation_efficacy where engine=${engine} order by evaluated_at,source_id`
    :await sql`select payload from build3_recommendation_efficacy order by engine,evaluated_at,source_id`;
  return summarizeBuild3RecommendationEfficacy(rows.map(row=>row.payload as Build3RecommendationEfficacy));
}


export const BUILD3_RECOMMENDATION_OBSERVATION_ATTEMPT_VERSION='MDOS_BUILD_3_RECOMMENDATION_OBSERVATION_ATTEMPT_V1' as const;

export type Build3RecommendationEvaluationResult={
  engine:'5DR'|'EDGE_STOCKS';
  instrument:string;
  source_id:string;
  status:'SCORED'|'PENDING_SOURCE'|'NOT_SCORABLE';
  reason:string|null;
  classification?:Build3RecommendationEfficacy['classification'];
};

async function recordBuild3RecommendationObservationAttempt(
  databaseUrl:string,
  row:Build3RecommendationEvaluationResult,
  evidence:Record<string,unknown>,
):Promise<void>{
  const sql=neon(databaseUrl);
  const attemptedAt=new Date().toISOString();
  const payload={
    attempt_version:BUILD3_RECOMMENDATION_OBSERVATION_ATTEMPT_VERSION,
    ...row,attempted_at:attemptedAt,evidence,
  };
  await sql`
    insert into build3_recommendation_observation_attempts(
      attempt_version,engine,instrument,source_id,attempted_at,attempt_state,reason,evidence,payload
    ) values(
      ${BUILD3_RECOMMENDATION_OBSERVATION_ATTEMPT_VERSION},${row.engine},${row.instrument},
      ${row.source_id},${attemptedAt},${row.status},${row.reason},
      ${JSON.stringify(evidence)}::jsonb,${JSON.stringify(payload)}::jsonb
    )
  `;
}

function restoredSessionSource(row:any,engine:'5DR'|'EDGE_STOCKS',instrument:string):Build3SessionOhlcSource|null{
  if(!row.outcome_source||!row.source_captured_at||!row.provider_hash||!row.corporate_action_state||!row.adjustment_basis)return null;
  const values=[row.actual_open,row.actual_high,row.actual_low,row.actual_close].map(Number);
  if(values.some(value=>!Number.isFinite(value)||value<=0))return null;
  return {
    source_version:'BUILD3_SESSION_OHLC_FROM_PERSISTED_OUTCOME_V1',
    engine,instrument,session_date:new Date(String(row.target_session)).toISOString().slice(0,10),
    captured_at:new Date(String(row.source_captured_at)).toISOString(),
    source_ref:String(row.outcome_source),provider_hash:String(row.provider_hash),
    actual_open:values[0],actual_high:values[1],actual_low:values[2],actual_close:values[3],
    corporate_action_state:String(row.corporate_action_state) as Build3SessionOhlcSource['corporate_action_state'],
    adjustment_basis:String(row.adjustment_basis),
  };
}

export async function evaluateMaturedBuild3Recommendations(
  databaseUrl:string|undefined,
  options:{now?:Date;limit?:number}={},
):Promise<Build3RecommendationEvaluationResult[]>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_RECOMMENDATION_EFFICACY_DATABASE_NOT_CONFIGURED');
  const now=options.now??new Date();
  if(Number.isNaN(now.getTime()))throw new Error('BUILD3_RECOMMENDATION_EFFICACY_NOW_INVALID');
  const sql=neon(databaseUrl);
  const limit=Math.max(1,Math.min(100,Math.floor(options.limit??25)));
  const candidates=await sql`
    select d.engine,d.instrument,d.source_id,d.payload
      from build3_decisions d
      left join build3_recommendation_efficacy e
        on e.engine=d.engine and e.source_id=d.source_id
     where d.decision_state='ACTIONABLE'
       and e.id is null
     order by d.issued_at asc,d.id asc
     limit ${limit}
  `;
  const results:Build3RecommendationEvaluationResult[]=[];
  for(const raw of candidates){
    const decision=raw.payload as Build3DecisionRecord;
    const lifecycleAt=Date.parse(String(decision.execution_snapshot?.lifecycle_end_at??''));
    if(Number.isNaN(lifecycleAt)||now.getTime()<lifecycleAt)continue;

    const truth=await sql`
      select f.horizon_index,f.target_session,
             o.outcome_source,o.source_captured_at,o.provider_hash,o.corporate_action_state,o.adjustment_basis,
             o.actual_open,o.actual_high,o.actual_low,o.actual_close
        from build3_forecast_horizons f
        left join build3_precision_outcomes o
          on o.engine=f.engine and o.source_id=f.source_id and o.horizon=f.horizon
       where f.engine=${decision.engine}
         and f.source_id=${decision.source_id}
       order by f.horizon_index asc
    `;
    const expectedSessions=truth.map(row=>new Date(String(row.target_session)).toISOString().slice(0,10));
    const sessions=truth
      .map(row=>restoredSessionSource(row,decision.engine,decision.instrument))
      .filter((row):row is Build3SessionOhlcSource=>!!row);
    const observation=observeBuild3RecommendationFromDailySessions({
      decision,expected_sessions:expectedSessions,sessions,now,
    });

    if(observation.state!=='SCORABLE'){
      const result:Build3RecommendationEvaluationResult={
        engine:decision.engine,instrument:decision.instrument,source_id:decision.source_id,
        status:observation.state==='PENDING'?'PENDING_SOURCE':'NOT_SCORABLE',
        reason:observation.reason,
      };
      await recordBuild3RecommendationObservationAttempt(databaseUrl,result,{observation});
      results.push(result);
      continue;
    }
    if(observation.target_hit===null||observation.sl_hit===null){
      throw new Error('BUILD3_RECOMMENDATION_SCORABLE_PRIMITIVES_MISSING');
    }
    const efficacy=buildBuild3RecommendationEfficacyRecord({
      engine:decision.engine,instrument:decision.instrument,source_id:decision.source_id,
      evaluated_at:observation.evaluated_at,
      entry_triggered:observation.entry_triggered,target_hit:observation.target_hit,
      sl_hit:observation.sl_hit,lifecycle_complete:observation.lifecycle_complete,
      primary_target_label:'T1',evidence:{observation},
    });
    const persisted=await persistBuild3RecommendationEfficacy(databaseUrl,efficacy);
    const result:Build3RecommendationEvaluationResult={
      engine:decision.engine,instrument:decision.instrument,source_id:decision.source_id,
      status:'SCORED',reason:null,classification:persisted.classification,
    };
    await recordBuild3RecommendationObservationAttempt(databaseUrl,result,{observation,efficacy:persisted});
    results.push(result);
  }
  return results;
}
