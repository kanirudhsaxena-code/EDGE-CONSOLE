import { neon } from '@neondatabase/serverless';
import { resolveAccessActor, type AccessIdentityEnv } from './access-identity';

export type LearningGovernanceEnv = AccessIdentityEnv & {
  DATABASE_URL?: string;
};

type JsonRecord = Record<string, unknown>;

export const LEARNING_STALE_AFTER_MS = 36 * 60 * 60_000;
export const LEARNING_FUTURE_SKEW_MS = 5 * 60_000;
export const LEARNING_DECISION_ACTIONS = ['APPROVE', 'REJECT', 'DEFER'] as const;
export type LearningDecisionAction = typeof LEARNING_DECISION_ACTIONS[number];

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'private, no-store',
  },
});

const isObject = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function decisionTargetStatus(action: LearningDecisionAction): 'APPROVED_FOR_BUILD' | 'REJECTED' | 'DEFERRED' {
  if (action === 'APPROVE') return 'APPROVED_FOR_BUILD';
  if (action === 'REJECT') return 'REJECTED';
  return 'DEFERRED';
}

export function learningPresentationState(snapshot: JsonRecord | null, nowMs = Date.now()) {
  if (!snapshot) {
    return {
      state: 'FAILED' as const,
      reason: 'NO_SNAPSHOT',
      age_seconds: null,
      stale_after_seconds: Math.floor(LEARNING_STALE_AFTER_MS / 1000),
    };
  }

  const asOf = String(snapshot.as_of ?? '');
  const asOfMs = Date.parse(asOf);
  if (!asOf || Number.isNaN(asOfMs)) {
    return {
      state: 'FAILED' as const,
      reason: 'INVALID_AS_OF',
      age_seconds: null,
      stale_after_seconds: Math.floor(LEARNING_STALE_AFTER_MS / 1000),
    };
  }

  const ageMs = nowMs - asOfMs;
  const ageSeconds = Math.floor(ageMs / 1000);
  if (ageMs < -LEARNING_FUTURE_SKEW_MS) {
    return {
      state: 'FAILED' as const,
      reason: 'FUTURE_SNAPSHOT',
      age_seconds: ageSeconds,
      stale_after_seconds: Math.floor(LEARNING_STALE_AFTER_MS / 1000),
    };
  }

  const snapshotStatus = String(snapshot.snapshot_status ?? '').toUpperCase();
  const quality = String(snapshot.data_quality_state ?? '').toUpperCase();
  if (/FAIL|ERROR|BLOCK|INVALID/.test(quality)) {
    return {
      state: 'FAILED' as const,
      reason: 'DATA_QUALITY_FAILURE',
      age_seconds: ageSeconds,
      stale_after_seconds: Math.floor(LEARNING_STALE_AFTER_MS / 1000),
    };
  }

  if (ageMs > LEARNING_STALE_AFTER_MS) {
    return {
      state: 'STALE' as const,
      reason: 'SNAPSHOT_TOO_OLD',
      age_seconds: ageSeconds,
      stale_after_seconds: Math.floor(LEARNING_STALE_AFTER_MS / 1000),
    };
  }

  if (snapshotStatus === 'PARTIAL' || /PARTIAL|DEGRADED|GAP/.test(quality)) {
    return {
      state: 'PARTIAL' as const,
      reason: snapshotStatus === 'PARTIAL' ? 'PARTIAL_SNAPSHOT' : 'DATA_QUALITY_DEGRADED',
      age_seconds: ageSeconds,
      stale_after_seconds: Math.floor(LEARNING_STALE_AFTER_MS / 1000),
    };
  }

  return {
    state: 'LIVE' as const,
    reason: 'CURRENT_COMPLETE_SNAPSHOT',
    age_seconds: ageSeconds,
    stale_after_seconds: Math.floor(LEARNING_STALE_AFTER_MS / 1000),
  };
}

export function validateLearningDecision(body: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(body)) return ['body must be an object'];
  if (!nonEmpty(body.candidate_id)) errors.push('candidate_id is mandatory');
  if (!LEARNING_DECISION_ACTIONS.includes(String(body.action) as LearningDecisionAction)) {
    errors.push('action must be APPROVE, REJECT or DEFER');
  }
  if (body.decision_context !== undefined && !isObject(body.decision_context)) {
    errors.push('decision_context must be an object when supplied');
  }
  if (body.note !== undefined && typeof body.note !== 'string') {
    errors.push('note must be a string when supplied');
  }
  return errors;
}

