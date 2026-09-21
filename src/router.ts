import { neon } from '@neondatabase/serverless';
import app from './index';
import { assessCompleteness, isNonEmptyString, isObject, validateNormalizedEvidence, type JsonRecord } from './normalization';
import { assessEvidenceReadiness, REQUIRED_5DR_EVIDENCE_CATEGORIES } from './evidence-readiness';
import { componentVerificationStatus, validateEdgeStocksResult } from './edge-stocks';
import { checkEdgeWorkflowAccess, dispatchEdgeWorkflow, normalizeTickerCandidate, parseEdgeCommand } from './edge-command';
import { EDGE_RESEARCH_BUNDLE_VERSION, researchBundleCanPublish, validateEdgeResearchBundle } from './edge-research';
import { actorCanUseCanonicalEdge, isAccessIdentityEnforced, resolveAccessActor, type AccessIdentityEnv } from './access-identity';

type Env = AccessIdentityEnv & {
  ASSETS: Fetcher;
  EVIDENCE_BUCKET: R2Bucket;
  DATABASE_URL?: string;
  EDGE_DATABASE_URL?: string;
  EDGE_GITHUB_TOKEN?: string;
  APP_ENV: string;
  OUTPUT_CONTRACT_VERSION: string;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' }
});

const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const integerOrZero = (value: unknown): number => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

async function testerEdgeSandboxGate(request:Request,env:Env):Promise<Response|null>{
  if(!isAccessIdentityEnforced(env))return null;
  const actor=await resolveAccessActor(request,env);
  if(!actor.authenticated)return json({error:'Authenticated Console identity is required'},401);
  if(actorCanUseCanonicalEdge(actor,env))return null;
  return json({
    error:'EDGE Stocks tester sandbox is not enabled yet',
    code:'EDGE_TESTER_SANDBOX_NOT_READY',
    detail:'Tester access is blocked from the canonical EDGE Stocks ledger until isolated sandbox persistence is available.'
  },403);
}

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('');
};

async function persistEdgeResearchBundle(env: Env, body: unknown, expectedTicker?: string): Promise<{ bundleId?: string; error?: string; status?: number }> {
  if (!env.EDGE_DATABASE_URL) return { error: 'EDGE database is not configured', status: 503 };
  const assessment = researchBundleCanPublish(body);
  if (!assessment.ready || !isObject(body)) return { error: 'EDGE research bundle validation failed: ' + assessment.errors.join('; '), status: 422 };
  const ticker = String(body.ticker).toUpperCase();
  if (expectedTicker && ticker !== expectedTicker.toUpperCase()) return { error: 'research bundle ticker does not match resolved EDGE ticker', status: 422 };
  const bundleId = String(body.bundle_id);
  const payloadText = JSON.stringify(body);
  const payloadHash = await sha256Hex(payloadText);
  const sql = neon(env.EDGE_DATABASE_URL);
  const existing = await sql`select payload_hash from edge_research_bundles where bundle_id=${bundleId} limit 1`;
  if (existing.length) {
    if (String(existing[0].payload_hash) !== payloadHash) return { error: 'research bundle_id already exists with different immutable content', status: 409 };
    return { bundleId };
  }
  await sql`
    insert into edge_research_bundles(
      bundle_id,ticker,contract_version,research_authority,research_fresh_at,created_at,payload,payload_hash,status
    ) values(
      ${bundleId},${ticker},${EDGE_RESEARCH_BUNDLE_VERSION},'CHATGPT',
      ${String(body.research_fresh_at)},${String(body.created_at)},
      ${payloadText}::jsonb,${payloadHash},'READY'
    )
  `;
  return { bundleId };
}

async function saveEdgeResearchBundle(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const errors = validateEdgeResearchBundle(body);
  if (errors.length) return json({ error: 'EDGE research bundle validation failed', details: errors }, 422);
  const saved = await persistEdgeResearchBundle(env, body);
  if (!saved.bundleId) return json({ error: saved.error }, saved.status ?? 422);
  return json({ ok: true, status: 'READY', contract_version: EDGE_RESEARCH_BUNDLE_VERSION, bundle_id: saved.bundleId });
}

async function getEdgeResearchBundle(env: Env, bundleId: string): Promise<Response> {
  if (!env.EDGE_DATABASE_URL) return json({ error: 'EDGE database is not configured' }, 503);
  if (!/^[A-Za-z0-9._:-]{3,160}$/.test(bundleId)) return json({ error: 'Invalid research bundle id' }, 422);
  const sql = neon(env.EDGE_DATABASE_URL);
  const rows = await sql`select bundle_id,ticker,contract_version,research_authority,research_fresh_at,created_at,payload_hash,status,payload,inserted_at from edge_research_bundles where bundle_id=${bundleId} limit 1`;
  if (!rows.length) return json({ error: 'Research bundle not found' }, 404);
  return json({ research_bundle: rows[0] });
}

