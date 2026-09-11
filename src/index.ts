import { neon } from '@neondatabase/serverless';

type Env = {
  ASSETS: Fetcher;
  EVIDENCE_BUCKET: R2Bucket;
  DATABASE_URL?: string;
  APP_ENV: string;
  OUTPUT_CONTRACT_VERSION: string;
};

type JsonRecord = Record<string, unknown>;

const MAX_EVIDENCE_FILES = 10;
const MAX_EVIDENCE_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EVIDENCE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf'
]);

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });

const isObject = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const sanitizeFilename = (name: string) => {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
  return cleaned.slice(0, 120) || 'evidence';
};

const evidencePrefix = (engine: string, now: Date) => {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${engine.toLowerCase()}/${yyyy}/${mm}/${dd}`;
};

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

async function uploadEvidence(request: Request, env: Env): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured' }, 503);
  if (!env.EVIDENCE_BUCKET) return json({ error: 'Evidence storage is not configured' }, 503);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Invalid multipart form data' }, 400);
  }

  const engine = String(form.get('engine') || '').trim();
  const provenanceMode = String(form.get('provenance_mode') || '').trim().toUpperCase();
  const capturedAtRaw = String(form.get('captured_at') || '').trim();
  const files = form.getAll('files').filter((entry): entry is File => entry instanceof File);

  if (engine !== '5DR') return json({ error: 'Evidence upload currently supports 5DR only' }, 422);
  if (!['MANUAL', 'HYBRID', 'AUTOMATED'].includes(provenanceMode)) {
    return json({ error: 'provenance_mode must be MANUAL, HYBRID or AUTOMATED' }, 422);
  }
  if (!files.length) return json({ error: 'At least one evidence file is required' }, 422);
  if (files.length > MAX_EVIDENCE_FILES) {
    return json({ error: `Maximum ${MAX_EVIDENCE_FILES} evidence files per upload` }, 413);
  }

  for (const file of files) {
    if (!ALLOWED_EVIDENCE_TYPES.has(file.type)) {
      return json({ error: `Unsupported evidence type: ${file.type || 'unknown'}`, file: file.name }, 415);
    }
    if (file.size <= 0 || file.size > MAX_EVIDENCE_FILE_BYTES) {
      return json({ error: 'Each evidence file must be between 1 byte and 10 MB', file: file.name }, 413);
    }
  }

  const capturedAt = capturedAtRaw && !Number.isNaN(Date.parse(capturedAtRaw))
    ? new Date(capturedAtRaw).toISOString()
    : new Date().toISOString();
  const now = new Date();
  const uploadBatchId = crypto.randomUUID();
  const sql = neon(env.DATABASE_URL);
  const uploaded: Array<Record<string, unknown>> = [];
  const storedKeys: string[] = [];

  try {
    for (const file of files) {
      const uploadId = crypto.randomUUID();
      const filename = sanitizeFilename(file.name);
      const objectKey = `${evidencePrefix(engine, now)}/${uploadBatchId}/${uploadId}-${filename}`;

      await env.EVIDENCE_BUCKET.put(objectKey, file.stream(), {
        httpMetadata: { contentType: file.type },
        customMetadata: {
          engine,
          provenance_mode: provenanceMode,
          upload_id: uploadId,
          batch_id: uploadBatchId,
          original_filename: filename,
          captured_at: capturedAt
        }
      });
      storedKeys.push(objectKey);

      await sql`
        insert into evidence_uploads (
          upload_id, batch_id, engine, provenance_mode, object_key, file_name,
          mime_type, size_bytes, captured_at, status, metadata
        ) values (
          ${uploadId}, ${uploadBatchId}, ${engine}, ${provenanceMode}, ${objectKey}, ${filename},
          ${file.type}, ${file.size}, ${capturedAt}, 'STAGED',
          ${JSON.stringify({ storage: 'R2', bucket_binding: 'EVIDENCE_BUCKET' })}::jsonb
        )
      `;

      uploaded.push({
        upload_id: uploadId,
        file_name: filename,
        mime_type: file.type,
        size_bytes: file.size,
        captured_at: capturedAt,
        status: 'STAGED'
      });
    }
  } catch (error) {
    console.error('Evidence upload failed', error);
    await Promise.allSettled(storedKeys.map((key) => env.EVIDENCE_BUCKET.delete(key)));
    if (uploaded.length) {
      await sql`delete from evidence_uploads where batch_id = ${uploadBatchId}`;
    }
    return json({ error: 'Evidence upload failed; staged files were rolled back' }, 500);
  }

  return json({
    ok: true,
    batch_id: uploadBatchId,
    engine,
    provenance_mode: provenanceMode,
    file_count: uploaded.length,
    evidence: uploaded,
    next_step: '5DR engine execution adapter'
  }, 201);
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
      evidence_storage_configured: Boolean(env.EVIDENCE_BUCKET),
      integrations: { '5DR': 'V2.1.2' }
    });
  }

  if (url.pathname === '/api/evidence/upload' && request.method === 'POST') {
    return uploadEvidence(request, env);
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
