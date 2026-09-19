import { neon } from '@neondatabase/serverless';
import app from './index';
import { assessCompleteness, isNonEmptyString, isObject, validateNormalizedEvidence, type JsonRecord } from './normalization';
import { assessEvidenceReadiness, REQUIRED_5DR_EVIDENCE_CATEGORIES } from './evidence-readiness';
import { componentVerificationStatus, validateEdgeStocksResult } from './edge-stocks';
import { checkEdgeWorkflowAccess, dispatchEdgeWorkflow, normalizeTickerCandidate, parseEdgeCommand } from './edge-command';

type Env = {
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
  const existingToday = await todaysAutonomousRecommendation(env, ticker);
  if (existingToday) {
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
      trading_enabled: false,
    });
  }
  const baseline = await latestEdgeRecommendation(env, ticker);
  const baselineRunId = baseline?.id ?? null;
  const dispatchedAt = new Date().toISOString();

  const dispatch = await dispatchEdgeWorkflow(env.EDGE_GITHUB_TOKEN ?? '', ticker, 'UNKNOWN');
  if (!dispatch.ok) {
    return json({
      error: 'EDGE autonomous dispatch failed',
      detail: dispatch.error,
      ticker,
      code: dispatch.status === 503 ? 'EDGE_DISPATCH_NOT_CONFIGURED' : 'EDGE_DISPATCH_FAILED',
    }, dispatch.status === 401 || dispatch.status === 403 ? 502 : dispatch.status);
  }

  return json({
    ok: true,
    status: 'DISPATCHED',
    engine: 'EDGE_STOCKS',
    contract_version: 'EDGE_STOCKS_V1_3',
    ticker,
    command: command.raw,
    baseline_run_id: baselineRunId,
    dispatched_at: dispatchedAt,
    trading_enabled: false,
    next: `/api/edge-stocks/invoke/status?ticker=${encodeURIComponent(ticker)}&after=${encodeURIComponent(dispatchedAt)}`,
  }, 202);
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
    select ticker,recommendation_id,definitive_forecast,definitive_recommendation,
           expected_price_zone_low,expected_price_zone_high,expiry_trading_date,
           current_price,current_return_pct,outcome_verdict,open_recommendations,
           bull_probability,base_probability,bear_probability
      from v_edge_active_calls
     order by ticker
  `;

  const master = masterRows[0] as Record<string, unknown>;
  const stock = stockRows[0] as Record<string, unknown>;
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
    generated_at: new Date().toISOString(),
    presentation: {
      standard_table_count: 4,
      table_1: 'EDGE_MASTER_ASSESSMENT',
      table_2: 'ACTIVE_CALLS',
      table_3: 'CURRENT_STOCK_OUTCOME',
      table_4: 'DRILLDOWN'
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
      }
    },
    active_calls: allActiveRows.map((row: Record<string, unknown>) => ({
      ticker: String(row.ticker),
      recommendation_id: String(row.recommendation_id),
      definitive_forecast: row.definitive_forecast,
      definitive_recommendation: row.definitive_recommendation,
      expected_price_zone: { low: numberOrNull(row.expected_price_zone_low), high: numberOrNull(row.expected_price_zone_high) },
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
  if (url.pathname === '/api/edge-stocks/dispatch-health' && request.method === 'GET') return edgeStocksDispatchHealth(env);
  if (url.pathname === '/api/edge-stocks/invoke' && request.method === 'POST') return invokeEdgeStocks(request, env);
  if (url.pathname === '/api/edge-stocks/invoke/status' && request.method === 'GET') return edgeStocksInvocationStatus(env, url.searchParams.get('ticker') || '', url.searchParams.get('after') || '');
  if (url.pathname === '/api/edge-stocks/report' && request.method === 'GET') return edgeStocksReport(env, url.searchParams.get('ticker') || '');
  if (url.pathname === '/api/edge-stocks/master' && request.method === 'GET') return edgeStocksMaster(env);
  if (url.pathname === '/api/ipo-edge/snapshot' && request.method === 'GET') return ipoEdgeSnapshot(request, env);
  return app.fetch(request, env);
}};