async function readinessGate(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try { body = await request.clone().json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!isObject(body)) return json({ error: 'request body must be a JSON object' }, 422);
  const assessment = assessEvidenceReadiness(body.evidence_categories);
  if (assessment.invalid.length) return json({ error: 'Unknown 5DR evidence categories', invalid_categories: assessment.invalid, required_categories: REQUIRED_5DR_EVIDENCE_CATEGORIES }, 422);
  if (!assessment.ready) return json({ error: '5DR evidence readiness gate blocked', missing_categories: assessment.missing, required_categories: REQUIRED_5DR_EVIDENCE_CATEGORIES }, 409);
  return app.fetch(request, env);
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


async function fiveDrCanonicalHandoff(env: Env): Promise<Response> {
  if (!env.DATABASE_URL) return json({ error: 'Database is not configured', code: 'DATABASE_NOT_CONFIGURED' }, 503);
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`
    select ar.run_id,ar.generated_at,ar.freshness_at,ar.framework_version,ar.contract_version,
           ar.status,ar.provenance_mode,ar.published,ar.result,
           req.request_id,req.provenance_mode as request_provenance_mode,req.metadata
      from analysis_runs ar
      left join lateral (
        select request_id,provenance_mode,metadata
          from analysis_requests
         where engine='5DR' and run_id=ar.run_id
         order by updated_at desc
         limit 1
      ) req on true
     where ar.engine='5DR' and ar.published=true
     order by ar.generated_at desc
     limit 20
  `;
  const runs = rows.map((row:any) => {
    const metadata = isObject(row.metadata) ? row.metadata as JsonRecord : {};
    const intelligence = isObject(metadata.intelligence_handoff) ? metadata.intelligence_handoff as JsonRecord : {};
    const normalized = isObject(intelligence.normalized) ? intelligence.normalized : null;
    const market = isObject(metadata.automated_market_evidence) ? metadata.automated_market_evidence : {};
    return {
      run: {
        run_id: row.run_id,
        generated_at: row.generated_at,
        freshness_at: row.freshness_at,
        framework_version: row.framework_version,
        contract_version: row.contract_version,
        status: row.status,
        provenance_mode: row.provenance_mode,
        published: row.published === true,
        result: row.result,
      },
      request: {
        request_id: row.request_id ?? null,
        provenance_mode: row.request_provenance_mode ?? null,
        metadata: {
          intelligence_handoff: normalized ? { normalized } : {},
          automated_market_evidence: market,
          invocation: isObject(metadata.invocation) ? metadata.invocation : {},
          canonical_attempt: isObject(metadata.canonical_attempt) ? metadata.canonical_attempt : null,
        },
      },
    };
  });
  return json({
    schema_version: '5DR_CONSOLE_HANDOFF_V1',
    generated_at: new Date().toISOString(),
    source: 'EDGE_CONSOLE_PUBLISHED_RUNS',
    runs,
  });
}

async function edgeStocksDispatchHealth(env: Env): Promise<Response> {
  const result = await checkEdgeWorkflowAccess(env.EDGE_GITHUB_TOKEN ?? '');
  return json({
    ok: result.ok,
    status: result.ok ? 'READY' : 'BLOCKED',
    engine: 'EDGE_STOCKS',
    workflow: 'autonomous-publish.yml',
    trading_enabled: false,
    error: result.error ?? null,
  }, result.ok ? 200 : (result.status === 401 || result.status === 403 ? 502 : result.status));
}

async function resolveEdgeTicker(env: Env, target: string): Promise<{ ticker?: string; error?: string; status?: number }> {
  const direct = normalizeTickerCandidate(target);
  if (direct) return { ticker: direct };
  if (!env.EDGE_DATABASE_URL) {
    return { error: 'Company-name resolution requires the EDGE database; use an NSE ticker symbol', status: 422 };
  }
  const sql = neon(env.EDGE_DATABASE_URL);
  const rows = await sql`
    select distinct ticker, company_name
      from recommendations
     where company_name is not null
       and lower(trim(company_name)) = lower(trim(${target}))
     order by ticker
     limit 3
  `;
  if (!rows.length) return { error: 'Company name not found in governed EDGE history; use the exact NSE ticker', status: 404 };
  if (rows.length > 1) return { error: 'Company name is ambiguous; use the exact NSE ticker', status: 409 };
  return { ticker: String(rows[0].ticker).toUpperCase() };
}

async function latestEdgeRecommendation(env: Env, ticker: string): Promise<{ id: string; runTimestamp: unknown } | null> {
  if (!env.EDGE_DATABASE_URL) return null;
  const sql = neon(env.EDGE_DATABASE_URL);
  const rows = await sql`
    select recommendation_id, run_timestamp
      from recommendations
     where ticker = ${ticker}
     order by run_timestamp desc
     limit 1
  `;
  return rows.length ? { id: String(rows[0].recommendation_id), runTimestamp: rows[0].run_timestamp } : null;
}

async function latestFreshEdgeResearchBundle(env: Env, ticker: string, maxAgeMinutes = 24 * 60): Promise<{ bundleId: string; researchFreshAt: unknown } | null> {
  if (!env.EDGE_DATABASE_URL) return null;
  const sql = neon(env.EDGE_DATABASE_URL);
  const cutoff = new Date(Date.now() - Math.max(1, maxAgeMinutes) * 60_000).toISOString();
  const rows = await sql`
    select bundle_id,payload,research_fresh_at
      from edge_research_bundles
     where ticker = ${ticker}
       and status = 'READY'
       and research_fresh_at >= ${cutoff}
     order by research_fresh_at desc, inserted_at desc
     limit 10
  `;
  for (const row of rows) {
    const payload = row.payload;
    if (researchBundleCanPublish(payload).ready) return { bundleId: String(row.bundle_id), researchFreshAt: row.research_fresh_at };
  }
  return null;
}

async function todaysAutonomousRecommendation(env: Env, ticker: string): Promise<{ id: string; runTimestamp: unknown } | null> {
  if (!env.EDGE_DATABASE_URL) return null;
  const sql = neon(env.EDGE_DATABASE_URL);
  const pattern = `EDGE-${ticker}-%-AUTO`;
  const rows = await sql`
    select recommendation_id, run_timestamp
      from recommendations
     where ticker = ${ticker}
       and recommendation_id like ${pattern}
       and (run_timestamp at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date
     order by run_timestamp desc
     limit 1
  `;
  return rows.length ? { id: String(rows[0].recommendation_id), runTimestamp: rows[0].run_timestamp } : null;
}

async function invokeEdgeStocks(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!isObject(body)) return json({ error: 'request body must be a JSON object' }, 422);
  const command = parseEdgeCommand(body.command);
  if (!command) return json({ error: 'Command must be in the form EDGE <stock/company/ticker>' }, 422);

  const resolved = await resolveEdgeTicker(env, command.target);
  if (!resolved.ticker) return json({ error: resolved.error }, resolved.status ?? 422);
  const ticker = resolved.ticker;

  const forceNew = body.force_new === true;
  const canonicalAttempt = body.canonical_attempt === true;
  const canonicalAttemptSlot = typeof body.canonical_attempt_slot === 'string' ? body.canonical_attempt_slot.trim() : null;
  const existingToday = await todaysAutonomousRecommendation(env, ticker);
  if (existingToday && !forceNew && !isObject(body.research_bundle)) {
    return json({
      ok: true,
      status: 'ALREADY_PUBLISHED_TODAY',
      engine: 'EDGE_STOCKS',
      contract_version: 'EDGE_STOCKS_V1_3',
      ticker,
      command: command.raw,
      run_id: existingToday.id,
      run_timestamp: existingToday.runTimestamp,
      report_url: `/api/edge-stocks/report?ticker=${encodeURIComponent(ticker)}`,
      trading_enabled: false
    });
  }

  let researchBundleId: string | undefined;
  if (isObject(body.research_bundle)) {
    const saved = await persistEdgeResearchBundle(env, body.research_bundle, ticker);
    if (!saved.bundleId) return json({ error: saved.error, code: 'EDGE_RESEARCH_BUNDLE_BLOCKED', ticker }, saved.status ?? 422);
    researchBundleId = saved.bundleId;
  } else if (forceNew) {
    const fresh = await latestFreshEdgeResearchBundle(env, ticker, canonicalAttempt ? 90 : 24 * 60);
    researchBundleId = fresh?.bundleId;
    if (!researchBundleId) {
      return json({
        error: canonicalAttempt
          ? 'A pre-open canonical EDGE run requires a valid ChatGPT research bundle refreshed within the last 90 minutes'
          : 'A fresh governed EDGE run was requested, but no valid ChatGPT research bundle from the last 24 hours is available for this ticker',
        code: canonicalAttempt ? 'EDGE_CANONICAL_RESEARCH_REFRESH_REQUIRED' : 'EDGE_RESEARCH_BUNDLE_REQUIRED',
        contract_version: EDGE_RESEARCH_BUNDLE_VERSION,
        ticker,
        fresh_run_requested: true,
        canonical_attempt: canonicalAttempt,
        canonical_attempt_slot: canonicalAttemptSlot
      }, 409);
    }
  } else {
    return json({
      error: 'Fresh ChatGPT research bundle is mandatory before EDGE dispatch',
      code: 'EDGE_RESEARCH_BUNDLE_REQUIRED',
      contract_version: EDGE_RESEARCH_BUNDLE_VERSION,
      ticker
    }, 409);
  }

  const baseline = await latestEdgeRecommendation(env, ticker);
  const baselineRunId = baseline?.id ?? null;
  const dispatchedAt = new Date().toISOString();
  const canonicalRequestedAt = canonicalAttempt
    ? (typeof body.canonical_requested_at === 'string' && !Number.isNaN(Date.parse(body.canonical_requested_at))
        ? new Date(body.canonical_requested_at).toISOString()
        : dispatchedAt)
    : undefined;

  const dispatch = await dispatchEdgeWorkflow(
    env.EDGE_GITHUB_TOKEN ?? '', ticker, 'UNKNOWN', researchBundleId,
    canonicalRequestedAt, canonicalAttemptSlot ?? undefined
  );
  if (!dispatch.ok) {
    return json({
      error: 'EDGE autonomous dispatch failed',
      detail: dispatch.error,
      ticker,
      research_bundle_id: researchBundleId,
      code: dispatch.status === 503 ? 'EDGE_DISPATCH_NOT_CONFIGURED' : 'EDGE_DISPATCH_FAILED',
    }, dispatch.status === 401 || dispatch.status === 403 ? 502 : dispatch.status);
  }

  return json({
    ok: true,
    status: 'DISPATCHED',
    engine: 'EDGE_STOCKS',
    contract_version: 'EDGE_STOCKS_V1_3',
    research_contract_version: EDGE_RESEARCH_BUNDLE_VERSION,
    ticker,
    command: command.raw,
    research_bundle_id: researchBundleId,
    baseline_run_id: baselineRunId,
    dispatched_at: dispatchedAt,
    fresh_run: true,
    reused_output: false,
    canonical_attempt: canonicalAttempt,
    canonical_attempt_slot: canonicalAttemptSlot,
    canonical_requested_at: canonicalRequestedAt ?? null,
    trading_enabled: false,
    next: `/api/edge-stocks/invoke/status?ticker=${encodeURIComponent(ticker)}&after=${encodeURIComponent(dispatchedAt)}`,
  }, 202);
}

