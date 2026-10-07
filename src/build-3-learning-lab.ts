import { neon } from '@neondatabase/serverless';
import { canonicalBuild3EvidenceJson } from './build-3-evidence-snapshot';
import { buildBuild3Scorecard, type Build3Scorecard } from './build-3-scorecard';
import { summarizeBuild3Truth, type Build3TruthMetricRow } from './build-3-truth-metrics';
import { summarizeBuild3Cohorts, type Build3CohortDiagnostics, type Build3CohortTruthRow } from './build-3-cohort-diagnostics';
import { summarizeBuild3Attribution, type Build3AttributionObservation, type Build3AttributionSummary } from './build-3-attribution';
import {
  summarizeBuild3RecommendationEfficacy,
  type Build3RecommendationEfficacy,
} from './build-3-efficacy-contract';
import {
  summarizeBuild3NoTradeOutcomes,
  type Build3NoTradeOutcomeRecord,
  type Build3NoTradeOutcomeSummary,
} from './build-3-no-trade-efficacy';
import type { Build3MarketPhase } from './build-3-run-contract';
import type { Build3Direction, Build3Regime } from './build-3-forecast-contract';
import type { Build3RecommendationClassification } from './build-3-efficacy-contract';
import type { Build3NoTradeClassification } from './build-3-no-trade-efficacy';

export const BUILD3_LEARNING_LAB_VERSION='MDOS_BUILD_3_LEARNING_LAB_V1' as const;
export const BUILD3_LEARNING_SNAPSHOT_VERSION='MDOS_BUILD_3_LEARNING_SNAPSHOT_V1' as const;
export const BUILD3_CHALLENGER_VERSION='MDOS_BUILD_3_CHALLENGER_V1' as const;

export type Build3LearningScope={
  engine:'ALL'|'5DR'|'EDGE_STOCKS';
  instrument:string|null;
  from_date:string|null;
  to_date:string|null;
};

export type Build3ModelFeedbackAction='KEEP'|'INVESTIGATE'|'CHALLENGER'|'DEFER';

export type Build3ModelFeedback={
  action:Build3ModelFeedbackAction;
  topic:string;
  evidence_strength:'INSUFFICIENT'|'DEVELOPING'|'STRONG';
  sample_size:number;
  evidence:Record<string,unknown>;
  expected_benefit:string;
  risk:string;
  affected_cohort:string;
  next_observations_needed:number;
  comparison_state:'OBSERVED_BASELINE'|'SAME_POPULATION_SHADOW'|'NEEDS_FORWARD_SHADOW';
};

export type Build3DataQualitySummary={
  total_assessments:number;
  verified:number;
  partial:number;
  missing:number;
  stale:number;
  valid_for_forecast:number;
  coverage_pct:number|null;
};

export type Build3LearningLabOutput={
  version:typeof BUILD3_LEARNING_LAB_VERSION;
  generated_at:string;
  scope:Build3LearningScope;
  scorecard:Build3Scorecard;
  cohorts:Build3CohortDiagnostics;
  what_worked:Build3AttributionSummary['success_insights'];
  what_failed:Build3AttributionSummary['failure_insights'];
  unknown_direction_misses:number;
  no_trade:Build3NoTradeOutcomeSummary;
  model_feedback:Build3ModelFeedback[];
  data_quality:Build3DataQualitySummary;
  next_observations_needed:string[];
  governance:{
    diagnostic_only:true;
    production_mutation_allowed:false;
    challenger_required_for_material_change:true;
    explicit_user_approval_required_for_promotion:true;
  };
};

export type Build3LearningSnapshot={
  snapshot_id:string;
  snapshot_version:typeof BUILD3_LEARNING_SNAPSHOT_VERSION;
  generated_at:string;
  scope:Build3LearningScope;
  payload_hash:string;
  payload:Build3LearningLabOutput;
};

