import { neon } from '@neondatabase/serverless';
import app from './index';
import { assessCompleteness, isNonEmptyString, isObject, validateNormalizedEvidence, type JsonRecord } from './normalization';
import { assessUserEvidenceReadiness, REQUIRED_USER_5DR_EVIDENCE_CATEGORIES, SYSTEM_OWNED_5DR_EVIDENCE_CATEGORIES } from './evidence-readiness';
import { assessAutonomousEvidence, initialAutonomousEvidenceState, type AutonomousEvidenceItem } from './autonomous-evidence';
import { canAdvanceIntelligenceHandoff, type IntelligenceHandoff } from './intelligence-contract';

type Env = { ASSETS: Fetcher; EVIDENCE_BUCKET: R2Bucket; DATABASE_URL?: string; APP_ENV: string; OUTPUT_CONTRACT_VERSION: string; };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

async function createScreenshotReadyRequest(request: Request, env: Env): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured' }, 503);
  let body: unknown; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!isObject(body) || !isNonEmptyString(body.batch_id)) return json({ error: 'batch_id is mandatory' }, 422);
  const readiness = assessUserEvidenceReadiness(body.evidence_categories);
  if (readiness.invalid.length) return json({ error: 'Unknown user-owned 5DR evidence categories', invalid_categories: readiness.invalid, required_categories: REQUIRED_USER_5DR_EVIDENCE_CATEGORIES }, 422);
  if (!readiness.ready) return json({ error: '5DR screenshot readiness gate blocked', missing_categories: readiness.missing, required_categories: REQUIRED_USER_5DR_EVIDENCE_CATEGORIES }, 409);

  const batchId = String(body.batch_id), sql = neon(env.DATABASE_URL);
  const existing = await sql`select request_id,engine,batch_id,provenance_mode,framework_version,output_contract_version,status,run_id,metadata,created_at,updated_at from analysis_requests where batch_id=${batchId} limit 1`;
  if (existing.length) return json({ ok: true, request: existing[0], idempotent: true });
  const evidence = await sql`select upload_id,batch_id,engine,provenance_mode,mime_type,captured_at,status from evidence_uploads where batch_id=${batchId} order by id`;
  if (!evidence.length) return json({ error: 'Evidence batch not found' }, 404);
  if (evidence.some(row => row.engine !== '5DR')) return json({ error: 'Evidence batch is not a 5DR batch' }, 422);
  if (evidence.some(row => row.status !== 'STAGED')) return json({ error: 'Evidence batch is not fully staged' }, 409);
  const provenanceMode = String(evidence[0].provenance_mode);
  if (evidence.some(row => row.provenance_mode !== provenanceMode)) return json({ error: 'Evidence batch has mixed provenance modes' }, 422);

  const requestId = `5drreq_${crypto.randomUUID()}`;
  const metadata = {
    evidence_file_count: evidence.length,
    user_evidence_readiness: { status: 'SCREENSHOTS_READY', declared_categories: readiness.declared, required_categories: REQUIRED_USER_5DR_EVIDENCE_CATEGORIES, assessed_at: new Date().toISOString() },
    autonomous_evidence: { status: 'PENDING', required_categories: SYSTEM_OWNED_5DR_EVIDENCE_CATEGORIES, items: initialAutonomousEvidenceState() },
    adapter_stage: 'SCREENSHOTS_READY'
  };
  await sql`insert into analysis_requests (request_id,engine,batch_id,provenance_mode,framework_version,output_contract_version,status,metadata) values (${requestId},'5DR',${batchId},${provenanceMode},'5DR_V2_1','5DR_V2_1_2','READY_FOR_ENGINE',${JSON.stringify(metadata)}::jsonb)`;
  await sql`update evidence_uploads set request_id=${requestId},status='READY_FOR_ENGINE' where batch_id=${batchId}`;
  return json({ ok: true, request: { request_id: requestId, batch_id: batchId, status: 'READY_FOR_ENGINE', metadata }, next_step: 'SYSTEM_EVIDENCE_ACQUISITION' }, 201);
}

