import { neon } from '@neondatabase/serverless';
import { isAccessIdentityEnforced, resolveAccessActor, type AccessIdentityEnv } from './access-identity';

type Env = AccessIdentityEnv & {
  DATABASE_URL?: string;
  FIVEDR_DATABASE_URL?: string;
  EDGE_DATABASE_URL?: string;
  IPO_DATABASE_URL?: string;
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

function baseRetrieval(extra: JsonRecord = {}): JsonRecord {
  return {
    contract: 'CANONICAL_READ_V1',
    reconstructed_from_latest_run: false,
    inferred_from_workflow_name: false,
    efficacy_population_changed: false,
    fail_closed: true,
    ...extra,
  };
}

async function fiveDrHistory(env: Env, url: URL): Promise<Response> {
  if (!env.FIVEDR_DATABASE_URL) {
    return json({
      engine: '5DR',
      error: '5DR canonical database is not configured on the Console read gateway',
      retrieval: baseRetrieval({ exact_persisted_selection: false }),
    }, 503);
  }

  const tradingDate = url.searchParams.get('date');
  const forecastId = (url.searchParams.get('forecast_id') || '').trim() || null;
  if (!forecastId && !validIsoDate(tradingDate)) {
    return json({
      engine: '5DR',
      error: '5DR requires forecast_id or date (YYYY-MM-DD)',
      retrieval: baseRetrieval({ exact_persisted_selection: false }),
    }, 422);
  }
  if (tradingDate && !validIsoDate(tradingDate)) {
    return json({
      engine: '5DR',
      error: 'Invalid date; expected YYYY-MM-DD',
      retrieval: baseRetrieval({ exact_persisted_selection: false }),
    }, 422);
  }

  const sql = neon(env.FIVEDR_DATABASE_URL);
  const selections = forecastId
    ? await sql`
        select *
          from canonical_selections
         where selected_forecast_id=${forecastId}
         order by selected_at desc
      `
    : await sql`
        select *
          from canonical_selections
         where target_trading_date=${tradingDate}
         order by selected_at desc
      `;

  if (!selections.length && forecastId) {
    const candidateRows = await sql`
      select to_jsonb(fg) as governance,to_jsonb(f) as forecast,to_jsonb(r) as run
        from forecast_governance fg
        join forecasts f on f.forecast_id=fg.forecast_id
        join runs r on r.run_id=f.run_id
       where fg.forecast_id=${forecastId}
       limit 1
    `;
    if (candidateRows.length) {
      return json({
        engine: '5DR',
        canonical: null,
        audit_candidate: candidateRows[0],
        status: 'NON_SELECTED_CANDIDATE',
        analytical_record: null,
        presentation: { status: 'NOT_APPLICABLE_NON_CANONICAL', snapshot: null },
        retrieval: baseRetrieval({
          exact_persisted_selection: false,
          exact_candidate_identity: forecastId,
          selected_for_headline_efficacy: false,
          note: 'Candidate is preserved for audit but is not a selected canonical and cannot enter canonical efficacy.',
        }),
      });
    }
  }

  if (!selections.length) {
    return json({
      engine: '5DR',
      canonical: null,
      error: 'No governed canonical selection matches the requested identity',
      retrieval: baseRetrieval({ exact_persisted_selection: false }),
    }, 404);
  }

  if (selections.length > 1) {
    return json({
      engine: '5DR',
      error: 'Canonical selection identity is unexpectedly ambiguous',
      candidates: selections,
      retrieval: baseRetrieval({ exact_persisted_selection: false }),
    }, 409);
  }

  const canonical = selections[0] as JsonRecord;
  if (canonical.selection_status !== 'SELECTED' || !canonical.selected_forecast_id) {
    return json({
      engine: '5DR',
      canonical,
      analytical_record: null,
      daily_forecasts: [],
      component_scores: [],
      execution_plan: null,
      checkpoint_evaluations: [],
      recommendation_events: [],
      assessment_snapshot: null,
      issuance_evidence: {
        status: 'NOT_APPLICABLE_NO_VALID_CANDIDATE',
        records: [],
      },
      core_shadow: {
        status: 'NOT_APPLICABLE_NO_VALID_CANDIDATE',
        record: null,
      },
      presentation: {
        status: 'NOT_AVAILABLE_UNTIL_P0_11',
        snapshot: null,
      },
      completeness: {
        canonical_selection: true,
        analytical_record: false,
        daily_forecasts: false,
        component_scores: false,
        execution_plan: false,
        checkpoint_evaluations: false,
        recommendation_events: false,
        assessment_snapshot: false,
        evidence_lineage: false,
        presentation_snapshot: false,
      },
      retrieval: baseRetrieval({
        exact_persisted_selection: true,
        selected_for_headline_efficacy: false,
        note: 'NO_VALID_CANDIDATE is preserved as the immutable canonical state and is never backfilled.',
      }),
    });
  }

  const selectedId = String(canonical.selected_forecast_id);
  const forecastRows = await sql`
    select to_jsonb(f) as forecast,to_jsonb(r) as run,to_jsonb(fg) as governance,
           to_jsonb(ld) as lineage_delta
      from forecasts f
      join runs r on r.run_id=f.run_id
      left join forecast_governance fg on fg.forecast_id=f.forecast_id
      left join lineage_deltas ld on ld.forecast_id=f.forecast_id
     where f.forecast_id=${selectedId}
     limit 1
  `;

  if (!forecastRows.length) {
    return json({
      engine: '5DR',
      canonical,
      error: 'Selected canonical points to a missing forecast record',
      retrieval: baseRetrieval({
        exact_persisted_selection: true,
        exact_forecast_identity: selectedId,
      }),
    }, 409);
  }

  const dailyForecasts = await sql`
    select *
      from daily_forecasts
     where forecast_id=${selectedId}
     order by day_number
  `;
  const componentScores = await sql`
    select *
      from component_scores
     where forecast_id=${selectedId}
     order by component
  `;
  const executionRows = await sql`
    select *
      from execution_plans
     where forecast_id=${selectedId}
     limit 1
  `;
  const checkpointEvaluations = await sql`
    select *
      from forecast_checkpoint_evaluations
     where forecast_id=${selectedId}
     order by day_number,evaluated_at,evaluation_id
  `;
  const recommendationEvents = await sql`
    select *
      from recommendation_events
     where forecast_id=${selectedId}
     order by observed_at,event_id
  `;
  const assessmentRows = await sql`
    select *
      from assessment_snapshots
     where forecast_id=${selectedId}
     order by created_at desc,snapshot_id desc
  `;

  const completeness = {
    canonical_selection: true,
    analytical_record: true,
    daily_forecasts: dailyForecasts.length > 0,
    component_scores: componentScores.length > 0,
    execution_plan: executionRows.length > 0,
    checkpoint_evaluations: checkpointEvaluations.length > 0,
    recommendation_events: recommendationEvents.length > 0,
    assessment_snapshot: assessmentRows.length > 0,
    evidence_lineage: false,
    presentation_snapshot: false,
  };

  return json({
    engine: '5DR',
    canonical,
    analytical_record: forecastRows[0],
    daily_forecasts: dailyForecasts,
    component_scores: componentScores,
    execution_plan: executionRows[0] ?? null,
    checkpoint_evaluations: checkpointEvaluations,
    recommendation_events: recommendationEvents,
    assessment_snapshot: assessmentRows[0] ?? null,
    issuance_evidence: {
      status: 'PENDING_SCHEMA_BOUND_ADAPTER',
      records: [],
      note: 'The canonical database contains evidence_items and forecast_evidence; P0-12 will expose them only after their exact deployed relation is schema-verified.',
    },
    core_shadow: {
      status: 'NOT_YET_LINKED_IN_CANONICAL_READ_V1',
      record: null,
    },
    presentation: {
      status: 'NOT_AVAILABLE_UNTIL_P0_11',
      snapshot: null,
    },
    completeness,
    retrieval: baseRetrieval({
      exact_persisted_selection: true,
      exact_forecast_identity: selectedId,
      selected_for_headline_efficacy: true,
      canonical_store_binding: 'FIVEDR_DATABASE_URL',
    }),
  });
}

async function edgeStocksHistory(env: Env, url: URL): Promise<Response> {
  if (!env.EDGE_DATABASE_URL) {
    return json({ error: 'EDGE database is not configured', engine: 'EDGE_STOCKS' }, 503);
  }

  const ticker = (url.searchParams.get('ticker') || '').trim().toUpperCase();
  const tradingDate = url.searchParams.get('date');
  const recommendationId = (url.searchParams.get('recommendation_id') || '').trim() || null;
  const forecastHorizon = (url.searchParams.get('forecast_horizon') || '').trim() || null;

  if (!recommendationId && (!validTicker(ticker) || !validIsoDate(tradingDate))) {
    return json({
      error: 'EDGE_STOCKS requires recommendation_id or ticker + date (YYYY-MM-DD)',
      engine: 'EDGE_STOCKS',
    }, 422);
  }
  if (ticker && !validTicker(ticker)) return json({ error: 'Invalid ticker', engine: 'EDGE_STOCKS' }, 422);
  if (tradingDate && !validIsoDate(tradingDate)) return json({ error: 'Invalid date; expected YYYY-MM-DD', engine: 'EDGE_STOCKS' }, 422);

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
      retrieval: baseRetrieval({ exact_persisted_selection: false }),
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
      retrieval: baseRetrieval({ exact_persisted_selection: false }),
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
      presentation: {
        status: 'NOT_AVAILABLE_UNTIL_P0_11',
        snapshot: null,
      },
      retrieval: baseRetrieval({
        exact_persisted_selection: true,
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
      retrieval: baseRetrieval({
        exact_persisted_selection: true,
        exact_recommendation_identity: selectedId,
      }),
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
    select *
      from execution_plans
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
  const completeness = {
    canonical_selection: true,
    analytical_record: true,
    component_scores: componentScores.length > 0,
    execution_plan: executionRows.length > 0,
    evidence_lineage: evidenceRows.length > 0,
    research_bundle: researchBundle !== null,
    outcome_checkpoints: checkpoints.length > 0,
    presentation_snapshot: false,
  };

  return json({
    engine: 'EDGE_STOCKS',
    canonical,
    analytical_record: recommendationRows[0],
    component_scores: componentScores,
    execution_plan: executionRows[0] ?? null,
    evidence: evidenceRows,
    research_bundle: researchBundle,
    outcome_checkpoints: checkpoints,
    core_shadow: {
      status: 'NOT_YET_LINKED_IN_CANONICAL_READ_V1',
      record: null,
    },
    presentation: {
      status: 'NOT_AVAILABLE_UNTIL_P0_11',
      snapshot: null,
    },
    completeness,
    retrieval: baseRetrieval({
      exact_persisted_selection: true,
      exact_recommendation_identity: selectedId,
    }),
  });
}

/**
 * P0-12 governed historical read gateway.
 *
 * This is intentionally read-only. It resolves historical state from persisted
 * canonical identity rather than workflow names, latest-state substitution or
 * ChatGPT reconstruction. Engine-specific stores remain isolated behind this
 * stable contract.
 */
export async function handleP0CanonicalHistoryRead(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.pathname !== '/api/canonical-history') return null;

  const denied = await ownerOnly(request, env);
  if (denied) return denied;

  const engine = (url.searchParams.get('engine') || '').trim().toUpperCase();
  if (engine === '5DR' || engine === 'NIFTY') {
    return fiveDrHistory(env, url);
  }
  if (engine === 'EDGE_STOCKS' || engine === 'STOCKS' || engine === 'EDGE') {
    return edgeStocksHistory(env, url);
  }
  if (engine === 'IPO_EDGE' || engine === 'IPO') {
    return json({
      engine,
      error: 'CANONICAL_READ_V1 route for this engine is not implemented yet',
      retrieval: baseRetrieval({ exact_persisted_selection: false }),
    }, 501);
  }

  return json({ error: 'Unsupported engine', supported_engines: ['5DR', 'EDGE_STOCKS', 'IPO_EDGE'] }, 422);
}
