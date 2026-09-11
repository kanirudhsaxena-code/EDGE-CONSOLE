import { neon } from '@neondatabase/serverless';

type Env = {
  ASSETS: Fetcher;
  DATABASE_URL?: string;
  APP_ENV: string;
  OUTPUT_CONTRACT_VERSION: string;
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/api/health') {
    return json({
      ok: true,
      service: 'EDGE Console',
      environment: env.APP_ENV,
      contract_version: env.OUTPUT_CONTRACT_VERSION,
      database_configured: Boolean(env.DATABASE_URL)
    });
  }

  if (url.pathname === '/api/engines') {
    return json({
      engines: [
        { id: '5DR', name: '5DR', mode: 'HYBRID', status: 'FOUNDATION' },
        { id: 'EDGE_STOCKS', name: 'EDGE Stocks', mode: 'HYBRID', status: 'FOUNDATION' },
        { id: 'EDGE_IPO', name: 'EDGE IPO', mode: 'AUTOMATED', status: 'INTEGRATION_PENDING' }
      ]
    });
  }

  if (url.pathname === '/api/runs/latest') {
    if (!env.DATABASE_URL) {
      return json({ runs: [], note: 'DATABASE_URL not configured yet' });
    }
    const sql = neon(env.DATABASE_URL);
    const runs = await sql`
      select run_id, engine, framework_version, status, provenance_mode,
             generated_at, published
      from analysis_runs
      where published = true
      order by generated_at desc
      limit 20
    `;
    return json({ runs });
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env);
      } catch (error) {
        console.error(error);
        return json({ error: 'Internal server error' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