export type Build3ChallengerProposal={
  challenger_id:string;
  challenger_version:typeof BUILD3_CHALLENGER_VERSION;
  created_at:string;
  source_learning_snapshot_id:string;
  challenger_type:'ZONE_DEVIATION_TOLERANCE'|'ENTRY_SL_GEOMETRY'|'NO_TRADE_GATE'|'OTHER';
  target_cohort:Record<string,unknown>;
  hypothesis:Record<string,unknown>;
  expected_benefit:string;
  risks:string[];
  evidence:Record<string,unknown>;
  status:'PROPOSED';
  production_mutation_allowed:false;
};

const isoDate=(value:string|null):boolean=>value===null||/^\d{4}-\d{2}-\d{2}$/.test(value);
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

export function normalizeBuild3LearningScope(scope:Partial<Build3LearningScope>={}):Build3LearningScope{
  const engine=scope.engine??'ALL';
  if(!['ALL','5DR','EDGE_STOCKS'].includes(engine))throw new Error('BUILD3_LEARNING_SCOPE_ENGINE_INVALID');
  const instrument=scope.instrument?.trim().toUpperCase()||null;
  const from=scope.from_date??null;
  const to=scope.to_date??null;
  if(!isoDate(from)||!isoDate(to))throw new Error('BUILD3_LEARNING_SCOPE_DATE_INVALID');
  if(from&&to&&from>to)throw new Error('BUILD3_LEARNING_SCOPE_DATE_ORDER_INVALID');
  if(engine==='5DR'&&instrument&&instrument!=='NIFTY')throw new Error('BUILD3_LEARNING_SCOPE_5DR_INSTRUMENT_INVALID');
  return {engine,instrument,from_date:from,to_date:to};
}

function filterParams(scope:Build3LearningScope):[string|null,string|null,string|null,string|null]{
  return [scope.engine==='ALL'?null:scope.engine,scope.instrument,scope.from_date,scope.to_date];
}

function object(value:unknown):Record<string,unknown>|null{
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
}

function frozenComponentScores(evidence:unknown):Record<string,number>{
  const root=object(evidence);
  const packet=object(root?.engine_input);
  const rows=Array.isArray(packet?.evidence)?packet.evidence:[];
  for(const candidate of rows){
    const normalized=object(object(candidate)?.normalized);
    const raw=object(normalized?.component_scores);
    if(!raw)continue;
    const out:Record<string,number>={};
    for(const [key,value] of Object.entries(raw)){
      const n=Number(value);
      if(Number.isFinite(n))out[key.toUpperCase()]=n;
    }
    return out;
  }
  return {};
}

function normalizeTruthRow(row:any):Build3CohortTruthRow{
  const regime=String(row.regime) as Build3Regime;
  return {
    engine:String(row.engine) as Build3CohortTruthRow['engine'],
    instrument:String(row.instrument),
    source_id:String(row.source_id),
    horizon:String(row.horizon) as Build3CohortTruthRow['horizon'],
    target_session:new Date(String(row.target_session)).toISOString().slice(0,10),
    issued_at:new Date(String(row.issued_at)).toISOString(),
    run_time_bucket:String(row.run_time_bucket) as Build3MarketPhase,
    regime,
    evidence_quality:String(row.evidence_quality) as Build3CohortTruthRow['evidence_quality'],
    event_state:regime==='EVENT_SHOCK'?'EVENT_SHOCK':'NORMAL',
    direction_result:String(row.direction_result) as Build3CohortTruthRow['direction_result'],
    outer_touch:Boolean(row.outer_touch),outer_close_hit:Boolean(row.outer_close_hit),
    core_touch:Boolean(row.core_touch),core_close_hit:Boolean(row.core_close_hit),
    outer_efficacy_state:String(row.outer_efficacy_state) as Build3CohortTruthRow['outer_efficacy_state'],
    core_efficacy_state:String(row.core_efficacy_state) as Build3CohortTruthRow['core_efficacy_state'],
    outer_deviation_hit:row.outer_deviation_hit===null?null:Boolean(row.outer_deviation_hit),
    core_deviation_hit:row.core_deviation_hit===null?null:Boolean(row.core_deviation_hit),
    outer_challenger_3pct_hit:row.outer_challenger_3pct_hit===null?null:Boolean(row.outer_challenger_3pct_hit),
    core_challenger_3pct_hit:row.core_challenger_3pct_hit===null?null:Boolean(row.core_challenger_3pct_hit),
    outer_quality_status:String(row.outer_quality_status) as Build3CohortTruthRow['outer_quality_status'],
    core_quality_status:String(row.core_quality_status) as Build3CohortTruthRow['core_quality_status'],
    outer_range_deviation_pct:row.outer_range_deviation_pct===null?null:Number(row.outer_range_deviation_pct),
    core_range_deviation_pct:row.core_range_deviation_pct===null?null:Number(row.core_range_deviation_pct),
    normalized_centre_error:Number(row.normalized_centre_error),
    brier_score:row.brier_score===null?null:Number(row.brier_score),
    probability_state:String(row.probability_state) as Build3CohortTruthRow['probability_state'],
    core_width_percent:Number(row.core_width_percent),outer_width_percent:Number(row.outer_width_percent),
    scorability_state:String(row.scorability_state) as Build3CohortTruthRow['scorability_state'],
  };
}

