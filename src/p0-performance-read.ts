import { neon } from '@neondatabase/serverless';
import { isAccessIdentityEnforced, resolveAccessActor, type AccessIdentityEnv } from './access-identity';

type Env = AccessIdentityEnv & {
  DATABASE_URL?: string;
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
  if (actor.role !== 'OWNER') return json({ error: 'Canonical performance is owner-only; tester runs are sandbox-scoped' }, 403);
  return null;
}

async function fiveDrCanonicalPerformance(env: Env): Promise<Response> {
  if (!env.DATABASE_URL) return json({ performance: null, error: 'Database is not configured' }, 503);
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`
    select source_id,assessed_at,headline,score,metrics,created_at
      from assessment_rollups
     where engine='5DR'
     order by created_at desc,id desc
     limit 1
  `;
  if (!rows.length) return json({ performance: null, note: 'No persisted 5DR canonical assessment snapshot yet' });

  return json({
    engine: '5DR',
    population: 'PERSISTED_CANONICAL_ASSESSMENT_ROLLUP',
    performance: rows[0],
    retrieval: {
      selected_by: 'assessment_rollups created_at DESC, id DESC',
      exact_persisted_snapshot: true,
      reconstructed_from_latest_run: false,
      efficacy_population_changed: false,
    },
  });
}

async function edgeCanonicalPerformance(env: Env, tickerRaw: string | null): Promise<Response> {
  if (!env.EDGE_DATABASE_URL) return json({ canonical_runs: [], error: 'EDGE database is not configured' }, 503);
  const ticker = tickerRaw?.trim().toUpperCase() || null;
  if (ticker && !/^[A-Z0-9._&-]{1,20}$/.test(ticker)) return json({ canonical_runs: [], error: 'Invalid ticker' }, 422);

  const sql = neon(env.EDGE_DATABASE_URL);
  const rows = ticker
    ? await sql`
        select cs.canonical_key,cs.ticker,cs.target_trading_date,cs.forecast_horizon,
               cs.selection_status,cs.canonical_type,cs.selected_recommendation_id,
               cs.selected_at,cs.selection_reason,
               r.run_timestamp,r.definitive_forecast,r.definitive_recommendation,
               r.expected_price_zone_low,r.expected_price_zone_high,
               r.bull_probability,r.base_probability,r.bear_probability,
               r.market_trust_score,r.market_trust_band,r.bot_score,r.bot_grade,r.decision_ladder,
               l.status as lifecycle_status,l.expiry_trading_date,
               p.current_price,p.current_return_pct,p.outcome_verdict,p.last_assessed_at
          from edge_canonical_selections cs
          left join recommendations r on r.recommendation_id=cs.selected_recommendation_id
          left join recommendation_lifecycle l on l.recommendation_id=cs.selected_recommendation_id
          left join recommendation_performance p on p.recommendation_id=cs.selected_recommendation_id
         where cs.ticker=${ticker}
         order by cs.target_trading_date desc,cs.selected_at desc
         limit 60
      `
    : await sql`
        select cs.canonical_key,cs.ticker,cs.target_trading_date,cs.forecast_horizon,
               cs.selection_status,cs.canonical_type,cs.selected_recommendation_id,
               cs.selected_at,cs.selection_reason,
               r.run_timestamp,r.definitive_forecast,r.definitive_recommendation,
               r.expected_price_zone_low,r.expected_price_zone_high,
               r.bull_probability,r.base_probability,r.bear_probability,
               r.market_trust_score,r.market_trust_band,r.bot_score,r.bot_grade,r.decision_ladder,
               l.status as lifecycle_status,l.expiry_trading_date,
               p.current_price,p.current_return_pct,p.outcome_verdict,p.last_assessed_at
          from edge_canonical_selections cs
          left join recommendations r on r.recommendation_id=cs.selected_recommendation_id
          left join recommendation_lifecycle l on l.recommendation_id=cs.selected_recommendation_id
          left join recommendation_performance p on p.recommendation_id=cs.selected_recommendation_id
         order by cs.target_trading_date desc,cs.ticker,cs.selected_at desc
         limit 100
      `;

  const summaryRows = ticker
    ? await sql`select * from v_edge_stock_report where ticker=${ticker} limit 1`
    : await sql`select * from v_edge_master_report limit 1`;

  return json({
    engine: 'EDGE_STOCKS',
    ticker,
    population: 'GOVERNED_EDGE_CANONICAL_SELECTIONS',
    summary: summaryRows[0] ?? null,
    canonical_runs: rows,
    retrieval: {
      selected_by: ticker
        ? 'target_trading_date DESC, selected_at DESC for ticker'
        : 'target_trading_date DESC, ticker, selected_at DESC',
      exact_persisted_selection: true,
      reconstructed_from_latest_run: false,
      efficacy_population_changed: false,
    },
  });
}

/** Read-only P0 canonical-performance recovery. */
export async function handleP0PerformanceRead(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.pathname !== '/api/5dr/canonical-performance' && url.pathname !== '/api/edge-stocks/canonical-performance') return null;

  const denied = await ownerOnly(request, env);
  if (denied) return denied;

  if (url.pathname === '/api/5dr/canonical-performance') return fiveDrCanonicalPerformance(env);
  return edgeCanonicalPerformance(env, url.searchParams.get('ticker'));
}
