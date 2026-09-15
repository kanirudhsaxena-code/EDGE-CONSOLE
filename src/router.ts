import { neon } from '@neondatabase/serverless';
import app from './index';

type Env = {
  ASSETS: Fetcher;
  EVIDENCE_BUCKET: R2Bucket;
  DATABASE_URL?: string;
  APP_ENV: string;
  OUTPUT_CONTRACT_VERSION: string;
};

type JsonRecord = Record<string, unknown>;

const REQUIRED_5DR_INPUTS = [
  'regime', 'component_scores', 'market_trust_inputs', 'event_shock',
  'execution_inputs', 'data_adequate', 'event_kill_switch', 'expected_rr',
  'forecast_assessment', 'recommendation_assessment', 'horizon_slots',
  'recommendation_ledger_complete', 'assessment_snapshot_complete'
] as const;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' }
});
const isObject = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function validateNormalizedEvidence(body: unknown): string[] {
  if (!isObject(body) || !Array.isArray(body.evidence)) return ['evidence must be an array'];
  if (!body.evidence.length) return ['at least one normalized evidence item is required'];
  if (body.evidence.length > 20) return ['maximum 20 normalized evidence items'];
  const errors: string[] = [];
  body.evidence.forEach((item, index) => {
    if (!isObject(item)) { errors.push(`evidence[${index}] must be an object`); return; }
    if (!isNonEmptyString(item.evidence_type)) errors.push(`evidence[${index}].evidence_type is mandatory`);
    if (!isNonEmptyString(item.source_ref)) errors.push(`evidence[${index}].source_ref is mandatory`);
    if (item.captured_at !== undefined && item.captured_at !== null && (!isNonEmptyString(item.captured_at) || Number.isNaN(Date.parse(item.captured_at)))) errors.push(`evidence[${index}].captured_at must be a valid ISO timestamp`);
    if (!isObject(item.normalized) || Object.keys(item.normalized).length === 0) errors.push(`evidence[${index}].normalized must be a non-empty object`);
  });
  return errors;
}

function assessCompleteness(evidence: unknown[]): { missing: string[]; conflicts: string[] } {
  const seen = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const item of evidence) {
    if (!isObject(item) || !isObject(item.normalized)) continue;
    for (const [key, value] of Object.entries(item.normalized)) {
      if (!REQUIRED_5DR_INPUTS.includes(key as typeof REQUIRED_5DR_INPUTS[number])) continue;
      const encoded = JSON.stringify(value);
      if (seen.has(key) && seen.get(key) !== encoded) conflicts.add(key);
      else seen.set(key, encoded);
    }
  }
  return { missing: REQUIRED_5DR_INPUTS.filter(key => !seen.has(key)), conflicts: [...conflicts] };
}

async function saveNormalizedEvidence(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured' }, 503);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const errors = validateNormalizedEvidence(body);
  if (errors.length) return json({ error: 'Normalized evidence validation failed', details: errors }, 422);
  const payload = body as JsonRecord;
  const evidence = payload.evidence as unknown[];
  const assessment = assessCompleteness(evidence);
  const executable = assessment.missing.length === 0 && assessment.conflicts.length === 0;

  const sql = neon(env.DATABASE_URL);
  const rows = await sql`select request_id, status, metadata from analysis_requests where request_id = ${requestId} and engine = '5DR' limit 1`;
  if (!rows.length) return json({ error: 'request_id not found' }, 404);
  if (!['READY_FOR_ENGINE', 'PROCESSING'].includes(String(rows[0].status))) return json({ error: 'request_id is not eligible for normalization' }, 409);
  const current = isObject(rows[0].metadata) ? rows[0].metadata as JsonRecord : {};
  const metadata = { ...current, normalized_evidence: evidence, normalized_at: new Date().toISOString(), normalization_assessment: assessment, adapter_stage: executable ? 'NORMALIZED_READY' : 'NORMALIZATION_BLOCKED' };
  await sql`update analysis_requests set metadata = ${JSON.stringify(metadata)}::jsonb, error = null, updated_at = now() where request_id = ${requestId}`;
  return json({ ok: executable, request_id: requestId, normalized_items: evidence.length, adapter_stage: metadata.adapter_stage, blockers: assessment, next_step: executable ? 'Execute governed 5DR runner' : 'Supply missing or resolve conflicting normalized inputs' }, executable ? 200 : 409);
}

async function executionPacket(env: Env, requestId: string): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured' }, 503);
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`select request_id, provenance_mode, framework_version, output_contract_version, status, metadata from analysis_requests where request_id = ${requestId} and engine = '5DR' limit 1`;
  if (!rows.length) return json({ error: 'request_id not found' }, 404);
  if (!['READY_FOR_ENGINE', 'PROCESSING'].includes(String(rows[0].status))) return json({ error: 'request_id is not eligible for execution' }, 409);
  const metadata = isObject(rows[0].metadata) ? rows[0].metadata as JsonRecord : {};
  if (metadata.adapter_stage !== 'NORMALIZED_READY' || !Array.isArray(metadata.normalized_evidence) || !metadata.normalized_evidence.length) return json({ error: 'request is not normalization-ready', blockers: metadata.normalization_assessment ?? null, next_step: 'Complete normalized evidence before execution' }, 409);
  return json({ request_id: String(rows[0].request_id), provenance_mode: String(rows[0].provenance_mode), framework_version: String(rows[0].framework_version), output_contract_version: String(rows[0].output_contract_version), evidence: metadata.normalized_evidence });
}

async function failRequest(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured' }, 503);
  let body: unknown = {}; try { body = await request.json(); } catch { /* optional */ }
  const detail = isObject(body) && isNonEmptyString(body.error) ? body.error.slice(0, 2000) : '5DR execution failed';
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`select request_id, status from analysis_requests where request_id = ${requestId} and engine = '5DR' limit 1`;
  if (!rows.length) return json({ error: 'request_id not found' }, 404);
  if (String(rows[0].status) === 'COMPLETED') return json({ error: 'completed request cannot be failed' }, 409);
  await sql`update analysis_requests set status = 'FAILED', error = ${JSON.stringify({ stage: 'EXECUTION', detail })}::jsonb, updated_at = now() where request_id = ${requestId}`;
  return json({ ok: true, request_id: requestId, status: 'FAILED' });
}

export default { async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const normalized = url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/normalized$/);
  if (normalized && request.method === 'POST') return saveNormalizedEvidence(request, env, decodeURIComponent(normalized[1]));
  const packet = url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/execution-packet$/);
  if (packet && request.method === 'GET') return executionPacket(env, decodeURIComponent(packet[1]));
  const failed = url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/fail$/);
  if (failed && request.method === 'POST') return failRequest(request, env, decodeURIComponent(failed[1]));
  return app.fetch(request, env);
}};