function strength(sample:number):'INSUFFICIENT'|'DEVELOPING'|'STRONG'{
  return sample>=30?'STRONG':sample>=10?'DEVELOPING':'INSUFFICIENT';
}

export function buildBuild3ModelFeedback(input:{
  scorecard:Build3Scorecard;
  attribution:Build3AttributionSummary;
  no_trade:Build3NoTradeOutcomeSummary;
}):Build3ModelFeedback[]{
  const {scorecard,attribution,no_trade}=input;
  const feedback:Build3ModelFeedback[]=[];
  const n=attribution.sample_size;
  if(n<10){
    feedback.push({
      action:'DEFER',topic:'ATTRIBUTION_SAMPLE',
      evidence_strength:'INSUFFICIENT',sample_size:n,evidence:{sample_size:n},
      expected_benefit:'Avoid premature model changes before repeated evidence exists.',
      risk:'Acting now would overfit a small sample.',affected_cohort:'ALL',
      next_observations_needed:10-n,comparison_state:'OBSERVED_BASELINE',
    });
  }
  for(const insight of attribution.success_insights.filter(row=>row.confidence==='STRONG').slice(0,5)){
    feedback.push({
      action:'KEEP',topic:insight.signal,evidence_strength:'STRONG',
      sample_size:insight.eligible_observations,evidence:{...insight},
      expected_benefit:'Preserve a repeatedly successful frozen driver or behavior.',
      risk:'Correlation is not proof of standalone causality; retain monitoring.',
      affected_cohort:'OBSERVED_POPULATION',next_observations_needed:0,
      comparison_state:'OBSERVED_BASELINE',
    });
  }
  for(const insight of attribution.failure_insights.filter(row=>row.confidence!=='INSUFFICIENT').slice(0,8)){
    feedback.push({
      action:'INVESTIGATE',topic:insight.signal,evidence_strength:insight.confidence,
      sample_size:insight.eligible_observations,evidence:{...insight},
      expected_benefit:'Identify a repeatable failure mechanism before proposing a production change.',
      risk:'The signal may be cohort-specific or confounded by correlated evidence.',
      affected_cohort:'OBSERVED_POPULATION',
      next_observations_needed:Math.max(0,30-insight.eligible_observations),
      comparison_state:'OBSERVED_BASELINE',
    });
  }

  const core=scorecard.forecast.independent_metrics;
  if(
    core.core_zone_samples>=30&&
    core.core_deviation_hit_rate_pct!==null&&
    core.core_challenger_3pct_hit_rate_pct!==null
  ){
    const gap=core.core_deviation_hit_rate_pct-core.core_challenger_3pct_hit_rate_pct;
    if(gap<=5){
      feedback.push({
        action:'CHALLENGER',topic:'CORE_ZONE_3PCT_DEVIATION_TOLERANCE',
        evidence_strength:'STRONG',sample_size:core.core_zone_samples,
        evidence:{
          primary_5pct_hit_rate:core.core_deviation_hit_rate_pct,
          challenger_3pct_hit_rate:core.core_challenger_3pct_hit_rate_pct,
          same_population_gap_pct:Number(gap.toFixed(4)),
        },
        expected_benefit:'Test a tighter precision standard with limited observed loss of hit coverage.',
        risk:'A tighter threshold may over-penalize normal volatility in specific regimes.',
        affected_cohort:'CORE_ZONE_ALL',next_observations_needed:0,
        comparison_state:'SAME_POPULATION_SHADOW',
      });
    }
  }

  const rec=scorecard.recommendation;
  if(rec.finalized_triggered>=20&&(rec.dual_touch_pct??0)>=15){
    feedback.push({
      action:'CHALLENGER',topic:'ENTRY_SL_GEOMETRY',
      evidence_strength:strength(rec.finalized_triggered),sample_size:rec.finalized_triggered,
      evidence:{
        conservative_hit_rate_pct:rec.conservative_hit_rate_pct,
        liberal_hit_rate_pct:rec.liberal_hit_rate_pct,
        hit_rate_gap_pct:rec.hit_rate_gap_pct,
        dual_touch_pct:rec.dual_touch_pct,
      },
      expected_benefit:'Test whether entry/SL geometry can reduce dual-touch ambiguity without sacrificing target capture.',
      risk:'Changing stops or entries can worsen expectancy, drawdown or missed-entry rate.',
      affected_cohort:'FINALIZED_TRIGGERED_RECOMMENDATIONS',
      next_observations_needed:Math.max(0,30-rec.finalized_triggered),
      comparison_state:'NEEDS_FORWARD_SHADOW',
    });
  }

  if(no_trade.total>=10&&no_trade.missed_opportunity>=3){
    feedback.push({
      action:'INVESTIGATE',topic:'NO_TRADE_GATE_RESTRICTIVENESS',
      evidence_strength:strength(no_trade.total),sample_size:no_trade.total,
      evidence:{missed_opportunity:no_trade.missed_opportunity,good_avoid:no_trade.good_avoid,total:no_trade.total},
      expected_benefit:'Find gates that repeatedly reject later-supported counterfactuals.',
      risk:'Relaxing gates may increase losses and destroy capital-protection value.',
      affected_cohort:'NO_TRADE',next_observations_needed:Math.max(0,30-no_trade.total),
      comparison_state:'OBSERVED_BASELINE',
    });
  }
  return feedback;
}

