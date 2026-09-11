import { neon } from '@neondatabase/serverless';

type Env = {
  ASSETS: Fetcher;
  DATABASE_URL?: string;
  APP_ENV: string;
  OUTPUT_CONTRACT_VERSION: string;
};

type JsonRecord = Record<string, unknown>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });

const isObject = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

function validate5drResult(result: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(result)) return ['result must be an object'];

  if (result.model_version !== '5DR_V2_1') {
    errors.push('result.model_version must be 5DR_V2_1');
  }
  if (result.output_contract_version !== '5DR_V2_1_2') {
    errors.push('result.output_contract_version must be 5DR_V2_1_2');
  }
  if (!isNonEmptyString(result.forecast_assessment)) {
    errors.push('result.forecast_assessment is mandatory');
  }
  if (!isNonEmptyString(result.recommendation_assessment)) {
    errors.push('result.recommendation_assessment is mandatory');
  }
  if (result.assessment_snapshot_complete !== true) {
    errors.push('result.assessment_snapshot_complete must be true');
  }
  if (result.recommendation_ledger_complete !== true) {
    errors.push('result.recommendation_ledger_complete must be true');
  }

  const requiredHorizons = ['D+1', 'D+2', 'D+3', 'D+4', 'D+5'];
  const horizons = result.horizon_slots;
  if (!isObject(horizons)) {
    errors.push('result.horizon_slots must be an object');
  } else {
    for (const horizon of requiredHorizons) {
      if (!(horizon in horizons)) errors.push(`result.horizon_slots.${horizon} is mandatory`);
    }
  }

  return errors;
}

function validate5drEnvelope(body: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(body)) return ['request body must be a JSON object'];

  if (body.contract_version !== '1.0') errors.push('contract_version must be 1.0');
  if (body.engine !== '5DR') errors.push('engine must be 5DR');
  if (!isNonEmptyString(body.run_id)) errors.push('run_id is mandatory');
  if (!isNonEmptyString(body.framework_version)) errors.push('framework_version is mandatory');
  if (!['SUCCESS', 'PARTIAL', 'FAILED', 'SHADOW'].includes(String(body.status))) {
    errors.push('status must be SUCCESS, PARTIAL, FAILED or SHADOW');
  }
  if (!isNonEmptyString(body.generated_at) || Number.isNaN(Date.parse(body.generated_at))) {
    errors.push('generated_at must be a valid ISO timestamp');
  }

  const provenance = body.provenance;
  if (!isObject(provenance)) {
    errors.push('provenance is mandatory');
  } else {
    if (!['MANUAL', 'HYBRID', 'AUTOMATED'].includes(String(provenance.mode))) {
      errors.push('provenance.mode must be MANUAL, HYBRID or AUTOMATED');
    }
    if (!Array.isArray(provenance.sources)) errors.push('provenance.sources must be an array');
  }

  errors.push(...validate5drResult(body.result));
  return errors;
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/api/health') {
    return json({
      ok: true,
      service: 'EDGE Console',
      environment: env.APP_ENV,
      contract_version: env.OUTPUT_CONTRACT_VERSION,
      database_configured: Boolean(env.DATABASE_URL),
      integrations: { '5DR': 'V2.1.2' }
    });
  }

  if (url.pathname === '/api/engines') {
    if (!env.DATABASE_URL) {
      return json({
        engines: [
          { id: '5DR', name: '5DR', mode: 'HYBRID', status: 'INTEGRATION_READY', version: '2.1.2' },
          { id: 'EDGE_STOCKS', name: 'EDGE Stocks', mode: 'HYBRID', status: 'FOUNDATION', version: '1.0' },
          { id: 'EDGE_IPO', name: 'EDGE IPO', mode: 'AUTOMATED', status: 'INTEGRATION_PENDING', version: '1.0' }
        ]
      });
    }

    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      select engine as id, display_name as name, production_version as version, status
      from engine_registry
      order by case engine when '5DR' then 1 when 'EDGE_STOCKS' then 2 else 3 end
    `;
    const engines = rows.map((row) => ({
      ...row,
      mode: row.id === 'EDGE_IPO' ? 'AUTOMATED' : 'HYBRID',
      status: row.id === '5DR' ? 'INTEGRATION_READY' : row.status
    }));
    return json({ engines });
  }

  if (url.pathname === '/api/runs/latest' && request.method === 'GET') {
    if (!env.DATABASE_URL) {
      return json({ runs: [], note: 'DATABASE_URL not configured yet' });
    }
    const sql = neon(env.DATABASE_URL);
    const engine = url.searchParams.get('engine');
    const runs = engine
      ? await sql`
          select run_id, engine, contract_version, framework_version, status, provenance_mode,
                 freshness_at, generated_at, published, result, warnings
          from analysis_runs
          where published = true and engine = ${engine}
          order by generated_at desc
          limit 20
        `
      : await sql`
          select run_id, engine, contract_version, framework_version, status, provenance_mode,
                 freshness_at, generated_at, published
          from analysis_runs
          where published = true
          order by generated_at desc
          limit 20
        `;
    return json({ runs });
  }

  if (url.pathname === '/api/5dr/latest' && request.method === 'GET') {
    if (!env.DATABASE_URL) return json({ run: null, note: 'DATABASE_URL not configured yet' }, 503);
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      select run_id, contract_version, framework_version, status, provenance_mode,
             sources, freshness_at, generated_at, result, warnings
      from analysis_runs
      where engine = '5DR' and published = true
      order by generated_at desc
      limit 1
    `;
    return json({ run: rows[0] ?? null, note: rows.length ? undefined : 'No published 5DR run yet' });
  }

  if (url.pathname === '/api/5dr/runs' && request.method === 'POST') {
    if (!env.DATABASE_URL) return json({ error: 'Database is not configured' }, 503);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const errors = validate5drEnvelope(body);
    if (errors.length) return json({ error: '5DR contract validation failed', details: errors }, 422);

    const payload = body as JsonRecord;
    const provenance = payload.provenance as JsonRecord;
    const sql = neon(env.DATABASE_URL);
    const existing = await sql`select run_id from analysis_runs where run_id = ${String(payload.run_id)} limit 1`;
    if (existing.length) return json({ error: 'run_id already exists; runs are immutable' }, 409);

    const status = String(payload.status);
    const requestedPublish = payload.published === true;
    if (requestedPublish && status !== 'SUCCESS') {
      return json({ error: 'Only SUCCESS runs may be published' }, 422);
    }

    const sources = Array.isArray(provenance.sources) ? provenance.sources : [];
    const freshnessAt = isNonEmptyString(provenance.freshness_at) ? provenance.freshness_at : null;
    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    const learningEligible = payload.learning_eligible !== false;

    await sql`
      insert into analysis_runs (
        run_id, engine, contract_version, framework_version, status, provenance_mode,
        sources, freshness_at, generated_at, result, warnings, learning_eligible, published
      ) values (
        ${String(payload.run_id)}, '5DR', ${String(payload.contract_version)},
        ${String(payload.framework_version)}, ${status}, ${String(provenance.mode)},
        ${JSON.stringify(sources)}::jsonb, ${freshnessAt}, ${String(payload.generated_at)},
        ${JSON.stringify(payload.result)}::jsonb, ${JSON.stringify(warnings)}::jsonb,
        ${learningEligible}, ${requestedPublish}
      )
    `;

    return json({
      ok: true,
      run_id: payload.run_id,
      engine: '5DR',
      published: requestedPublish,
      contract: '5DR_V2_1_2'
    }, 201);
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
