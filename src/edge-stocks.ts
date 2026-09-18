import { isNonEmptyString, isObject, type JsonRecord } from './normalization';

const percentOrNull = (value: unknown): boolean =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100);

const requiredNumber = (obj: JsonRecord, key: string, min: number, max: number, errors: string[], path: string): void => {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    errors.push(`${path}.${key} must be ${min}-${max}`);
  }
};

export function validateEdgeStocksResult(body: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(body)) return ['request body must be a JSON object'];
  if (body.contract_version !== 'EDGE_STOCKS_V1_2') errors.push('contract_version must be EDGE_STOCKS_V1_2');
  if (body.engine !== 'EDGE_STOCKS') errors.push('engine must be EDGE_STOCKS');
  if (body.framework_version !== 'EDGE_V1') errors.push('framework_version must be EDGE_V1');
  if (!isNonEmptyString(body.ticker)) errors.push('ticker is mandatory');
  if (!isNonEmptyString(body.run_id)) errors.push('run_id is mandatory');
  if (!isNonEmptyString(body.generated_at) || Number.isNaN(Date.parse(String(body.generated_at)))) errors.push('generated_at must be a valid ISO timestamp');

  const presentation = body.presentation;
  if (!isObject(presentation)) errors.push('presentation is mandatory');
  else {
    if (presentation.standard_table_count !== 2) errors.push('presentation.standard_table_count must be exactly 2');
    if (presentation.table_1 !== 'EDGE_OUTCOME_DECISION') errors.push('presentation.table_1 must be EDGE_OUTCOME_DECISION');
    if (presentation.table_2 !== 'INSTITUTIONAL_DRILLDOWN') errors.push('presentation.table_2 must be INSTITUTIONAL_DRILLDOWN');
    if (presentation.efficacy_position !== 'SEPARATE_AFTER_STANDARD_TABLES') errors.push('presentation.efficacy_position must be SEPARATE_AFTER_STANDARD_TABLES');
  }

  const decision = body.decision;
  if (!isObject(decision)) errors.push('decision is mandatory');
  else {
    const d = decision as JsonRecord;
    requiredNumber(d, 'des', -100, 100, errors, 'decision');
    requiredNumber(d, 'directional_agreement', 0, 100, errors, 'decision');
    requiredNumber(d, 'effective_conviction', 0, 1, errors, 'decision');
    if (!isNonEmptyString(d.definitive_forecast)) errors.push('decision.definitive_forecast is mandatory');
    if (!isNonEmptyString(d.forecast_horizon)) errors.push('decision.forecast_horizon is mandatory');
    if (!isNonEmptyString(d.primary_action)) errors.push('decision.primary_action is mandatory');
    if (!isNonEmptyString(d.decision_ladder)) errors.push('decision.decision_ladder is mandatory');

    if (!isObject(d.market_trust)) errors.push('decision.market_trust is mandatory');
    else {
      requiredNumber(d.market_trust as JsonRecord, 'score', 0, 100, errors, 'decision.market_trust');
      if (!isNonEmptyString((d.market_trust as JsonRecord).band)) errors.push('decision.market_trust.band is mandatory');
    }

    if (!isObject(d.bot)) errors.push('decision.bot is mandatory');
    else {
      requiredNumber(d.bot as JsonRecord, 'score', 0, 100, errors, 'decision.bot');
      if (!isNonEmptyString((d.bot as JsonRecord).grade)) errors.push('decision.bot.grade is mandatory');
    }

    if (!isObject(d.risk_override)) errors.push('decision.risk_override is mandatory');
    else {
      const status = (d.risk_override as JsonRecord).status;
      const code = (d.risk_override as JsonRecord).code;
      if (!['CLEAR', 'ACTIVE'].includes(String(status))) errors.push('decision.risk_override.status must be CLEAR or ACTIVE');
      if (status === 'ACTIVE' && !isNonEmptyString(code)) errors.push('decision.risk_override.code is mandatory when ACTIVE');
      if (status === 'CLEAR' && code !== null) errors.push('decision.risk_override.code must be null when CLEAR');
    }

    if (!isObject(d.expected_price_zone)) errors.push('decision.expected_price_zone is mandatory');
    if (!isObject(d.execution)) errors.push('decision.execution is mandatory');

    if (!isObject(d.probabilities)) errors.push('decision.probabilities is mandatory');
    else {
      const p = d.probabilities as JsonRecord;
      for (const key of ['bull', 'base', 'bear']) requiredNumber(p, key, 0, 100, errors, 'decision.probabilities');
      if (typeof p.bull === 'number' && typeof p.base === 'number' && typeof p.bear === 'number') {
        const sum = p.bull + p.base + p.bear;
        if (Math.abs(sum - 100) > 0.01) errors.push('decision.probabilities must sum to 100 within 0.01');
      }
    }
  }

  const official = body.official_efficacy;
  if (!isObject(official)) errors.push('official_efficacy is mandatory');
  else {
    if (official.label !== 'OFFICIAL') errors.push('official_efficacy.label must be OFFICIAL');
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
  else {
    body.institutional_drilldown.forEach((row, index) => {
      if (!isObject(row)) {
        errors.push(`institutional_drilldown[${index}] must be an object`);
        return;
      }
      for (const key of ['component', 'key_outcome', 'interpretation']) {
        if (!isNonEmptyString(row[key])) errors.push(`institutional_drilldown[${index}].${key} is mandatory`);
      }
      if (!['VERIFIED','NOT_VERIFIED','NOT_AVAILABLE','NOT_SCORABLE','N/A'].includes(String(row.verification_status))) {
        errors.push(`institutional_drilldown[${index}].verification_status is invalid`);
      }
    });
  }
  return errors;
}

export function componentVerificationStatus(availability: unknown, quality: unknown): 'VERIFIED'|'NOT_VERIFIED'|'NOT_AVAILABLE'|'N/A' {
  if (availability === 'NOT_AVAILABLE') return 'NOT_AVAILABLE';
  if (availability === 'N/A') return 'N/A';
  if (availability === 'NOT_VERIFIED' || quality === 'NOT_VERIFIED') return 'NOT_VERIFIED';
  return 'VERIFIED';
}