async function edgeStocksCanonicalTargets(env: Env): Promise<Response> {
  if (!env.EDGE_DATABASE_URL) return json({ error: 'EDGE database is not configured', code: 'EDGE_DATABASE_NOT_CONFIGURED' }, 503);
  const sql = neon(env.EDGE_DATABASE_URL);
  const rows = await sql`
    select distinct r.ticker,r.forecast_horizon,
           max(erb.research_fresh_at) as latest_research_fresh_at
      from recommendations r
      join recommendation_lifecycle l using(recommendation_id)
      left join recommendation_research_bundle rrb using(recommendation_id)
      left join edge_research_bundles erb using(bundle_id)
     where l.status='OPEN'
     group by r.ticker,r.forecast_horizon
     order by r.ticker,r.forecast_horizon
  `;
  return json({
    canonical_targets: rows.map(row => ({
      ticker: String(row.ticker).toUpperCase(),
      forecast_horizon: String(row.forecast_horizon),
      latest_research_fresh_at: row.latest_research_fresh_at ?? null,
    })),
    selection_key: 'ticker + target_trading_date + governed_horizon',
    research_max_age_minutes: 90,
    trading_enabled: false,
  });
}

async function edgeStocksInvocationStatus(env: Env, tickerRaw: string, afterRaw: string): Promise<Response> {
  if (!env.EDGE_DATABASE_URL) return json({ error: 'EDGE database is not configured', code: 'EDGE_DATABASE_NOT_CONFIGURED' }, 503);
  const ticker = normalizeTickerCandidate(tickerRaw);
  if (!ticker) return json({ error: 'Invalid ticker' }, 422);
  if (!isNonEmptyString(afterRaw) || Number.isNaN(Date.parse(afterRaw))) return json({ error: 'after must be a valid ISO timestamp' }, 422);
  const after = new Date(afterRaw).toISOString();
  const sql = neon(env.EDGE_DATABASE_URL);
  const rows = await sql`
    select recommendation_id, run_timestamp
      from recommendations
     where ticker = ${ticker}
       and run_timestamp > ${after}
     order by run_timestamp desc
     limit 1
  `;
  if (!rows.length) {
    return json({
      status: 'RUNNING_OR_BLOCKED',
      ticker,
      after,
      trading_enabled: false,
      note: 'No newer governed recommendation is published yet. The autonomous runner may still be running or may have failed closed.',
    });
  }
  return json({
    status: 'COMPLETE',
    ticker,
    run_id: String(rows[0].recommendation_id),
    run_timestamp: rows[0].run_timestamp,
    report_url: `/api/edge-stocks/report?ticker=${encodeURIComponent(ticker)}`,
    trading_enabled: false,
  });
}