async function governanceView(request: Request, env: LearningGovernanceEnv): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured' }, 503);
  const url = new URL(request.url);
  const engine = url.searchParams.get('engine') || '5DR';
  if (!['5DR', 'EDGE_STOCKS'].includes(engine)) return json({ error: 'engine must be 5DR or EDGE_STOCKS' }, 422);

  const sql = neon(env.DATABASE_URL);
  const snapshots = await sql`
    select *
    from learning_daily_snapshots_vnext
    where engine=${engine}
    order by as_of desc, id desc
    limit 1
  `;
  const snapshot = snapshots[0] ?? null;
  const candidates = await sql`
    select candidate_id,hypothesis_id,status,proposal,baseline_metrics,challenger_metrics,validation_state,content_hash,created_at
    from learning_candidates_vnext
    where engine=${engine} and status='PENDING_USER_APPROVAL'
    order by created_at desc
    limit 20
  `;
  const decisions = await sql`
    select e.approval_event_id,e.candidate_id,e.action,e.prior_status,e.new_status,e.decided_by,e.decided_at,e.decision_context
    from learning_approval_events_vnext e
    join learning_candidates_vnext c on c.candidate_id=e.candidate_id
    where c.engine=${engine}
    order by e.decided_at desc, e.id desc
    limit 20
  `;

  return json({
    engine,
    snapshot,
    presentation_state: learningPresentationState(snapshot as JsonRecord | null),
    candidates,
    recent_decisions: decisions,
    governance: {
      approval_scope: 'BUILD_VALIDATION_ONLY',
      automatic_adoption: false,
      production_change_allowed: false,
      production_promotion_requires_separate_explicit_approval: true,
    },
  });
}

async function decideCandidate(request: Request, env: LearningGovernanceEnv): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured' }, 503);

  const actor = await resolveAccessActor(request, env);
  if (!actor.authenticated || actor.role !== 'OWNER') {
    return json({
      error: 'Owner authentication is required for Learning Lab governance decisions',
      code: 'LEARNING_GOVERNANCE_OWNER_REQUIRED',
    }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const errors = validateLearningDecision(body);
  if (errors.length) return json({ error: 'Learning governance decision validation failed', details: errors }, 422);
  const payload = body as JsonRecord;
  const candidateId = String(payload.candidate_id);
  const action = String(payload.action) as LearningDecisionAction;
  const targetStatus = decisionTargetStatus(action);
  const note = typeof payload.note === 'string' ? payload.note.trim().slice(0, 2000) : '';
  const suppliedContext = isObject(payload.decision_context) ? payload.decision_context : {};
  const sql = neon(env.DATABASE_URL);

  const candidates = await sql`
    select candidate_id,status,content_hash
    from learning_candidates_vnext
    where candidate_id=${candidateId}
    limit 1
  `;
  if (!candidates.length) return json({ error: 'Learning candidate not found', candidate_id: candidateId }, 404);

  const candidate = candidates[0] as JsonRecord;
  if (String(candidate.status) !== 'PENDING_USER_APPROVAL') {
    return json({
      error: 'Candidate is no longer pending user approval',
      candidate_id: candidateId,
      current_status: candidate.status,
    }, 409);
  }

  const candidateHash = String(candidate.content_hash);
  const approvalEventId = `approval_${crypto.randomUUID()}`;
  const decidedAt = new Date().toISOString();
  const decisionContext = {
    ...suppliedContext,
    note: note || undefined,
    actor_role: actor.role,
    approval_scope: 'BUILD_VALIDATION_ONLY',
    production_change_allowed: false,
    production_promotion_authorized: false,
  };

  const rows = await sql`
    with updated as (
      update learning_candidates_vnext
      set status=${targetStatus}
      where candidate_id=${candidateId}
        and status='PENDING_USER_APPROVAL'
        and content_hash=${candidateHash}
      returning candidate_id,content_hash,status
    )
    insert into learning_approval_events_vnext(
      approval_event_id,candidate_id,candidate_hash,action,prior_status,new_status,
      decided_by,decided_at,decision_context
    )
    select
      ${approvalEventId},candidate_id,content_hash,${action},'PENDING_USER_APPROVAL',${targetStatus},
      ${actor.id},${decidedAt}::timestamptz,${JSON.stringify(decisionContext)}::jsonb
    from updated
    returning approval_event_id,candidate_id,action,new_status,decided_by,decided_at,decision_context
  `;

  if (!rows.length) {
    return json({
      error: 'Candidate governance state changed before the decision could be recorded',
      candidate_id: candidateId,
    }, 409);
  }

  return json({
    ok: true,
    decision: rows[0],
    candidate_id: candidateId,
    candidate_status: targetStatus,
    build_validation_authorized: action === 'APPROVE',
    production_change_allowed: false,
    production_promotion_authorized: false,
    next_step: action === 'APPROVE'
      ? 'Build and validate the approved challenger without changing production rules.'
      : 'No production or build promotion is authorized by this decision.',
  }, 201);
}

export async function handleLearningGovernanceRequest(request: Request, env: LearningGovernanceEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/learning-lab/governance-view' && request.method === 'GET') {
    return governanceView(request, env);
  }
  if (url.pathname === '/api/learning-lab/candidate-decision' && request.method === 'POST') {
    return decideCandidate(request, env);
  }
  return json({ error: 'Not found' }, 404);
}