export function buildBuild3LearningLabOutput(input:{
  scope:Build3LearningScope;
  scorecard:Build3Scorecard;
  cohorts:Build3CohortDiagnostics;
  attribution:Build3AttributionSummary;
  no_trade:Build3NoTradeOutcomeSummary;
  data_quality:Build3DataQualitySummary;
  generated_at?:string;
}):Build3LearningLabOutput{
  const generated=input.generated_at??new Date().toISOString();
  if(Number.isNaN(Date.parse(generated)))throw new Error('BUILD3_LEARNING_GENERATED_AT_INVALID');
  const modelFeedback=buildBuild3ModelFeedback({
    scorecard:input.scorecard,attribution:input.attribution,no_trade:input.no_trade,
  });
  const next=modelFeedback
    .filter(row=>row.next_observations_needed>0)
    .map(row=>`${row.topic}: collect ${row.next_observations_needed} additional eligible observations before stronger action.`);
  if(input.attribution.unknown_direction_misses>0){
    next.push(`UNKNOWN_DIRECTION_CAUSE: improve frozen evidence discrimination for ${input.attribution.unknown_direction_misses} unexplained direction misses.`);
  }
  return {
    version:BUILD3_LEARNING_LAB_VERSION,
    generated_at:new Date(generated).toISOString(),
    scope:input.scope,
    scorecard:input.scorecard,
    cohorts:input.cohorts,
    what_worked:input.attribution.success_insights,
    what_failed:input.attribution.failure_insights,
    unknown_direction_misses:input.attribution.unknown_direction_misses,
    no_trade:input.no_trade,
    model_feedback:modelFeedback,
    data_quality:input.data_quality,
    next_observations_needed:next,
    governance:{
      diagnostic_only:true,production_mutation_allowed:false,
      challenger_required_for_material_change:true,
      explicit_user_approval_required_for_promotion:true,
    },
  };
}

