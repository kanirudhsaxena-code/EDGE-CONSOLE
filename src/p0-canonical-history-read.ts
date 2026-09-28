import { neon } from '@neondatabase/serverless';
import { isAccessIdentityEnforced, resolveAccessActor, type AccessIdentityEnv } from './access-identity';

type Env = AccessIdentityEnv & {
  EDGE_DATABASE_URL?: string;
};

type JsonRecord = Record<string, unknown>;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'private, no-store',
  },
});

async function ownerOnly(request: Request, env: Env): Promise<Response | null> {
  if (!isAccessIdentityEnforced(env)) return null;
  const actor = await resolveAccessActor(request, env);
  if (!actor.authenticated) return json({ error: 'Authenticated Console identity is required' }, 401);
  if (actor.role !== 'OWNER') return json({ error: 'Canonical history is owner-only; tester runs are sandbox-scoped' }, 403);
  return null;
}

function validTicker(value: string | null): value is string {
  return !!value && /^[A-Z0-9._&-]{1,20}$/.test(value);
}

function validIsoDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function retrieval(extra: JsonRecord = {}): JsonRecord {
  return {
    contract: 'CANONICAL_READ_V1',
    reconstructed_from_latest_run: false,
    inferred_from_workflow_name: false,
    efficacy_population_changed: false,
    fail_closed: true,
    ...extra,
  };
}

