import { neon } from '@neondatabase/serverless';
import app from './index';
import { assessCompleteness, isNonEmptyString, isObject, validateNormalizedEvidence, type JsonRecord } from './normalization';
import { assessEvidenceReadiness, REQUIRED_5DR_EVIDENCE_CATEGORIES } from './evidence-readiness';
import { componentVerificationStatus, validateEdgeStocksResult } from './edge-stocks';

type Env = {
  ASSETS: Fetcher;
  EVIDENCE_BUCKET: R2Bucket;
  DATABASE_URL?: string;
  EDGE_DATABASE_URL?: string;
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

async function edgeStocksReport(env: Env, ticker: string): Promise<Response> {
  if (!env.EDGE_DATABASE_URL) return json({ error: 'EDGE database is not configured', code: 'EDGE_DATABASE_NOT_CONFIGURED' }, 503);
  const symbol = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{1,20}$/.test(symbol)) return json({ error: 'Invalid ticker' }, 422);

  const sql = neon(env.EDGE_DATABASE_URL);
  const reportRows = await sql`select * from v_edge_stock_report where ticker = ${symbol} limit 1`;
  if (!reportRows.length) return json({ error: 'Ticker not found in EDGE report view', ticker: symbol }, 404);

  const activeRows = await sql`
    select r.*, l.expiry_trading_date, p.current_price, p.outcome_verdict,
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

  const report = reportRows[0] as Record<string, unknown>;
  const active = activeRows[0] as Record<string, unknown>;
  const componentRows = await sql`
    select component, raw_score, evidence_quality, availability_status, conflict_flag, notes
      from component_scores
     where recommendation_id = ${String(active.recommendation_id)}
     order by component
  `;

  const des = numberOrNull(active.des);
  const marketTrust = numberOrNull(active.resolved_market_trust_score);
  const directionalAgreement = numberOrNull(active.directional_agreement_score);
  const botScore = numberOrNull(active.resolved_bot_score);
  if (des === null || marketTrust === null || directionalAgreement === null || botScore === null) {
    return json({ error: 'EDGE Stocks V1.2 publication blocked: governed decision fields missing', ticker: symbol }, 409);
  }
  const effectiveConviction = Math.min(Math.abs(des) / 100, 1) * (marketTrust / 100);
  const sampleSize = integerOrZero(report.official_scorable_recommendations);
  const overrideCode = active.active_override == null ? null : String(active.active_override);

  const payload = {
    contract_version: 'EDGE_STOCKS_V1_2',
    engine: 'EDGE_STOCKS',
    framework_version: 'EDGE_V1',
    ticker: symbol,
    run_id: String(active.recommendation_id),
    generated_at: new Date().toISOString(),
    presentation: {
      standard_table_count: 2,
      table_1: 'EDGE_OUTCOME_DECISION',
      table_2: 'INSTITUTIONAL_DRILLDOWN',
      efficacy_position: 'SEPARATE_AFTER_STANDARD_TABLES'
    },
    decision: {
      des,
      market_trust: { score: marketTrust, band: String(active.resolved_market_trust_band) },
      directional_agreement: directionalAgreement,
      effective_conviction: Number(effectiveConviction.toFixed(6)),
      probabilities: {
        bull: numberOrNull(active.bull_probability),
        base: numberOrNull(active.base_probability),
        bear: numberOrNull(active.bear_probability)
      },
      definitive_forecast: String(active.definitive_forecast),
      expected_price_zone: {
        low: numberOrNull(active.expected_price_zone_low),
        high: numberOrNull(active.expected_price_zone_high)
      },
      forecast_horizon: String(active.forecast_horizon),
      risk_override: { status: overrideCode ? 'ACTIVE' : 'CLEAR', code: overrideCode },
      primary_action: String(active.definitive_recommendation),
      decision_ladder: String(active.resolved_decision_ladder),
      bot: { score: botScore, grade: String(active.resolved_bot_grade) },
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
      expiry_trading_date: active.expiry_trading_date ?? null,
      outcome_status: active.outcome_verdict ?? 'OPEN'
    },
    official_efficacy: {
      label: 'OFFICIAL',
      sample_size: sampleSize,
      recommendation_hit_rate_pct: sampleSize === 0 ? null : numberOrNull(report.recommendation_hit_rate_pct),
      directional_accuracy_pct: sampleSize === 0 ? null : numberOrNull(report.direction_hit_rate_pct),
      forecast_accuracy_pct: sampleSize === 0 ? null : numberOrNull(report.forecast_accuracy_pct)
    },
    provisional_checkpoint_diagnostics: {
      label: 'PROVISIONAL',
      captured_checkpoints: integerOrZero(report.provisional_captured_checkpoints),
      forecast_scorable: integerOrZero(report.provisional_forecast_scorable),
      forecast_hits: integerOrZero(report.provisional_forecast_hits),
      forecast_misses: integerOrZero(report.provisional_forecast_misses),
      forecast_accuracy_pct: numberOrNull(report.provisional_forecast_accuracy_pct),
      zone_scorable: integerOrZero(report.provisional_zone_scorable),
      zone_hits: integerOrZero(report.provisional_zone_hits),
      zone_misses: integerOrZero(report.provisional_zone_misses),
      zone_accuracy_pct: numberOrNull(report.provisional_zone_accuracy_pct),
      latest_checkpoint_observed_at: report.latest_checkpoint_observed_at ?? null
    },
    institutional_drilldown: componentRows.map((row: Record<string, unknown>) => ({
      component: String(row.component),
      score_or_level: row.raw_score ?? 'N/A',
      verification_status: componentVerificationStatus(row.availability_status, row.evidence_quality),
      key_outcome: row.conflict_flag ? 'MATERIAL CONFLICT' : String(row.availability_status ?? 'NOT_VERIFIED'),
      interpretation: row.notes ? String(row.notes) : 'No additional interpretation recorded in the governed audit record.'
    }))
  };

  const errors = validateEdgeStocksResult(payload);
  if (errors.length) return json({ error: 'EDGE Stocks V1.2 report contract validation failed', details: errors, ticker: symbol }, 409);
  return json({ report: payload });
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
  if (url.pathname === '/api/edge-stocks/report' && request.method === 'GET') return edgeStocksReport(env, url.searchParams.get('ticker') || '');
  if (url.pathname === '/api/edge-stocks/master' && request.method === 'GET') return edgeStocksMaster(env);
  return app.fetch(request, env);
}};
