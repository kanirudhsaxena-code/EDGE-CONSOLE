import { neon } from '@neondatabase/serverless';
import { isAccessIdentityEnforced, resolveAccessActor, type AccessIdentityEnv } from './access-identity';

type Env = AccessIdentityEnv & {
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

function positiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function validIsoDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * IPO P0-12 adapter for the common /api/canonical-history contract.
 * T2_FINAL_DAY is the governed canonical efficacy checkpoint. Earlier checkpoints
 * remain immutable audit history but are never promoted into canonical efficacy.
 */
export async function handleP0IpoCanonicalHistoryRead(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.pathname !== '/api/canonical-history') return null;

  const engine = (url.searchParams.get('engine') || '').trim().toUpperCase();
  if (engine !== 'IPO_EDGE' && engine !== 'IPO') return null;

  const denied = await ownerOnly(request, env);
  if (denied) return denied;

  if (!env.IPO_DATABASE_URL) {
    return json({
      engine: 'IPO_EDGE',
      error: 'IPO canonical database is not configured on the Console read gateway',
      retrieval: retrieval({ exact_persisted_selection: false }),
    }, 503);
  }

  const checkpointId = positiveInteger(url.searchParams.get('checkpoint_id'));
  const ipoIdInput = positiveInteger(url.searchParams.get('ipo_id'));
  const company = (url.searchParams.get('company') || '').trim() || null;
  const issueCloseDate = url.searchParams.get('issue_close_date');

  if (issueCloseDate && !validIsoDate(issueCloseDate)) {
    return json({ engine: 'IPO_EDGE', error: 'Invalid issue_close_date; expected YYYY-MM-DD', retrieval: retrieval() }, 422);
  }
  if (!checkpointId && !ipoIdInput && !company) {
    return json({
      engine: 'IPO_EDGE',
      error: 'IPO_EDGE requires checkpoint_id, ipo_id, or company (optionally with issue_close_date)',
      retrieval: retrieval({ exact_persisted_selection: false }),
    }, 422);
  }

  const sql = neon(env.IPO_DATABASE_URL);
  let ipoId: number | null = ipoIdInput;

  if (checkpointId) {
    const rows = await sql`
      select to_jsonb(c) as checkpoint,to_jsonb(i) as ipo
        from checkpoints c
        join ipos i on i.ipo_id=c.ipo_id
       where c.checkpoint_id=${checkpointId}
       limit 1
    `;
    if (!rows.length) {
      return json({ engine: 'IPO_EDGE', canonical: null, error: 'Checkpoint not found', retrieval: retrieval() }, 404);
    }
    const row = rows[0] as JsonRecord;
    const checkpoint = row.checkpoint as JsonRecord;
    const ipo = row.ipo as JsonRecord;
    ipoId = Number(ipo.ipo_id);

    if (checkpoint.checkpoint_type !== 'T2_FINAL_DAY') {
      return json({
        engine: 'IPO_EDGE',
        canonical: null,
        audit_checkpoint: row,
        status: 'NON_CANONICAL_CHECKPOINT',
        presentation: { status: 'NOT_APPLICABLE_NON_CANONICAL', snapshot: null },
        retrieval: retrieval({
          exact_persisted_selection: false,
          exact_checkpoint_identity: checkpointId,
          selected_for_headline_efficacy: false,
          note: 'Only T2_FINAL_DAY is the governed IPO canonical efficacy checkpoint. Earlier checkpoints remain audit history.',
        }),
      });
    }
  } else if (!ipoId && company) {
    const ipoRows = issueCloseDate
      ? await sql`
          select * from ipos
           where lower(company_name)=lower(${company})
             and issue_close_date=${issueCloseDate}
           order by ipo_id desc
        `
      : await sql`
          select * from ipos
           where lower(company_name)=lower(${company})
           order by issue_open_date desc nulls last,ipo_id desc
        `;
    if (!ipoRows.length) {
      return json({ engine: 'IPO_EDGE', canonical: null, error: 'IPO not found', retrieval: retrieval() }, 404);
    }
    if (ipoRows.length > 1) {
      return json({
        engine: 'IPO_EDGE',
        error: 'Ambiguous IPO identity; specify issue_close_date or ipo_id',
        candidates: ipoRows.map((row: JsonRecord) => ({
          ipo_id: row.ipo_id,
          company_name: row.company_name,
          issue_open_date: row.issue_open_date,
          issue_close_date: row.issue_close_date,
          listing_date: row.listing_date,
          status: row.status,
        })),
        retrieval: retrieval({ exact_persisted_selection: false }),
      }, 409);
    }
    ipoId = Number((ipoRows[0] as JsonRecord).ipo_id);
  }

  if (!ipoId) {
    return json({ engine: 'IPO_EDGE', error: 'Unable to resolve IPO identity', retrieval: retrieval() }, 422);
  }

  const ipoRows = await sql`select * from ipos where ipo_id=${ipoId} limit 1`;
  if (!ipoRows.length) {
    return json({ engine: 'IPO_EDGE', canonical: null, error: 'IPO not found', retrieval: retrieval() }, 404);
  }

  const canonicalRows = checkpointId
    ? await sql`
        select * from checkpoints
         where checkpoint_id=${checkpointId}
           and ipo_id=${ipoId}
           and checkpoint_type='T2_FINAL_DAY'
         limit 1
      `
    : await sql`
        select * from checkpoints
         where ipo_id=${ipoId}
           and checkpoint_type='T2_FINAL_DAY'
         order by checkpoint_time desc,checkpoint_id desc
      `;

  if (!canonicalRows.length) {
    const auditRows = await sql`
      select * from checkpoints
       where ipo_id=${ipoId}
       order by checkpoint_time desc,checkpoint_id desc
    `;
    return json({
      engine: 'IPO_EDGE',
      ipo: ipoRows[0],
      canonical: null,
      status: 'NO_FINAL_CANONICAL_YET',
      audit_checkpoints: auditRows,
      presentation: { status: 'NOT_AVAILABLE_UNTIL_P0_11', snapshot: null },
      retrieval: retrieval({
        exact_persisted_selection: true,
        selected_for_headline_efficacy: false,
        note: 'No T2_FINAL_DAY canonical exists. Earlier checkpoints are not substituted as the canonical.',
      }),
    });
  }

  if (canonicalRows.length > 1 && !checkpointId) {
    return json({
      engine: 'IPO_EDGE',
      ipo: ipoRows[0],
      error: 'Multiple T2_FINAL_DAY checkpoints exist; exact checkpoint_id is required',
      candidates: canonicalRows,
      retrieval: retrieval({ exact_persisted_selection: false }),
    }, 409);
  }

  const canonical = canonicalRows[0] as JsonRecord;
  const canonicalId = Number(canonical.checkpoint_id);

  const checkpoints = await sql`
    select * from checkpoints
     where ipo_id=${ipoId}
     order by checkpoint_time,checkpoint_id
  `;
  const evidence = await sql`
    select * from research_evidence
     where ipo_id=${ipoId}
     order by retrieved_at,evidence_id
  `;
  const canonicalEvidence = await sql`
    select * from research_evidence
     where ipo_id=${ipoId}
       and checkpoint_id=${canonicalId}
     order by research_block,evidence_id
  `;
  const subscriptions = await sql`
    select * from subscription_snapshots
     where ipo_id=${ipoId}
     order by captured_at,snapshot_id
  `;
  const sentiment = await sql`
    select * from market_sentiment_snapshots
     where ipo_id=${ipoId}
     order by captured_at,snapshot_id
  `;
  const outcomeRows = await sql`
    select * from listing_outcomes
     where ipo_id=${ipoId}
     limit 1
  `;
  const assessmentRows = await sql`
    select * from assessments
     where ipo_id=${ipoId}
     limit 1
  `;
  const receipts = await sql`
    select * from runtime_receipts
     where ipo_id=${ipoId}
     order by created_at,event_key
  `;
  const learnings = await sql`
    select * from learnings
     where origin_ipo_id=${ipoId}
     order by created_at,learning_id
  `;

  return json({
    engine: 'IPO_EDGE',
    ipo: ipoRows[0],
    canonical,
    checkpoint_lineage: checkpoints,
    canonical_research_evidence: canonicalEvidence,
    research_evidence_lineage: evidence,
    subscription_snapshots: subscriptions,
    market_sentiment_snapshots: sentiment,
    listing_outcome: outcomeRows[0] ?? null,
    assessment: assessmentRows[0] ?? null,
    runtime_receipts: receipts,
    learnings,
    core_shadow: { status: 'NOT_APPLICABLE_IPO_ENGINE', record: null },
    presentation: { status: 'NOT_AVAILABLE_UNTIL_P0_11', snapshot: null },
    completeness: {
      canonical_selection: true,
      canonical_checkpoint: true,
      checkpoint_lineage: checkpoints.length > 0,
      evidence_lineage: evidence.length > 0,
      canonical_evidence: canonicalEvidence.length > 0,
      subscription_history: subscriptions.length > 0,
      sentiment_history: sentiment.length > 0,
      listing_outcome: outcomeRows.length > 0,
      assessment: assessmentRows.length > 0,
      runtime_receipts: receipts.length > 0,
      presentation_snapshot: false,
    },
    retrieval: retrieval({
      exact_persisted_selection: true,
      exact_checkpoint_identity: canonicalId,
      exact_ipo_identity: ipoId,
      selected_for_headline_efficacy: true,
      canonical_rule: 'T2_FINAL_DAY',
      canonical_store_binding: 'IPO_DATABASE_URL',
    }),
  });
}
