import { neon } from '@neondatabase/serverless';
import { isAccessIdentityEnforced, resolveAccessActor, type AccessIdentityEnv } from './access-identity';

type Env = AccessIdentityEnv & {
  FIVEDR_DATABASE_URL?: string;
};

type JsonRecord = Record<string, unknown>;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'private, no-store',
  },
});

const retrieval = (extra: JsonRecord = {}) => ({
  contract: 'CANONICAL_READ_V1',
  reconstructed_from_latest_run: false,
  inferred_from_workflow_name: false,
  efficacy_population_changed: false,
  fail_closed: true,
  ...extra,
});

async function ownerOnly(request: Request, env: Env): Promise<Response | null> {
  if (!isAccessIdentityEnforced(env)) return null;
  const actor = await resolveAccessActor(request, env);
  if (!actor.authenticated) return json({ error: 'Authenticated Console identity is required' }, 401);
  if (actor.role !== 'OWNER') return json({ error: 'Canonical history is owner-only; tester runs are sandbox-scoped' }, 403);
  return null;
}

function validIsoDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * P0-12 exact historical reader for the 5DR/NIFTY canonical store.
 *
 * The adapter is intentionally bound to FIVEDR_DATABASE_URL rather than the
 * Console DATABASE_URL. All table/column names in this reader were verified
 * against the deployed 5DR production schema on 2026-09-28.
 */
