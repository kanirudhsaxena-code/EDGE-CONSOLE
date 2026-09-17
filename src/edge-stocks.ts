import { isNonEmptyString, isObject, type JsonRecord } from './normalization';

const percentOrNull = (value: unknown): boolean =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100);

export function validateEdgeStocksResult(body: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(body)) return ['request body must be a JSON object'];
  if (body.contract_version !== 'EDGE_STOCKS_V1_1') errors.push('contract_version must be EDGE_STOCKS_V1_1');
  if (body.engine !== 'EDGE_STOCKS') errors.push('engine must be EDGE_STOCKS');
  if (body.framework_version !== 'EDGE_V1') errors.push('framework_version must be EDGE_V1');
  if (!isNonEmptyString(body.ticker)) errors.push('ticker is mandatory');
  if (!isNonEmptyString(body.run_id)) errors.push('run_id is mandatory');
  if (!isNonEmptyString(body.generated_at) || Number.isNaN(Date.parse(String(body.generated_at)))) errors.push('generated_at must be a valid ISO timestamp');

  const decision = body.decision;
  if (!isObject(decision)) errors.push('decision is mandatory');
  else {
    if (!isNonEmptyString(decision.forecast)) errors.push('decision.forecast is mandatory');
    if (!isNonEmptyString(decision.recommendation)) errors.push('decision.recommendation is mandatory');
    if (!isObject(decision.probabilities)) errors.push('decision.probabilities is mandatory');
    else {
      const p = decision.probabilities as JsonRecord;
      for (const key of ['bull', 'base', 'bear']) {
        const value = p[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) errors.push(`decision.probabilities.${key} must be 0-100`);
      }
      if (typeof p.bull === 'number' && typeof p.base === 'number' && typeof p.bear === 'number') {
        const sum = p.bull + p.base + p.bear;
        if (Math.abs(sum - 100) > 0.2) errors.push('decision.probabilities must sum to approximately 100');
      }
    }
  }

  const official = body.official_efficacy;
  if (!isObject(official)) errors.push('official_efficacy is mandatory');
  else {
    if (!Number.isInteger(official.sample_size) || Number(official.sample_size) < 0) errors.push('official_efficacy.sample_size must be a non-negative integer');
    for (const key of ['recommendation_hit_rate_pct', 'directional_accuracy_pct', 'forecast_accuracy_pct']) {
      if (!percentOrNull(official[key])) errors.push(`official_efficacy.${key} must be null or 0-100`);
    }
    if (official.sample_size === 0) {
      for (const key of ['recommendation_hit_rate_pct', 'directional_accuracy_pct', 'forecast_accuracy_pct']) {
        if (official[key] !== null) errors.push(`official_efficacy.${key} must be null when sample_size is 0`);
      }
    }
  }

  const provisional = body.provisional_checkpoint_diagnostics;
  if (!isObject(provisional)) errors.push('provisional_checkpoint_diagnostics is mandatory');
  else {
    if (provisional.label !== 'PROVISIONAL') errors.push('provisional_checkpoint_diagnostics.label must be PROVISIONAL');
    for (const key of ['captured_checkpoints', 'forecast_scorable', 'forecast_hits', 'forecast_misses', 'zone_scorable', 'zone_hits', 'zone_misses']) {
      const value = provisional[key];
      if (!Number.isInteger(value) || Number(value) < 0) errors.push(`provisional_checkpoint_diagnostics.${key} must be a non-negative integer`);
    }
    for (const key of ['forecast_accuracy_pct', 'zone_accuracy_pct']) {
      if (!percentOrNull(provisional[key])) errors.push(`provisional_checkpoint_diagnostics.${key} must be null or 0-100`);
    }
  }

  if (!Array.isArray(body.institutional_drilldown)) errors.push('institutional_drilldown must be an array');
  return errors;
}