async function sha256(text:string):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function prepareBuild3LearningSnapshot(
  output:Build3LearningLabOutput,
):Promise<Build3LearningSnapshot>{
  const payloadHash=await sha256(canonicalBuild3EvidenceJson(output));
  const identity=await sha256(canonicalBuild3EvidenceJson({
    snapshot_version:BUILD3_LEARNING_SNAPSHOT_VERSION,
    generated_at:output.generated_at,scope:output.scope,payload_hash:payloadHash,
  }));
  return {
    snapshot_id:'b3ll_'+identity.slice(0,32),
    snapshot_version:BUILD3_LEARNING_SNAPSHOT_VERSION,
    generated_at:output.generated_at,scope:output.scope,payload_hash:payloadHash,payload:output,
  };
}

export async function persistBuild3LearningSnapshot(
  databaseUrl:string|undefined,
  output:Build3LearningLabOutput,
):Promise<Build3LearningSnapshot>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_LEARNING_DATABASE_NOT_CONFIGURED');
  const prepared=await prepareBuild3LearningSnapshot(output);
  const sql=neon(databaseUrl);
  await sql`
    insert into build3_learning_lab_snapshots(
      snapshot_id,snapshot_version,generated_at,scope,payload_hash,payload
    ) values(
      ${prepared.snapshot_id},${prepared.snapshot_version},${prepared.generated_at},
      ${JSON.stringify(prepared.scope)}::jsonb,${prepared.payload_hash},
      ${JSON.stringify(prepared.payload)}::jsonb
    )
    on conflict (snapshot_id) do nothing
  `;
  const rows=await sql`
    select snapshot_id,snapshot_version,generated_at,scope,payload_hash,payload
      from build3_learning_lab_snapshots where snapshot_id=${prepared.snapshot_id} limit 1
  `;
  if(rows.length!==1)throw new Error('BUILD3_LEARNING_SNAPSHOT_READBACK_MISSING');
  const restored:Build3LearningSnapshot={
    snapshot_id:String(rows[0].snapshot_id),
    snapshot_version:String(rows[0].snapshot_version) as typeof BUILD3_LEARNING_SNAPSHOT_VERSION,
    generated_at:new Date(String(rows[0].generated_at)).toISOString(),
    scope:rows[0].scope as Build3LearningScope,
    payload_hash:String(rows[0].payload_hash),
    payload:rows[0].payload as Build3LearningLabOutput,
  };
  if(canonicalBuild3EvidenceJson(restored)!==canonicalBuild3EvidenceJson(prepared)){
    throw new Error('BUILD3_LEARNING_SNAPSHOT_IMMUTABLE_CONFLICT');
  }
  return restored;
}