async function saveAutonomousEvidence(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured' }, 503);
  let body: unknown; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!isObject(body) || !Array.isArray(body.items)) return json({ error: 'items array is mandatory' }, 422);
  const items = body.items as AutonomousEvidenceItem[];
  const allowed = new Set(SYSTEM_OWNED_5DR_EVIDENCE_CATEGORIES);
  if (items.some(item => !item || !allowed.has(item.category) || !['PENDING','VERIFIED','DEGRADED','UNAVAILABLE'].includes(item.status) || !Array.isArray(item.source_refs))) return json({ error: 'Invalid autonomous evidence envelope' }, 422);
  const assessment = assessAutonomousEvidence(items);
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`select request_id,status,metadata from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
  if (!rows.length) return json({ error: 'request_id not found' }, 404);
  if (!['READY_FOR_ENGINE','PROCESSING'].includes(String(rows[0].status))) return json({ error: 'request_id is not eligible for autonomous evidence' }, 409);
  const current = isObject(rows[0].metadata) ? rows[0].metadata as JsonRecord : {};
  if (!['SCREENSHOTS_READY','AUTONOMOUS_EVIDENCE_BLOCKED'].includes(String(current.adapter_stage ?? ''))) return json({ error: 'request is not at autonomous evidence stage', adapter_stage: current.adapter_stage ?? null }, 409);
  const metadata = { ...current, autonomous_evidence: { status: assessment.next_stage, items, assessment, assessed_at: new Date().toISOString() }, adapter_stage: assessment.next_stage };
  await sql`update analysis_requests set metadata=${JSON.stringify(metadata)}::jsonb,updated_at=now() where request_id=${requestId}`;
  return json({ ok: assessment.complete, request_id: requestId, adapter_stage: assessment.next_stage, assessment, next_step: assessment.complete ? 'INTELLIGENCE_HANDOFF' : 'RETRY_SYSTEM_EVIDENCE' }, assessment.complete ? 200 : 409);
}

async function saveIntelligenceHandoff(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured' }, 503);
  let body: unknown; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const assessment = canAdvanceIntelligenceHandoff(body);
  if (!isObject(body) || body.request_id !== requestId) return json({ error: 'intelligence request_id mismatch' }, 422);
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`select request_id,status,metadata from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
  if (!rows.length) return json({ error: 'request_id not found' }, 404);
  const current = isObject(rows[0].metadata) ? rows[0].metadata as JsonRecord : {};
  if (!['AUTONOMOUS_EVIDENCE_READY','INTELLIGENCE_BLOCKED'].includes(String(current.adapter_stage ?? ''))) return json({ error: 'request is not ready for intelligence handoff', adapter_stage: current.adapter_stage ?? null }, 409);
  const nextStage = assessment.ready ? 'INTELLIGENCE_READY' : 'INTELLIGENCE_BLOCKED';
  const handoff = isObject(body) ? body as unknown as IntelligenceHandoff : null;
  const metadata = { ...current, intelligence_handoff: handoff, intelligence_assessment: assessment, intelligence_received_at: new Date().toISOString(), adapter_stage: nextStage };
  await sql`update analysis_requests set metadata=${JSON.stringify(metadata)}::jsonb,updated_at=now() where request_id=${requestId}`;
  return json({ ok: assessment.ready, request_id: requestId, adapter_stage: nextStage, degraded: assessment.degraded, blockers: assessment.errors, next_step: assessment.ready ? 'NORMALIZE_INTELLIGENCE' : 'RETRY_INTELLIGENCE' }, assessment.ready ? 200 : 409);
}