async function edgeStocksReport(env: Env, ticker: string): Promise<Response> {
  if (!env.EDGE_DATABASE_URL) return json({ error: 'EDGE database is not configured', code: 'EDGE_DATABASE_NOT_CONFIGURED' }, 503);
  const symbol = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9._&-]{1,20}$/.test(symbol)) return json({ error: 'Invalid ticker' }, 422);

  const sql = neon(env.EDGE_DATABASE_URL);
  const masterRows = await sql`select * from v_edge_master_report limit 1`;
  const stockRows = await sql`select * from v_edge_stock_report where ticker = ${symbol} limit 1`;
  if (!masterRows.length) return json({ error: 'EDGE master assessment unavailable' }, 409);
  if (!stockRows.length) return json({ error: 'Ticker not found in EDGE stock assessment', ticker: symbol }, 404);

  const activeRows = await sql`
    select r.*, l.expiry_trading_date, p.current_price, p.current_return_pct, p.outcome_verdict,
           mt.directional_agreement_score,
           coalesce(mt.market_trust_score, r.market_trust_score) as resolved_market_trust_score,
           coalesce(mt.market_trust_band, r.market_trust_band) as resolved_market_trust_band,
           coalesce(b.bot_score, r.bot_score) as resolved_bot_score,
           coalesce(b.bot_grade, r.bot_grade) as resolved_bot_grade,
           coalesce(b.decision_ladder, r.decision_ladder) as resolved_decision_ladder,
           e.instrument, e.entry_low, e.entry_high, e.stop_price, e.invalidation_text,
           e.target1, e.target2, e.time_exit, e.option_strike, e.option_expiry,
           e.observed_premium, e.option_suitability_status, e.execution_quality_score
      from recommendations r
      join recommendation_lifecycle l using (recommendation_id)
      left join recommendation_performance p using (recommendation_id)
      left join market_trust mt using (recommendation_id)
      left join bot_scores b using (recommendation_id)
      left join execution_plans e using (recommendation_id)
     where r.ticker = ${symbol}
       and l.include_in_master_metrics
       and l.status = 'OPEN'
     order by r.run_timestamp desc
     limit 1
  `;
  if (!activeRows.length) return json({ error: 'No active EDGE call found', ticker: symbol }, 404);

  const allActiveRows = await sql`
    select a.ticker,a.recommendation_id,a.definitive_forecast,a.definitive_recommendation,
           a.expected_price_zone_low,a.expected_price_zone_high,a.expiry_trading_date,
           a.current_price,a.current_return_pct,a.outcome_verdict,a.open_recommendations,
           a.bull_probability,a.base_probability,a.bear_probability,
           r.run_timestamp as call_timestamp
      from v_edge_active_calls a
      left join recommendations r on r.recommendation_id = a.recommendation_id
     order by a.ticker
  `;

  const master = masterRows[0] as Record<string, unknown>;
  const stock = stockRows[0] as Record<string, unknown>;
  const active = activeRows[0] as Record<string, unknown>;
  const parentRecommendationId = isNonEmptyString(active.parent_recommendation_id)
    ? String(active.parent_recommendation_id)
    : null;
  let previousRecommendation: Record<string, unknown> | null = null;
  if (parentRecommendationId) {
    const previousRows = await sql`
      select r.recommendation_id,r.run_timestamp,r.definitive_forecast,r.definitive_recommendation,
             r.expected_price_zone_low,r.expected_price_zone_high,
             l.status as lifecycle_status,l.expiry_trading_date,
             p.current_price,p.current_return_pct,p.outcome_verdict,p.last_assessed_at
        from recommendations r
        left join recommendation_lifecycle l using (recommendation_id)
        left join recommendation_performance p using (recommendation_id)
       where r.recommendation_id = ${parentRecommendationId}
       limit 1
    `;
    if (previousRows.length) {
      const previous = previousRows[0] as Record<string, unknown>;
      previousRecommendation = {
        recommendation_id: String(previous.recommendation_id),
        run_timestamp: previous.run_timestamp ?? null,
        definitive_forecast: previous.definitive_forecast ?? null,
        definitive_recommendation: previous.definitive_recommendation ?? null,
        expected_price_zone: {
          low: numberOrNull(previous.expected_price_zone_low),
          high: numberOrNull(previous.expected_price_zone_high),
        },
        lifecycle_status: previous.lifecycle_status ?? null,
        expiry_trading_date: previous.expiry_trading_date ?? null,
        current_price: numberOrNull(previous.current_price),
        current_return_pct: numberOrNull(previous.current_return_pct),
        outcome_verdict: previous.outcome_verdict ?? 'OPEN',
        last_assessed_at: previous.last_assessed_at ?? null,
      };
    }
  }
  const componentRows = await sql`
    select component, raw_score, evidence_quality, availability_status, conflict_flag, notes
      from component_scores
     where recommendation_id = ${String(active.recommendation_id)}
     order by component
  `;
  const researchRows = await sql`
    select erb.payload
      from recommendation_research_bundle rrb
      join edge_research_bundles erb using (bundle_id)
     where rrb.recommendation_id = ${String(active.recommendation_id)}
     order by rrb.linked_at desc
     limit 1
  `;
  const researchPayload = researchRows.length && isObject(researchRows[0].payload)
    ? researchRows[0].payload as Record<string, unknown>
    : {};
  const researchClaims = Array.isArray(researchPayload.claims)
    ? researchPayload.claims.filter(isObject)
    : [];

  const des = numberOrNull(active.des);
  const marketTrust = numberOrNull(active.resolved_market_trust_score);
  const directionalAgreement = numberOrNull(active.directional_agreement_score);
  const botScore = numberOrNull(active.resolved_bot_score);
  const marketTrustBand = active.resolved_market_trust_band;
  const botGrade = active.resolved_bot_grade;
  const decisionLadder = active.resolved_decision_ladder;
  const forecastHorizon = active.forecast_horizon;
  const primaryAction = active.definitive_recommendation;
  const definitiveForecast = active.definitive_forecast;
  if (
    des === null || marketTrust === null || directionalAgreement === null || botScore === null ||
    !isNonEmptyString(marketTrustBand) || !isNonEmptyString(botGrade) ||
    !isNonEmptyString(decisionLadder) || !isNonEmptyString(forecastHorizon) ||
    !isNonEmptyString(primaryAction) || !isNonEmptyString(definitiveForecast)
  ) {
    return json({ error: 'EDGE Stocks V1.3 publication blocked: governed decision fields missing', ticker: symbol }, 409);
  }
  if (!componentRows.length) {
    return json({ error: 'EDGE Stocks V1.3 publication blocked: drill-down is empty', ticker: symbol }, 409);
  }

  const parseNotes = (value: unknown): { key_outcome?: string; interpretation?: string } => {
    if (!isNonEmptyString(value)) return {};
    try {
      const parsed = JSON.parse(value);
      return isObject(parsed) ? {
        key_outcome: isNonEmptyString(parsed.key_outcome) ? String(parsed.key_outcome) : undefined,
        interpretation: isNonEmptyString(parsed.interpretation) ? String(parsed.interpretation) : undefined,
      } : {};
    } catch {
      return { interpretation: String(value) };
    }
  };

  const scoreLabel = (value: unknown): string => {
    const n = Number(value);
    return n === 2 ? 'STRONGLY POSITIVE' : n === 1 ? 'POSITIVE' : n === 0 ? 'NEUTRAL' : n === -1 ? 'NEGATIVE' : n === -2 ? 'STRONGLY NEGATIVE' : 'NOT VERIFIED';
  };
  const legacyInterpretation = (componentRaw: unknown, scoreRaw: unknown): string => {
    const component = String(componentRaw || '').toUpperCase().replace(/[^A-Z0-9]+/g,'_');
    const score = Number(scoreRaw);
    const tone = scoreLabel(scoreRaw).toLowerCase();
    const consequence =
      component.includes('PRICE_STRUCTURE') ? 'Near-term price structure is therefore a material input to the D+5 direction.' :
      component.includes('PV') ? 'Price/volume/options confirmation is therefore influencing directional conviction.' :
      component.includes('RELATIVE_STRENGTH') ? 'Relative performance versus the benchmark is therefore influencing directional conviction.' :
      component.includes('BUSINESS_FUNDAMENTALS') ? 'Business fundamentals are therefore acting as a medium-term support or drag within the five-day framework.' :
      component.includes('VALUATION') ? 'Valuation is therefore acting as a supporting or limiting factor rather than a standalone trigger.' :
      component.includes('INSTITUTIONAL') ? 'Institutional ownership/behaviour evidence is therefore contributing to confirmation quality.' :
      component.includes('NEWS') || component.includes('CATALYST') ? 'Recent catalysts are therefore contributing to the risk/reward balance.' :
      component.includes('EVENT_SHOCK') ? 'Event-risk evidence is therefore affecting the risk overlay rather than creating direction by itself.' :
      component.includes('CHART_PATTERN') ? 'The active chart-pattern signal is therefore contributing to the near-term setup.' :
      'This governed component is contributing to the overall EDGE direction and conviction.';
    return `Legacy active run: the original narrative field was not persisted. The immutable verified component score is ${Number.isFinite(score) ? score.toFixed(0) : 'N/A'} (${tone}); ${consequence}`;
  };
  const componentKey = (value: unknown): string => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g,'_');
  const researchFinding = (componentRaw: unknown): string | undefined => {
    const component = componentKey(componentRaw);
    const statements = researchClaims
      .filter((claim: Record<string, unknown>) =>
        componentKey(claim.evidence_category) === component &&
        String(claim.verification_status || '').toUpperCase() === 'VERIFIED' &&
        isNonEmptyString(claim.statement)
      )
      .map((claim: Record<string, unknown>) => String(claim.statement).trim());
    return [...new Set(statements)].join(' ') || undefined;
  };
  const plainFinding = (
    componentRaw: unknown,
    scoreRaw: unknown,
    verification: string,
    notes: { key_outcome?: string; interpretation?: string },
  ): string => {
    const component = componentKey(componentRaw);
    const fromResearch = researchFinding(component);
    if (fromResearch) return fromResearch;

    if (verification !== 'VERIFIED') {
      if (component.includes('INSTITUTIONAL')) {
        return 'This run did not contain independently verified FII, DII or mutual-fund holding/flow evidence, so EDGE left Institutional Behaviour unscored.';
      }
      if (component.includes('VALUATION')) {
        return 'This run did not contain independently verified valuation evidence that met the EDGE evidence gate, so valuation was left unscored.';
      }
      return 'This run did not contain enough verified evidence to score this factor.';
    }

    const n = Number(scoreRaw);
    const raw = String(notes.interpretation || '');
    const patternMatch = raw.match(/(?:pattern is|pattern as)\s+([A-Z0-9_ -]+)/i);
    const pattern = patternMatch ? patternMatch[1].trim().replace(/_/g,' ').toLowerCase() : '';

    if (component.includes('PRICE_STRUCTURE')) {
      if (pattern === 'range' || n === 0) return 'The latest price structure is range-bound, with no confirmed directional break.';
      if (n > 0) return 'The latest price structure is trending higher and supports the five-day setup.';
      return 'The latest price structure is trending lower and weakens the five-day setup.';
    }
    if (component.includes('SPECIFIC_CHART_PATTERN') || component.includes('CHART_PATTERN')) {
      if (pattern === 'range' || n === 0) return 'Daily candles are still range-bound; no breakout or breakdown pattern is confirmed.';
      return pattern
        ? 'Daily candles show a '+pattern+' pattern.'
        : 'Daily candles show a verified directional chart pattern.';
    }
    if (component.includes('PV_PVPO') || component === 'PVPO' || component === 'PV') {
      if (n > 0) return 'Price and volume are confirming the current move; options open interest is used only as secondary confirmation when available.';
      if (n < 0) return 'Price and volume are weakening the current move; options open interest is used only as secondary confirmation when available.';
      return 'Price and volume are not giving a clear directional confirmation; options open interest is secondary confirmation only.';
    }
    if (component.includes('RELATIVE_STRENGTH')) {
      if (n > 0) return 'The stock is outperforming NIFTY 50 over the EDGE comparison window.';
      if (n < 0) return 'The stock is underperforming NIFTY 50 over the EDGE comparison window.';
      return 'The stock is showing no meaningful relative-performance edge versus NIFTY 50.';
    }
    return notes.interpretation || notes.key_outcome || scoreLabel(scoreRaw);
  };

  const drilldown = componentRows.map((row: Record<string, unknown>) => {
    const verification = componentVerificationStatus(row.availability_status, row.evidence_quality);
    const notes = parseNotes(row.notes);
    const reconstructed = verification === 'VERIFIED' && !isNonEmptyString(notes.interpretation);
    const keyOutcome = notes.key_outcome ?? (reconstructed ? scoreLabel(row.raw_score) : (row.conflict_flag ? 'MATERIAL CONFLICT' : String(row.availability_status ?? 'NOT_VERIFIED')));
    const interpretation = notes.interpretation ?? (verification === 'VERIFIED' ? legacyInterpretation(row.component,row.raw_score) : 'Evidence not verified; no interpretation inferred.');
    return {
      component: String(row.component),
      score_or_level: row.raw_score ?? 'N/A',
      verification_status: verification,
      key_outcome: keyOutcome,
      finding: plainFinding(row.component,row.raw_score,verification,notes),
      interpretation,
      narrative_source: reconstructed ? 'LEGACY_SCORE_RECONSTRUCTION' : 'PERSISTED_EVIDENCE_NARRATIVE',
    };
  });

  const effectiveConviction = Math.min(Math.abs(des) / 100, 1) * (marketTrust / 100);
  const overrideCode = active.active_override == null ? null : String(active.active_override);

  const payload = {
    contract_version: 'EDGE_STOCKS_V1_3',
    presentation_contract: 'EFFICACY_V2',
    engine: 'EDGE_STOCKS',
    framework_version: 'EDGE_V1',
    ticker: symbol,
    run_id: String(active.recommendation_id),
    generated_at: new Date(String(active.run_timestamp ?? new Date().toISOString())).toISOString(),
    presentation: {
      standard_table_count: 4,
      table_1: 'EDGE_MASTER_ASSESSMENT',
      table_2: 'CURRENT_STOCK_OUTCOME',
      table_3: 'DRILLDOWN',
      table_4: 'ACTIVE_CALLS'
    },
    master_assessment: {
      recommendations: integerOrZero(master.recommendations),
      unique_stocks: integerOrZero(master.unique_stocks),
      open_recommendations: integerOrZero(master.open_recommendations),
      closed_recommendations: integerOrZero(master.closed_recommendations),
      official_scorable_recommendations: integerOrZero(master.official_scorable_recommendations),
      recommendation_hit_rate_pct: numberOrNull(master.recommendation_hit_rate_pct),
      direction_hit_rate_pct: numberOrNull(master.direction_hit_rate_pct),
      target_hit_rate_pct: numberOrNull(master.target_hit_rate_pct),
      avg_gain_pct: numberOrNull(master.avg_gain_pct),
      avg_loss_pct: numberOrNull(master.avg_loss_pct),
      avg_mfe_pct: numberOrNull(master.avg_mfe_pct),
      avg_mae_pct: numberOrNull(master.avg_mae_pct),
      cumulative_model_pnl_units: numberOrNull(master.cumulative_model_pnl_units),
      provisional_captured_checkpoints: integerOrZero(master.provisional_captured_checkpoints),
      provisional_due_checkpoints: integerOrZero(master.provisional_due_checkpoints),
      provisional_forecast_scorable: integerOrZero(master.provisional_forecast_scorable),
      provisional_forecast_hits: integerOrZero(master.provisional_forecast_hits),
      provisional_forecast_misses: integerOrZero(master.provisional_forecast_misses),
      provisional_forecast_accuracy_pct: numberOrNull(master.provisional_forecast_accuracy_pct),
      provisional_zone_scorable: integerOrZero(master.provisional_zone_scorable),
      provisional_zone_hits: integerOrZero(master.provisional_zone_hits),
      provisional_zone_misses: integerOrZero(master.provisional_zone_misses),
      provisional_zone_accuracy_pct: numberOrNull(master.provisional_zone_accuracy_pct),
      stock_assessment: {
        ticker: symbol,
        recommendations: integerOrZero(stock.recommendations),
        open_recommendations: integerOrZero(stock.open_recommendations),
        closed_recommendations: integerOrZero(stock.closed_recommendations),
        official_scorable_recommendations: integerOrZero(stock.official_scorable_recommendations),
        recommendation_hit_rate_pct: numberOrNull(stock.recommendation_hit_rate_pct),
        direction_hit_rate_pct: numberOrNull(stock.direction_hit_rate_pct),
        target_hit_rate_pct: numberOrNull(stock.target_hit_rate_pct),
        avg_gain_pct: numberOrNull(stock.avg_gain_pct),
        avg_loss_pct: numberOrNull(stock.avg_loss_pct),
        avg_mfe_pct: numberOrNull(stock.avg_mfe_pct),
        avg_mae_pct: numberOrNull(stock.avg_mae_pct),
        cumulative_model_pnl_units: numberOrNull(stock.cumulative_model_pnl_units),
        provisional_captured_checkpoints: integerOrZero(stock.provisional_captured_checkpoints),
        provisional_due_checkpoints: integerOrZero(stock.provisional_due_checkpoints),
        provisional_forecast_scorable: integerOrZero(stock.provisional_forecast_scorable),
        provisional_forecast_hits: integerOrZero(stock.provisional_forecast_hits),
        provisional_forecast_misses: integerOrZero(stock.provisional_forecast_misses),
        provisional_forecast_accuracy_pct: numberOrNull(stock.provisional_forecast_accuracy_pct),
        provisional_zone_scorable: integerOrZero(stock.provisional_zone_scorable),
        provisional_zone_hits: integerOrZero(stock.provisional_zone_hits),
        provisional_zone_misses: integerOrZero(stock.provisional_zone_misses),
        provisional_zone_accuracy_pct: numberOrNull(stock.provisional_zone_accuracy_pct),
        latest_checkpoint_observed_at: stock.latest_checkpoint_observed_at ?? null,
        previous_recommendation: previousRecommendation,
      }
    },
    active_calls: allActiveRows.map((row: Record<string, unknown>) => ({
      ticker: String(row.ticker),
      recommendation_id: String(row.recommendation_id),
      definitive_forecast: row.definitive_forecast,
      definitive_recommendation: row.definitive_recommendation,
      expected_price_zone: { low: numberOrNull(row.expected_price_zone_low), high: numberOrNull(row.expected_price_zone_high) },
      call_timestamp: row.call_timestamp ?? null,
      expiry_trading_date: row.expiry_trading_date ?? null,
      current_price: numberOrNull(row.current_price),
      current_return_pct: numberOrNull(row.current_return_pct),
      outcome_verdict: row.outcome_verdict ?? 'OPEN',
      probabilities: { bull: numberOrNull(row.bull_probability), base: numberOrNull(row.base_probability), bear: numberOrNull(row.bear_probability) }
    })),
    current_stock_outcome: {
      des,
      market_trust: { score: marketTrust, band: marketTrustBand },
      directional_agreement: directionalAgreement,
      effective_conviction: Number(effectiveConviction.toFixed(6)),
      probabilities: {
        bull: numberOrNull(active.bull_probability),
        base: numberOrNull(active.base_probability),
        bear: numberOrNull(active.bear_probability)
      },
      definitive_forecast: definitiveForecast,
      expected_price_zone: { low: numberOrNull(active.expected_price_zone_low), high: numberOrNull(active.expected_price_zone_high) },
      forecast_horizon: forecastHorizon,
      risk_override: { status: overrideCode ? 'ACTIVE' : 'CLEAR', code: overrideCode },
      primary_action: primaryAction,
      decision_ladder: decisionLadder,
      bot: { score: botScore, grade: botGrade },
      execution: {
        instrument: active.instrument ?? 'NONE',
        entry_low: numberOrNull(active.entry_low),
        entry_high: numberOrNull(active.entry_high),
        stop_price: numberOrNull(active.stop_price),
        invalidation: active.invalidation_text ?? null,
        target1: numberOrNull(active.target1),
        target2: numberOrNull(active.target2),
        time_exit: active.time_exit ?? null,
        option_strike: numberOrNull(active.option_strike),
        option_expiry: active.option_expiry ?? null,
        observed_premium: numberOrNull(active.observed_premium),
        option_suitability_status: active.option_suitability_status ?? null,
        execution_quality_score: numberOrNull(active.execution_quality_score)
      },
      current_price: numberOrNull(active.current_price),
      current_return_pct: numberOrNull(active.current_return_pct),
      expiry_trading_date: active.expiry_trading_date ?? null,
      outcome_status: active.outcome_verdict ?? 'OPEN'
    },
    drilldown
  };

  const errors = validateEdgeStocksResult(payload);
  if (errors.length) return json({ error: 'EDGE Stocks V1.3 semantic contract validation failed', details: errors, ticker: symbol }, 409);
  return json({ report: payload });
}