export async function prepareBuild3Challenger(
  snapshot:Build3LearningSnapshot,
  feedback:Build3ModelFeedback,
):Promise<Build3ChallengerProposal>{
  if(feedback.action!=='CHALLENGER')throw new Error('BUILD3_CHALLENGER_FEEDBACK_REQUIRED');
  const type:Build3ChallengerProposal['challenger_type']=
    feedback.topic.includes('ZONE')?'ZONE_DEVIATION_TOLERANCE':
    feedback.topic.includes('ENTRY_SL')?'ENTRY_SL_GEOMETRY':
    feedback.topic.includes('NO_TRADE')?'NO_TRADE_GATE':'OTHER';
  const created=snapshot.generated_at;
  const hypothesis={
    topic:feedback.topic,comparison_state:feedback.comparison_state,
    proposed_change:feedback.topic==='CORE_ZONE_3PCT_DEVIATION_TOLERANCE'
      ?{primary_deviation_tolerance_pct:3}
      :{requires_forward_shadow:true},
  };
  const identity=await sha256(canonicalBuild3EvidenceJson({
    source_learning_snapshot_id:snapshot.snapshot_id,type,hypothesis,target:feedback.affected_cohort,
  }));
  return {
    challenger_id:'b3ch_'+identity.slice(0,32),
    challenger_version:BUILD3_CHALLENGER_VERSION,
    created_at:created,source_learning_snapshot_id:snapshot.snapshot_id,
    challenger_type:type,target_cohort:{scope:feedback.affected_cohort},
    hypothesis,expected_benefit:feedback.expected_benefit,risks:[feedback.risk],
    evidence:feedback.evidence,status:'PROPOSED',production_mutation_allowed:false,
  };
}

export async function persistBuild3Challenger(
  databaseUrl:string|undefined,
  proposal:Build3ChallengerProposal,
):Promise<Build3ChallengerProposal>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_CHALLENGER_DATABASE_NOT_CONFIGURED');
  const sql=neon(databaseUrl);
  await sql`
    insert into build3_challengers(
      challenger_id,challenger_version,created_at,source_learning_snapshot_id,challenger_type,
      target_cohort,hypothesis,expected_benefit,risks,evidence,status,production_mutation_allowed,payload
    ) values(
      ${proposal.challenger_id},${proposal.challenger_version},${proposal.created_at},
      ${proposal.source_learning_snapshot_id},${proposal.challenger_type},
      ${JSON.stringify(proposal.target_cohort)}::jsonb,${JSON.stringify(proposal.hypothesis)}::jsonb,
      ${proposal.expected_benefit},${JSON.stringify(proposal.risks)}::jsonb,${JSON.stringify(proposal.evidence)}::jsonb,
      'PROPOSED',false,${JSON.stringify(proposal)}::jsonb
    )
    on conflict (challenger_id) do nothing
  `;
  const rows=await sql`select payload from build3_challengers where challenger_id=${proposal.challenger_id} limit 1`;
  if(rows.length!==1)throw new Error('BUILD3_CHALLENGER_READBACK_MISSING');
  const restored=rows[0].payload as Build3ChallengerProposal;
  if(canonicalBuild3EvidenceJson(restored)!==canonicalBuild3EvidenceJson(proposal)){
    throw new Error('BUILD3_CHALLENGER_IMMUTABLE_CONFLICT');
  }
  return restored;
}