export async function handleP05drCanonicalHistoryRead(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.pathname !== '/api/canonical-history') return null;

  const engine = (url.searchParams.get('engine') || '').trim().toUpperCase();
  if (engine !== '5DR' && engine !== 'NIFTY') return null;

  const denied = await ownerOnly(request, env);
  if (denied) return denied;

  if (!env.FIVEDR_DATABASE_URL) {
    return json({
      engine: '5DR',
      error: '5DR canonical database is not configured on the Console read gateway',
      retrieval: retrieval({ exact_persisted_selection: false }),
    }, 503);
  }

  const tradingDate = url.searchParams.get('date');
  const forecastId = (url.searchParams.get('forecast_id') || '').trim() || null;
  if (!forecastId && !validIsoDate(tradingDate)) {
    return json({
      engine: '5DR',
      error: '5DR requires forecast_id or date (YYYY-MM-DD)',
      retrieval: retrieval({ exact_persisted_selection: false }),
    }, 422);
  }
  if (tradingDate && !validIsoDate(tradingDate)) {
    return json({
      engine: '5DR',
      error: 'Invalid date; expected YYYY-MM-DD',
      retrieval: retrieval({ exact_persisted_selection: false }),
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
        presentation: { status: 'NOT_APPLICABLE_NON_CANONICAL', snapshot: null },
        retrieval: retrieval({
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
      retrieval: retrieval({ exact_persisted_selection: false }),
    }, 404);
  }

  if (selections.length > 1) {
    return json({
      engine: '5DR',
      error: 'Canonical selection identity is unexpectedly ambiguous',
      candidates: selections,
      retrieval: retrieval({ exact_persisted_selection: false }),
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
      issuance_evidence: [],
      checkpoint_evaluations: [],
      recommendation_events: [],
      assessment_snapshot: null,
      core_shadow: { status: 'NOT_APPLICABLE_NO_VALID_CANDIDATE', record: null },
      presentation: { status: 'NOT_AVAILABLE_UNTIL_P0_11', snapshot: null },
      completeness: {
        canonical_selection: true,
        analytical_record: false,
        daily_forecasts: false,
        component_scores: false,
        execution_plan: false,
        evidence_lineage: false,
        checkpoint_evaluations: false,
        recommendation_events: false,
        assessment_snapshot: false,
        presentation_snapshot: false,
      },
      retrieval: retrieval({
        exact_persisted_selection: true,
        selected_for_headline_efficacy: false,
        note: 'NO_VALID_CANDIDATE is preserved as the immutable canonical state and is never backfilled.',
      }),
    });
  }

  const selectedId = String(canonical.selected_forecast_id);
  const forecastRows = await sql`
    select to_jsonb(f) as forecast,to_jsonb(r) as run,to_jsonb(fg) as governance
      from forecasts f
      join runs r on r.run_id=f.run_id
      left join forecast_governance fg on fg.forecast_id=f.forecast_id
     where f.forecast_id=${selectedId}
     limit 1
  `;
  if (!forecastRows.length) {
    return json({
      engine: '5DR',
      canonical,
      error: 'Selected canonical points to a missing forecast record',
      retrieval: retrieval({ exact_persisted_selection: true, exact_forecast_identity: selectedId }),
    }, 409);
  }

  const lineageRows = await sql`
    select * from lineage_deltas
     where forecast_id=${selectedId}
     order by created_at
  `;
  const dailyForecasts = await sql`
    select * from daily_forecasts
     where forecast_id=${selectedId}
     order by day_number,daily_forecast_id
  `;
  const componentScores = await sql`
    select * from component_scores
     where forecast_id=${selectedId}
     order by component,component_score_id
  `;
  const executionRows = await sql`
    select * from execution_plans
     where forecast_id=${selectedId}
     limit 1
  `;
  const evidenceRows = await sql`
    select fe.use_role,e.*
      from forecast_evidence fe
      join evidence_items e on e.evidence_id=fe.evidence_id
     where fe.forecast_id=${selectedId}
     order by e.evidence_id
  `;
  const checkpointEvaluations = await sql`
    select * from forecast_checkpoint_evaluations
     where forecast_id=${selectedId}
     order by day_number,evaluated_at,evaluation_id
  `;
  const recommendationEvents = await sql`
    select * from recommendation_events
     where forecast_id=${selectedId}
     order by event_timestamp,event_id
  `;
  const assessmentRows = await sql`
    select * from assessment_snapshots
     where forecast_id=${selectedId}
     order by created_at desc,assessment_snapshot_id desc
  `;

  const analyticalRecord = forecastRows[0] as JsonRecord;
  const governance = (analyticalRecord.governance ?? null) as JsonRecord | null;
  const runClass = governance && typeof governance.run_class === 'string' ? governance.run_class : null;

  return json({
    engine: '5DR',
    canonical,
    canonical_type: runClass ? {
      status: 'PERSISTED_RUN_CLASS',
      value: runClass,
      source: 'forecast_governance.run_class',
    } : {
      status: 'NOT_PERSISTED_FOR_SELECTED_FORECAST',
      value: null,
      source: null,
    },
    analytical_record: analyticalRecord,
    lineage_deltas: lineageRows,
    daily_forecasts: dailyForecasts,
    component_scores: componentScores,
    execution_plan: executionRows[0] ?? null,
    issuance_evidence: evidenceRows,
    checkpoint_evaluations: checkpointEvaluations,
    recommendation_events: recommendationEvents,
    assessment_snapshot: assessmentRows[0] ?? null,
    core_shadow: { status: 'NOT_YET_LINKED_IN_CANONICAL_READ_V1', record: null },
    presentation: { status: 'NOT_AVAILABLE_UNTIL_P0_11', snapshot: null },
    completeness: {
      canonical_selection: true,
      analytical_record: true,
      lineage_deltas: lineageRows.length > 0,
      daily_forecasts: dailyForecasts.length > 0,
      component_scores: componentScores.length > 0,
      execution_plan: executionRows.length > 0,
      evidence_lineage: evidenceRows.length > 0,
      checkpoint_evaluations: checkpointEvaluations.length > 0,
      recommendation_events: recommendationEvents.length > 0,
      assessment_snapshot: assessmentRows.length > 0,
      presentation_snapshot: false,
    },
    retrieval: retrieval({
      exact_persisted_selection: true,
      exact_forecast_identity: selectedId,
      selected_for_headline_efficacy: true,
      canonical_store_binding: 'FIVEDR_DATABASE_URL',
      production_schema_verified_at: '2026-09-28',
    }),
  });
}
