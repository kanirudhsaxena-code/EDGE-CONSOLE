import { neon } from '@neondatabase/serverless';
import { isAccessIdentityEnforced, resolveAccessActor, type AccessIdentityEnv } from './access-identity';

type Env = AccessIdentityEnv & {
  DATABASE_URL?: string;
  EDGE_DATABASE_URL?: string;
};

type JsonRecord = Record<string, unknown>;

const EDGE_FORECAST_LABELS = ['D','D+1','D+2','D+3','D+4'] as const;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'private, no-store',
  },
});

const isObject = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function ownerReadAllowed(request: Request, env: Env): Promise<{ allowed: boolean; response?: Response }> {
  if (!isAccessIdentityEnforced(env)) return { allowed: true };
  const actor = await resolveAccessActor(request, env);
  if (!actor.authenticated) return { allowed: false, response: json({ error: 'Authenticated Console identity is required' }, 401) };
  if (actor.role !== 'OWNER') return { allowed: false };
  return { allowed: true };
}

async function fiveDrCurrent(request: Request, env: Env): Promise<Response> {
  if (!env.DATABASE_URL) return json({ run: null, error: 'Database is not configured' }, 503);
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`
    select ar.run_id,ar.contract_version,ar.framework_version,ar.status,ar.provenance_mode,
           ar.sources,ar.freshness_at,ar.generated_at,ar.published,ar.result,ar.warnings,
           req.request_id,req.metadata
      from analysis_runs ar
      left join lateral (
        select request_id,metadata
          from analysis_requests
         where engine='5DR' and run_id=ar.run_id
         order by updated_at desc
         limit 1
      ) req on true
     where ar.engine='5DR'
       and ar.published=true
       and ar.status='SUCCESS'
     order by ar.generated_at desc,ar.run_id desc
     limit 1
  `;
  if (!rows.length) return json({ run: null, note: 'No successful published 5DR run yet' });

  const row = rows[0] as JsonRecord;
  const metadata = isObject(row.metadata) ? row.metadata : {};
  const canonicalAttempt = isObject(metadata.canonical_attempt) ? metadata.canonical_attempt : null;
  const invocation = isObject(metadata.invocation) ? metadata.invocation : null;
  const { metadata: _metadata, request_id: _requestId, ...run } = row;

  return json({
    run,
    retrieval: {
      kind: 'CURRENT_LATEST_SUCCESSFUL_PUBLISHED',
      request_id: row.request_id ?? null,
      canonical_attempt: canonicalAttempt,
      invocation,
      is_canonical_attempt: canonicalAttempt !== null,
      selected_by: 'generated_at DESC, run_id DESC',
      efficacy_population_changed: false,
    },
  });
}

function exactForecastPathReadModel(header: JsonRecord, rows: JsonRecord[]): JsonRecord {
  if (rows.length !== 5) throw new Error('Persisted EDGE forecast path must contain exactly five rows');
  rows.forEach((row,index)=>{
    if (Number(row.horizon_index) !== index || String(row.horizon_label ?? '') !== EDGE_FORECAST_LABELS[index]) {
      throw new Error('Persisted EDGE forecast path is incomplete or misordered');
    }
  });
  return {
    recommendation_id: header.recommendation_id,
    version: header.path_version,
    source_run_id: header.source_run_id,
    issued_at: header.issued_at,
    payload_hash: header.payload_hash,
    rows: rows.map(row=>({
      horizon_index: Number(row.horizon_index),
      horizon_label: row.horizon_label,
      target_trading_date: row.target_trading_date,
      direction: row.direction,
      bull_probability: Number(row.bull_probability),
      base_probability: Number(row.base_probability),
      bear_probability: Number(row.bear_probability),
      expected_centre: row.expected_centre == null ? null : Number(row.expected_centre),
      outer_expected_zone_low: Number(row.outer_expected_zone_low),
      outer_expected_zone_high: Number(row.outer_expected_zone_high),
      evidence_basis: row.evidence_basis,
      regime_context: row.regime_context,
      verification_state: row.verification_state,
      lineage: row.lineage,
    })),
  };
}

