import { neon } from '@neondatabase/serverless';
import { canonicalBuild3EvidenceJson } from './build-3-evidence-snapshot';
import type { Build3HorizonOutcome } from './build-3-outcome-types';

export async function persistBuild3HorizonOutcome(
  databaseUrl:string|undefined,
  outcome:Build3HorizonOutcome,
):Promise<Build3HorizonOutcome>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_OUTCOME_DATABASE_NOT_CONFIGURED');
  const sql=neon(databaseUrl);
  await sql`
    insert into build3_precision_outcomes(
      precision_outcome_version,outcome_version,engine,instrument,source_id,horizon,target_session,
      outcome_source,source_captured_at,provider_hash,corporate_action_state,adjustment_basis,evaluated_at,
      actual_open,actual_high,actual_low,actual_close,
      direction_result,direction_margin_points,outer_touch,outer_close_hit,core_touch,core_close_hit,
      core_hit,outer_hit,core_width_points,core_width_percent,outer_width_points,outer_width_percent,
      centre_error,normalized_centre_error,miss_distance,edge_proximity,
      zone_efficacy_version,
      outer_efficacy_state,outer_high_breach_points,outer_low_breach_points,
      outer_high_deviation_pct,outer_low_deviation_pct,outer_range_deviation_pct,
      outer_deviation_hit,outer_challenger_3pct_hit,outer_quality_status,
      core_efficacy_state,core_high_breach_points,core_low_breach_points,
      core_high_deviation_pct,core_low_deviation_pct,core_range_deviation_pct,
      core_deviation_hit,core_challenger_3pct_hit,core_quality_status,
      probability_state,realized_probability_class,brier_score,brier_components,
      scorability_state,scorability_reason,payload
    ) values(
      ${outcome.precision_outcome_version},${outcome.outcome_version},${outcome.engine},${outcome.instrument},
      ${outcome.source_id},${outcome.horizon},${outcome.target_session},${outcome.outcome_source},
      ${outcome.source_captured_at},${outcome.provider_hash},${outcome.corporate_action_state},
      ${outcome.adjustment_basis},${outcome.evaluated_at},
      ${outcome.actual_open},${outcome.actual_high},${outcome.actual_low},${outcome.actual_close},
      ${outcome.direction_result},${outcome.direction_margin_points},
      ${outcome.outer_touch},${outcome.outer_close_hit},${outcome.core_touch},${outcome.core_close_hit},
      ${outcome.core_close_hit},${outcome.outer_close_hit},
      ${outcome.core_width_points},${outcome.core_width_percent},
      ${outcome.outer_width_points},${outcome.outer_width_percent},
      ${outcome.centre_error},${outcome.normalized_centre_error},${outcome.miss_distance},${outcome.edge_proximity},
      ${outcome.zone_efficacy_version},
      ${outcome.outer_efficacy.scorability_state},${outcome.outer_efficacy.high_breach_points},${outcome.outer_efficacy.low_breach_points},
      ${outcome.outer_efficacy.high_deviation_pct},${outcome.outer_efficacy.low_deviation_pct},${outcome.outer_efficacy.range_deviation_pct},
      ${outcome.outer_efficacy.deviation_hit},${outcome.outer_efficacy.challenger_deviation_hit},${outcome.outer_efficacy.quality_status},
      ${outcome.core_efficacy.scorability_state},${outcome.core_efficacy.high_breach_points},${outcome.core_efficacy.low_breach_points},
      ${outcome.core_efficacy.high_deviation_pct},${outcome.core_efficacy.low_deviation_pct},${outcome.core_efficacy.range_deviation_pct},
      ${outcome.core_efficacy.deviation_hit},${outcome.core_efficacy.challenger_deviation_hit},${outcome.core_efficacy.quality_status},
      ${outcome.probability_state},${outcome.realized_probability_class},${outcome.brier_score},
      ${JSON.stringify(outcome.brier_components)}::jsonb,${outcome.scorability_state},${outcome.scorability_reason},
      ${JSON.stringify(outcome)}::jsonb
    )
    on conflict (engine,source_id,horizon) do nothing
  `;
  const rows=await sql`
    select payload from build3_precision_outcomes
     where engine=${outcome.engine} and source_id=${outcome.source_id} and horizon=${outcome.horizon}
     limit 1
  `;
  if(rows.length!==1)throw new Error('BUILD3_OUTCOME_READBACK_MISSING');
  const restored=rows[0].payload as Build3HorizonOutcome;
  if(canonicalBuild3EvidenceJson(restored)!==canonicalBuild3EvidenceJson(outcome)){
    throw new Error('BUILD3_OUTCOME_IMMUTABLE_CONFLICT');
  }
  return restored;
}
