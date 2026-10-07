import { neon } from '@neondatabase/serverless';
import { canonicalBuild3EvidenceJson } from './build-3-evidence-snapshot';
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