async function edgeStocksCurrent(env: Env, tickerRaw: string): Promise<Response> {
  if (!env.EDGE_DATABASE_URL) return json({ current_run: null, error: 'EDGE database is not configured' }, 503);
  const ticker = tickerRaw.trim().toUpperCase();
  if (!/^[A-Z0-9._&-]{1,20}$/.test(ticker)) return json({ current_run: null, error: 'Invalid ticker' }, 422);

  const sql = neon(env.EDGE_DATABASE_URL);
  const rows = await sql`
    select r.recommendation_id,r.ticker,r.company_name,r.run_timestamp,r.forecast_horizon,
           r.definitive_forecast,r.definitive_recommendation,r.expected_price_zone_low,
           r.expected_price_zone_high,r.bull_probability,r.base_probability,r.bear_probability,
           r.market_trust_score,r.market_trust_band,r.bot_score,r.bot_grade,r.decision_ladder,
           l.status as lifecycle_status,l.expiry_trading_date,
           p.current_price,p.current_return_pct,p.outcome_verdict,p.last_assessed_at
      from recommendations r
      left join recommendation_lifecycle l using(recommendation_id)
      left join recommendation_performance p using(recommendation_id)
     where r.ticker=${ticker}
     order by r.run_timestamp desc,r.recommendation_id desc
     limit 1
  `;
  if (!rows.length) return json({ current_run: null, ticker, note: 'No EDGE Stocks run found for ticker' }, 404);

  const current = rows[0] as JsonRecord;
  const recommendationId = String(current.recommendation_id ?? '');
  const canonicalRows = await sql`
    select canonical_key,target_trading_date,forecast_horizon,selection_status,canonical_type,
           selected_recommendation_id,selected_at,selection_reason
      from edge_canonical_selections
     where ticker=${ticker}
     order by target_trading_date desc,selected_at desc
     limit 1
  `;
  const canonical = canonicalRows.length ? canonicalRows[0] as JsonRecord : null;

  const forecastHeaders = await sql`
    select recommendation_id,path_version,source_run_id,issued_at,payload_hash
      from edge_stock_forecast_paths
     where recommendation_id=${recommendationId}
     limit 1
  `;
  let forecastPath: JsonRecord | null = null;
  if (forecastHeaders.length) {
    const forecastRows = await sql`
      select horizon_index,horizon_label,target_trading_date,direction,
             bull_probability,base_probability,bear_probability,expected_centre,
             outer_expected_zone_low,outer_expected_zone_high,evidence_basis,
             regime_context,verification_state,lineage
        from edge_stock_forecast_path_rows
       where recommendation_id=${recommendationId}
       order by horizon_index asc
    `;
    forecastPath = exactForecastPathReadModel(
      forecastHeaders[0] as JsonRecord,
      forecastRows.map(row=>row as JsonRecord),
    );
  }

  return json({
    ticker,
    current_run: current,
    forecast_path: forecastPath,
    forecast_path_retrieval: {
      kind: 'IMMUTABLE_D_THROUGH_D_PLUS_4_BY_RECOMMENDATION_ID',
      path_version: forecastPath?.version ?? null,
      payload_hash: forecastPath?.payload_hash ?? null,
      exact_row_count: forecastPath ? 5 : 0,
      fail_closed_on_incomplete_or_misordered: true,
      efficacy_population_changed: false,
    },
    retrieval: {
      kind: 'CURRENT_LATEST_TICKER_RUN',
      selected_by: 'run_timestamp DESC, recommendation_id DESC',
      canonical_governance: canonical ? {
        ...canonical,
        current_run_is_selected: String(canonical.selected_recommendation_id ?? '') === recommendationId,
      } : {
        selection_status: 'NOT_AVAILABLE',
        canonical_type: 'NOT_AVAILABLE',
        current_run_is_selected: false,
      },
      efficacy_population_changed: false,
    },
  });
}

/**
 * P0 operational recovery read shim.
 *
 * This layer makes current/latest retrieval explicit and deterministic without
 * changing scoring, canonical selection, efficacy populations, recommendations,
 * Market Trust, or trading behavior. Tester reads remain delegated to the
 * existing scoped/sandbox handlers when identity enforcement is enabled.
 */
export async function handleP0CurrentRead(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  const relevant = url.pathname === '/api/5dr/latest' ||
    url.pathname === '/api/5dr/current' ||
    url.pathname === '/api/edge-stocks/current';
  if (!relevant) return null;

  const access = await ownerReadAllowed(request, env);
  if (!access.allowed) {
    if (access.response) return access.response;
    if (url.pathname === '/api/5dr/latest') return null;
    return json({ error: 'Current canonical read is owner-only; tester runs remain sandbox-scoped' }, 403);
  }

  if (url.pathname === '/api/5dr/latest' || url.pathname === '/api/5dr/current') {
    return fiveDrCurrent(request, env);
  }

  return edgeStocksCurrent(env, url.searchParams.get('ticker') || '');
}