/** P0-12 exact historical reader for EDGE Stocks. */
export async function handleP0CanonicalHistoryRead(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.pathname !== '/api/canonical-history') return null;

  const engine = (url.searchParams.get('engine') || '').trim().toUpperCase();
  if (engine !== 'EDGE_STOCKS' && engine !== 'STOCKS' && engine !== 'EDGE') {
    return json({
      error: 'Unsupported engine',
      supported_engines: ['5DR', 'EDGE_STOCKS', 'IPO_EDGE'],
      retrieval: retrieval(),
    }, 422);
  }

  const denied = await ownerOnly(request, env);
  if (denied) return denied;

  if (!env.EDGE_DATABASE_URL) {
    return json({ error: 'EDGE database is not configured', engine: 'EDGE_STOCKS', retrieval: retrieval() }, 503);
  }

  const ticker = (url.searchParams.get('ticker') || '').trim().toUpperCase();
  const tradingDate = url.searchParams.get('date');
  const recommendationId = (url.searchParams.get('recommendation_id') || '').trim() || null;
  const forecastHorizon = (url.searchParams.get('forecast_horizon') || '').trim() || null;

  if (!recommendationId && (!validTicker(ticker) || !validIsoDate(tradingDate))) {
    return json({
      error: 'EDGE_STOCKS requires recommendation_id or ticker + date (YYYY-MM-DD)',
      engine: 'EDGE_STOCKS',
      retrieval: retrieval({ exact_persisted_selection: false }),
    }, 422);
  }
  if (ticker && !validTicker(ticker)) return json({ error: 'Invalid ticker', engine: 'EDGE_STOCKS', retrieval: retrieval() }, 422);
  if (tradingDate && !validIsoDate(tradingDate)) return json({ error: 'Invalid date; expected YYYY-MM-DD', engine: 'EDGE_STOCKS', retrieval: retrieval() }, 422);

  const sql = neon(env.EDGE_DATABASE_URL);
  const selections = recommendationId
    ? await sql`
        select canonical_key,ticker,target_trading_date,forecast_horizon,selection_status,
               canonical_type,selected_recommendation_id,selected_at,selection_reason
          from edge_canonical_selections
         where selected_recommendation_id=${recommendationId}
         order by selected_at desc
      `
    : forecastHorizon
      ? await sql`
          select canonical_key,ticker,target_trading_date,forecast_horizon,selection_status,
                 canonical_type,selected_recommendation_id,selected_at,selection_reason
            from edge_canonical_selections
           where ticker=${ticker}
             and target_trading_date=${tradingDate}
             and forecast_horizon=${forecastHorizon}
           order by selected_at desc
        `
      : await sql`
          select canonical_key,ticker,target_trading_date,forecast_horizon,selection_status,
                 canonical_type,selected_recommendation_id,selected_at,selection_reason
            from edge_canonical_selections
           where ticker=${ticker}
             and target_trading_date=${tradingDate}
           order by selected_at desc
        `;

  if (!selections.length) {
    return json({
      engine: 'EDGE_STOCKS',
      canonical: null,
      error: 'No governed canonical selection matches the requested identity',
      retrieval: retrieval({ exact_persisted_selection: false }),
    }, 404);
  }

  if (selections.length > 1) {
    return json({
      engine: 'EDGE_STOCKS',
      error: 'Ambiguous canonical identity; specify forecast_horizon or recommendation_id',
      candidates: selections.map((row: JsonRecord) => ({
        canonical_key: row.canonical_key,
        forecast_horizon: row.forecast_horizon,
        selection_status: row.selection_status,
        canonical_type: row.canonical_type,
        selected_recommendation_id: row.selected_recommendation_id,
      })),
      retrieval: retrieval({ exact_persisted_selection: false }),
    }, 409);
  }

  const canonical = selections[0] as JsonRecord;
  if (canonical.selection_status !== 'SELECTED' || !canonical.selected_recommendation_id) {
    return json({
      engine: 'EDGE_STOCKS',
      canonical,
      analytical_record: null,
      research_bundle: null,
      evidence: [],
      component_scores: [],
      execution_plan: null,
      outcome_checkpoints: [],
      core_shadow: { status: 'NOT_APPLICABLE_NO_SELECTED_CANONICAL', record: null },
      presentation: { status: 'NOT_AVAILABLE_UNTIL_P0_11', snapshot: null },
      retrieval: retrieval({
        exact_persisted_selection: true,
        selected_for_headline_efficacy: false,
        note: 'CANONICAL_MISSED is preserved as a governed historical state and is never backfilled.',
      }),
    });
  }

  const selectedId = String(canonical.selected_recommendation_id);
  const recommendationRows = await sql`
    select r.*,er.command_type,er.status as run_status,er.parent_run_id,er.notes as run_notes,
           g.candidate_type,g.requested_at,g.completed_at,g.ordinary_cutoff_at,g.hard_boundary_at,
           g.research_fresh_at as governance_research_fresh_at,g.fallback_reason,
           l.tracking_policy,l.include_in_master_metrics,l.horizon_days,l.expiry_trading_date,
           l.status as lifecycle_status,l.closure_reason,l.closed_at,
           p.reference_price,p.current_price,p.current_return_pct,p.mfe_pct,p.mae_pct,
           p.potential_gain_pct,p.potential_loss_pct,p.model_return_pct,p.model_pnl_units,
           p.direction_hit,p.target_hit,p.stop_hit,p.zone_result as performance_zone_result,
           p.outcome_verdict,p.last_assessed_at,p.notes as performance_notes,
           mt.evidence_quality_score,mt.freshness_score,mt.completeness_score,
           mt.directional_agreement_score,mt.market_confirmation_score,
           bs.forecast_edge,bs.market_trust as bot_market_trust,
           bs.structure_pattern_quality,bs.pv_pvpo_confirmation,bs.catalyst_asymmetry,
           bs.execution_quality
      from recommendations r
      join edge_runs er on er.run_id=r.run_id
      left join edge_recommendation_governance g on g.recommendation_id=r.recommendation_id
      left join recommendation_lifecycle l on l.recommendation_id=r.recommendation_id
      left join recommendation_performance p on p.recommendation_id=r.recommendation_id
      left join market_trust mt on mt.recommendation_id=r.recommendation_id
      left join bot_scores bs on bs.recommendation_id=r.recommendation_id
     where r.recommendation_id=${selectedId}
     limit 1
  `;

  if (!recommendationRows.length) {
    return json({
      engine: 'EDGE_STOCKS',
      canonical,
      error: 'Selected canonical points to a missing recommendation record',
      retrieval: retrieval({ exact_persisted_selection: true, exact_recommendation_identity: selectedId }),
    }, 409);
  }

  const componentScores = await sql`
    select component,original_weight,raw_score,normalized_direction,evidence_quality,
           availability_status,normalized_weight,weighted_contribution,conflict_flag,
           gate_override_flag,notes
      from component_scores
     where recommendation_id=${selectedId}
     order by component
  `;
  const executionRows = await sql`
    select * from execution_plans
     where recommendation_id=${selectedId}
     limit 1
  `;
  const evidenceRows = await sql`
    select re.use_role,e.evidence_id,e.ticker,e.evidence_type,e.source_kind,e.capture_timestamp,
           e.publication_timestamp,e.event_timestamp,e.ingestion_timestamp,e.freshness,e.quality,
           e.verification_status,e.file_ref,e.source_ref,e.observation,e.content_hash
      from recommendation_evidence re
      join evidence_items e on e.evidence_id=re.evidence_id
     where re.recommendation_id=${selectedId}
     order by e.evidence_id
  `;
  const researchRows = await sql`
    select erb.bundle_id,erb.ticker,erb.contract_version,erb.research_authority,
           erb.research_fresh_at,erb.created_at,erb.payload,erb.payload_hash,erb.status,
           rrb.linked_at
      from recommendation_research_bundle rrb
      join edge_research_bundles erb on erb.bundle_id=rrb.bundle_id
     where rrb.recommendation_id=${selectedId}
     limit 1
  `;
  const checkpoints = await sql`
    select oc.checkpoint_id,oc.checkpoint_type,oc.due_date,oc.status,oc.observed_at,
           oc.actual_price,oc.period_high,oc.period_low,oc.option_premium,oc.source_ref,oc.notes,
           ef.direction_result,ef.zone_result,ef.execution_result,ef.execution_score,
           ef.realized_r,ef.pnl,ef.mfe,ef.mae,ef.brier_score,ef.calibration_bucket,
           ef.primary_failure_code,ef.secondary_failure_codes,ef.overall_verdict,ef.computed_at
      from outcome_checkpoints oc
      left join efficacy_results ef on ef.checkpoint_id=oc.checkpoint_id
     where oc.recommendation_id=${selectedId}
     order by oc.due_date nulls last,oc.checkpoint_id
  `;

  const researchBundle = researchRows[0] ?? null;
  return json({
    engine: 'EDGE_STOCKS',
    canonical,
    analytical_record: recommendationRows[0],
    component_scores: componentScores,
    execution_plan: executionRows[0] ?? null,
    evidence: evidenceRows,
    research_bundle: researchBundle,
    outcome_checkpoints: checkpoints,
    core_shadow: { status: 'NOT_YET_LINKED_IN_CANONICAL_READ_V1', record: null },
    presentation: { status: 'NOT_AVAILABLE_UNTIL_P0_11', snapshot: null },
    completeness: {
      canonical_selection: true,
      analytical_record: true,
      component_scores: componentScores.length > 0,
      execution_plan: executionRows.length > 0,
      evidence_lineage: evidenceRows.length > 0,
      research_bundle: researchBundle !== null,
      outcome_checkpoints: checkpoints.length > 0,
      presentation_snapshot: false,
    },
    retrieval: retrieval({
      exact_persisted_selection: true,
      exact_recommendation_identity: selectedId,
      selected_for_headline_efficacy: true,
      canonical_store_binding: 'EDGE_DATABASE_URL',
    }),
  });
}