async function saveNormalizedEvidence(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured' }, 503);
  let body: unknown; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const errors = validateNormalizedEvidence(body); if (errors.length) return json({ error: 'Normalized evidence validation failed', details: errors }, 422);
  const payload = body as JsonRecord, evidence = payload.evidence as unknown[], assessment = assessCompleteness(evidence), executable = assessment.missing.length === 0 && assessment.conflicts.length === 0;
  const sql = neon(env.DATABASE_URL), rows = await sql`select request_id,status,metadata from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
  if (!rows.length) return json({ error: 'request_id not found' }, 404);
  const current = isObject(rows[0].metadata) ? rows[0].metadata as JsonRecord : {};
  if (current.adapter_stage !== 'INTELLIGENCE_READY' && current.adapter_stage !== 'NORMALIZATION_BLOCKED') return json({ error: 'validated intelligence is not ready for normalization', adapter_stage: current.adapter_stage ?? null }, 409);
  const handoff = isObject(current.intelligence_handoff) ? current.intelligence_handoff as JsonRecord : null;
  if (!handoff || !isObject(handoff.normalized)) return json({ error: 'validated intelligence handoff is missing normalized inputs' }, 409);
  const supplied = new Map<string, string>();
  for (const item of evidence) if (isObject(item) && isObject(item.normalized)) for (const [key, value] of Object.entries(item.normalized)) supplied.set(key, JSON.stringify(value));
  const mismatches = Object.entries(handoff.normalized).filter(([key, value]) => supplied.has(key) && supplied.get(key) !== JSON.stringify(value)).map(([key]) => key);
  if (mismatches.length) return json({ error: 'normalized evidence conflicts with validated intelligence handoff', conflicts: mismatches }, 409);
  const metadata = { ...current, normalized_evidence: evidence, normalized_at: new Date().toISOString(), normalization_assessment: assessment, adapter_stage: executable ? 'NORMALIZED_READY' : 'NORMALIZATION_BLOCKED' };
  await sql`update analysis_requests set metadata=${JSON.stringify(metadata)}::jsonb,error=null,updated_at=now() where request_id=${requestId}`;
  return json({ ok: executable, request_id: requestId, adapter_stage: metadata.adapter_stage, blockers: assessment, next_step: executable ? 'EXECUTE_5DR' : 'RETRY_NORMALIZATION' }, executable ? 200 : 409);
}

async function executionPacket(env: Env, requestId: string): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured' }, 503);
  const sql = neon(env.DATABASE_URL), rows = await sql`select request_id,provenance_mode,framework_version,output_contract_version,status,metadata from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
  if (!rows.length) return json({ error: 'request_id not found' }, 404);
  const metadata = isObject(rows[0].metadata) ? rows[0].metadata as JsonRecord : {};
  if (metadata.adapter_stage !== 'NORMALIZED_READY' || !Array.isArray(metadata.normalized_evidence) || !metadata.normalized_evidence.length) return json({ error: 'request is not normalization-ready', blockers: metadata.normalization_assessment ?? null }, 409);
  return json({ request_id: String(rows[0].request_id), provenance_mode: String(rows[0].provenance_mode), framework_version: String(rows[0].framework_version), output_contract_version: String(rows[0].output_contract_version), evidence: metadata.normalized_evidence });
}

async function failRequest(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured' }, 503);
  let body: unknown = {}; try { body = await request.json(); } catch {}
  const detail = isObject(body) && isNonEmptyString(body.error) ? body.error.slice(0, 2000) : '5DR execution failed';
  const sql = neon(env.DATABASE_URL), rows = await sql`select request_id,status from analysis_requests where request_id=${requestId} and engine='5DR' limit 1`;
  if (!rows.length) return json({ error: 'request_id not found' }, 404);
  if (String(rows[0].status) === 'COMPLETED') return json({ error: 'completed request cannot be failed' }, 409);
  await sql`update analysis_requests set status='FAILED',error=${JSON.stringify({ stage: 'EXECUTION', detail })}::jsonb,updated_at=now() where request_id=${requestId}`;
  return json({ ok: true, request_id: requestId, status: 'FAILED' });
}

export default { async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/5dr/run-requests' && request.method === 'POST') return createScreenshotReadyRequest(request, env);
  const autonomous = url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/autonomous-evidence$/); if (autonomous && request.method === 'POST') return saveAutonomousEvidence(request, env, decodeURIComponent(autonomous[1]));
  const intelligence = url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/intelligence$/); if (intelligence && request.method === 'POST') return saveIntelligenceHandoff(request, env, decodeURIComponent(intelligence[1]));
  const normalized = url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/normalized$/); if (normalized && request.method === 'POST') return saveNormalizedEvidence(request, env, decodeURIComponent(normalized[1]));
  const packet = url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/execution-packet$/); if (packet && request.method === 'GET') return executionPacket(env, decodeURIComponent(packet[1]));
  const failed = url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/fail$/); if (failed && request.method === 'POST') return failRequest(request, env, decodeURIComponent(failed[1]));
  return app.fetch(request, env);
}};