export async function readBuild3LearningLab(
  databaseUrl:string|undefined,
  requestedScope:Partial<Build3LearningScope>={},
  persist=true,
):Promise<{output:Build3LearningLabOutput;snapshot:Build3LearningSnapshot|null;challengers:Build3ChallengerProposal[]}>{
  if(!databaseUrl?.trim())throw new Error('BUILD3_LEARNING_DATABASE_NOT_CONFIGURED');
  const scope=normalizeBuild3LearningScope(requestedScope);
  const [engine,instrument,fromDate,toDate]=filterParams(scope);
  const sql=neon(databaseUrl);

  const truthRows=await sql.query(`
    select o.engine,o.instrument,o.source_id,o.horizon,o.target_session,
           f.issued_at,f.regime,f.data_quality_state as evidence_quality,r.market_phase as run_time_bucket,
           o.direction_result,o.outer_touch,o.outer_close_hit,o.core_touch,o.core_close_hit,
           o.outer_efficacy_state,o.core_efficacy_state,o.outer_deviation_hit,o.core_deviation_hit,
           o.outer_challenger_3pct_hit,o.core_challenger_3pct_hit,
           o.outer_quality_status,o.core_quality_status,o.outer_range_deviation_pct,o.core_range_deviation_pct,
           o.normalized_centre_error,o.brier_score,o.probability_state,o.core_width_percent,o.outer_width_percent,
           o.scorability_state,o.outer_high_breach_points,o.outer_low_breach_points,
           o.core_high_breach_points,o.core_low_breach_points,
           f.direction as forecast_direction,es.payload as evidence_payload,d.gate_results,
           q.payload as quality_payload,re.classification as recommendation_classification,
           dox.outcome_classification as no_trade_classification
      from build3_precision_outcomes o
      join build3_forecast_horizons f
        on f.engine=o.engine and f.source_id=o.source_id and f.horizon=o.horizon
      join build3_run_registry r on r.engine=o.engine and r.source_id=o.source_id
      join build3_evidence_snapshots es on es.engine=o.engine and es.source_id=o.source_id
      join build3_decisions d on d.engine=o.engine and d.source_id=o.source_id
      left join build3_data_quality_assessments q on q.engine=o.engine and q.source_id=o.source_id
      left join build3_recommendation_efficacy re on re.engine=o.engine and re.source_id=o.source_id
      left join build3_decision_outcomes dox on dox.engine=o.engine and dox.source_id=o.source_id
     where ($1::text is null or o.engine=$1)
       and ($2::text is null or upper(o.instrument)=upper($2))
       and ($3::date is null or (f.issued_at at time zone 'Asia/Kolkata')::date >= $3::date)
       and ($4::date is null or (f.issued_at at time zone 'Asia/Kolkata')::date <= $4::date)
     order by o.engine,o.instrument,o.target_session,f.issued_at,o.source_id,o.horizon
  `,[engine,instrument,fromDate,toDate]);

  const cohortRows=truthRows.map(normalizeTruthRow);
  const truth=cohortRows.map(({regime:_r,evidence_quality:_e,event_state:_s,...row})=>row as Build3TruthMetricRow);
  const attributionRows:Build3AttributionObservation[]=truthRows.map((row:any)=>{
    const quality=object(row.quality_payload);
    const required=Array.isArray(quality?.required_inputs)?quality.required_inputs:[];
    const verifiedInputs=required.filter(item=>object(item)?.state==='VERIFIED')
      .map(item=>String(object(item)?.input??'')).filter(Boolean);
    return {
      engine:String(row.engine) as Build3AttributionObservation['engine'],
      instrument:String(row.instrument),source_id:String(row.source_id),
      horizon:String(row.horizon) as Build3AttributionObservation['horizon'],
      forecast_direction:String(row.forecast_direction) as Build3Direction,
      regime:String(row.regime) as Build3Regime,
      direction_result:String(row.direction_result) as Build3AttributionObservation['direction_result'],
      outer_close_hit:Boolean(row.outer_close_hit),core_close_hit:Boolean(row.core_close_hit),
      outer_quality_status:String(row.outer_quality_status) as Build3AttributionObservation['outer_quality_status'],
      core_quality_status:String(row.core_quality_status) as Build3AttributionObservation['core_quality_status'],
      outer_high_breach_points:row.outer_high_breach_points===null?null:Number(row.outer_high_breach_points),
      outer_low_breach_points:row.outer_low_breach_points===null?null:Number(row.outer_low_breach_points),
      core_high_breach_points:row.core_high_breach_points===null?null:Number(row.core_high_breach_points),
      core_low_breach_points:row.core_low_breach_points===null?null:Number(row.core_low_breach_points),
      component_scores:frozenComponentScores(row.evidence_payload),
      gate_results:Array.isArray(row.gate_results)?row.gate_results:[],
      verified_inputs:verifiedInputs,
      recommendation_classification:row.recommendation_classification===null?null:String(row.recommendation_classification) as Build3RecommendationClassification,
      no_trade_classification:row.no_trade_classification===null?null:String(row.no_trade_classification) as Build3NoTradeClassification,
    };
  });

  const recommendationRows=await sql.query(`
    select e.payload
      from build3_recommendation_efficacy e
      join build3_decisions d on d.engine=e.engine and d.source_id=e.source_id
     where ($1::text is null or e.engine=$1)
       and ($2::text is null or upper(e.instrument)=upper($2))
       and ($3::date is null or (d.issued_at at time zone 'Asia/Kolkata')::date >= $3::date)
       and ($4::date is null or (d.issued_at at time zone 'Asia/Kolkata')::date <= $4::date)
     order by e.evaluated_at,e.source_id
  `,[engine,instrument,fromDate,toDate]);
  const recommendation=summarizeBuild3RecommendationEfficacy(
    recommendationRows.map((row:any)=>row.payload as Build3RecommendationEfficacy)
  );

  const noTradeRows=await sql.query(`
    select o.payload
      from build3_decision_outcomes o
      join build3_decisions d on d.engine=o.engine and d.source_id=o.source_id
     where o.decision_outcome_version='MDOS_BUILD_3_NO_TRADE_OUTCOME_V1'
       and ($1::text is null or o.engine=$1)
       and ($2::text is null or upper(o.instrument)=upper($2))
       and ($3::date is null or (d.issued_at at time zone 'Asia/Kolkata')::date >= $3::date)
       and ($4::date is null or (d.issued_at at time zone 'Asia/Kolkata')::date <= $4::date)
     order by o.evaluated_at,o.source_id
  `,[engine,instrument,fromDate,toDate]);
  const noTrade=summarizeBuild3NoTradeOutcomes(
    noTradeRows.map((row:any)=>row.payload as Build3NoTradeOutcomeRecord)
  );

  const qualityRows=await sql.query(`
    select q.overall_state,q.valid_for_forecast
      from build3_data_quality_assessments q
      join build3_run_registry r on r.engine=q.engine and r.source_id=q.source_id
     where ($1::text is null or q.engine=$1)
       and ($2::text is null or upper(q.instrument)=upper($2))
       and ($3::date is null or (r.run_timestamp at time zone 'Asia/Kolkata')::date >= $3::date)
       and ($4::date is null or (r.run_timestamp at time zone 'Asia/Kolkata')::date <= $4::date)
  `,[engine,instrument,fromDate,toDate]);
  const qCount=(state:string)=>qualityRows.filter((row:any)=>String(row.overall_state)===state).length;
  const valid=qualityRows.filter((row:any)=>Boolean(row.valid_for_forecast)).length;
  const dataQuality:Build3DataQualitySummary={
    total_assessments:qualityRows.length,verified:qCount('VERIFIED'),partial:qCount('PARTIAL'),
    missing:qCount('MISSING'),stale:qCount('STALE'),valid_for_forecast:valid,
    coverage_pct:qualityRows.length?Number((valid/qualityRows.length*100).toFixed(4)):null,
  };

  const generated=new Date().toISOString();
  const truthSummary=summarizeBuild3Truth(truth,generated);
  const cohorts=summarizeBuild3Cohorts(cohortRows,generated);
  const attribution=summarizeBuild3Attribution(attributionRows,generated);
  const scorecard=buildBuild3Scorecard({
    truth:truthSummary,recommendation,no_trade:noTrade,cohorts,
    scope:scope.engine,
    generated_at:generated,
  });
  const output=buildBuild3LearningLabOutput({
    scope,scorecard,cohorts,attribution,no_trade:noTrade,data_quality:dataQuality,generated_at:generated,
  });
  if(!persist)return {output,snapshot:null,challengers:[]};
  const snapshot=await persistBuild3LearningSnapshot(databaseUrl,output);
  const challengers:Build3ChallengerProposal[]=[];
  for(const feedback of output.model_feedback.filter(row=>row.action==='CHALLENGER')){
    const proposal=await prepareBuild3Challenger(snapshot,feedback);
    challengers.push(await persistBuild3Challenger(databaseUrl,proposal));
  }
  return {output,snapshot,challengers};
}