async function ipoEdgeSnapshot(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  try {
    const live = await fetch('https://raw.githubusercontent.com/kanirudhsaxena-code/IPO-EDGE/main/runtime/console_snapshot.json', {
      headers: { 'accept': 'application/json', 'user-agent': 'EDGE-CONSOLE-IPO-SNAPSHOT/1.0' },
      cf: { cacheTtl: 60, cacheEverything: true }
    } as RequestInit);
    if (live.ok) {
      const payload = await live.json();
      if (isObject(payload) && Array.isArray(payload.issues)) {
        return json({ snapshot: { captured_at: payload.captured_at ?? null, payload }, source: 'IPO_EDGE_REPO' });
      }
    }
  } catch {}
  if (!env.DATABASE_URL) return json({ error: 'IPO snapshot unavailable' }, 503);
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`select captured_at,payload from ipo_console_snapshots order by captured_at desc,id desc limit 1`;
  return json({ snapshot: rows[0] ?? null, source: 'CONSOLE_FALLBACK' });
}

async function edgeStocksHistory(env: Env, tickerRaw: string): Promise<Response> {
  if (!env.EDGE_DATABASE_URL) return json({ error: 'EDGE database is not configured', code: 'EDGE_DATABASE_NOT_CONFIGURED' }, 503);
  const ticker = normalizeTickerCandidate(tickerRaw);
  if (!ticker) return json({ error: 'Invalid ticker' }, 422);
  const sql = neon(env.EDGE_DATABASE_URL);
  const rows = await sql`
    select r.recommendation_id,r.run_timestamp,r.definitive_forecast,r.definitive_recommendation,
           r.expected_price_zone_low,r.expected_price_zone_high,r.bull_probability,r.base_probability,r.bear_probability,
           p.current_return_pct,p.outcome_verdict,l.status,l.expiry_trading_date
      from recommendations r
      left join recommendation_performance p using(recommendation_id)
      left join recommendation_lifecycle l using(recommendation_id)
     where r.ticker=${ticker}
     order by r.run_timestamp desc
     limit 8
  `;
  return json({ ticker, recommendations: rows });
}

async function edgeStocksMaster(env: Env): Promise<Response> {
  if (!env.EDGE_DATABASE_URL) return json({ error: 'EDGE database is not configured', code: 'EDGE_DATABASE_NOT_CONFIGURED' }, 503);
  const sql = neon(env.EDGE_DATABASE_URL);
  const rows = await sql`select * from v_edge_master_report limit 1`;
  return json({ master: rows[0] ?? null, labels: { official: 'OFFICIAL', provisional: 'PROVISIONAL' } });
}

export default { async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/5dr/run-requests' && request.method === 'POST') return readinessGate(request, env);
  const normalized = url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/normalized$/);
  if (normalized && request.method === 'POST') return saveNormalizedEvidence(request, env, decodeURIComponent(normalized[1]));
  const packet = url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/execution-packet$/);
  if (packet && request.method === 'GET') return executionPacket(env, decodeURIComponent(packet[1]));
  const failed = url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/fail$/);
  if (failed && request.method === 'POST') return failRequest(request, env, decodeURIComponent(failed[1]));
  if (url.pathname === '/api/5dr/canonical-handoff' && request.method === 'GET') return fiveDrCanonicalHandoff(env);
  if (url.pathname.startsWith('/api/edge-stocks/') && isAccessIdentityEnforced(env)) {
    const testerGate=await testerEdgeSandboxGate(request,env);
    if(testerGate)return testerGate;
  }
  if (url.pathname === '/api/edge-stocks/research-bundles' && request.method === 'POST') return saveEdgeResearchBundle(request, env);
  const researchBundle = url.pathname.match(/^\/api\/edge-stocks\/research-bundles\/([^/]+)$/);
  if (researchBundle && request.method === 'GET') return getEdgeResearchBundle(env, decodeURIComponent(researchBundle[1]));
  if (url.pathname === '/api/edge-stocks/dispatch-health' && request.method === 'GET') return edgeStocksDispatchHealth(env);
  if (url.pathname === '/api/edge-stocks/canonical-targets' && request.method === 'GET') return edgeStocksCanonicalTargets(env);
  if (url.pathname === '/api/edge-stocks/invoke' && request.method === 'POST') return invokeEdgeStocks(request, env);
  if (url.pathname === '/api/edge-stocks/invoke/status' && request.method === 'GET') return edgeStocksInvocationStatus(env, url.searchParams.get('ticker') || '', url.searchParams.get('after') || '');
  if (url.pathname === '/api/edge-stocks/report' && request.method === 'GET') return edgeStocksReport(env, url.searchParams.get('ticker') || '');
  if (url.pathname === '/api/edge-stocks/history' && request.method === 'GET') return edgeStocksHistory(env, url.searchParams.get('ticker') || '');
  if (url.pathname === '/api/edge-stocks/master' && request.method === 'GET') return edgeStocksMaster(env);
  if (url.pathname === '/api/ipo-edge/snapshot' && request.method === 'GET') return ipoEdgeSnapshot(request, env);
  return app.fetch(request, env);
}};
