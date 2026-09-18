import { isNonEmptyString, isObject, type JsonRecord } from './normalization';

const percentOrNull = (value: unknown): boolean =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100);

const nonNegativeInt = (value: unknown): boolean => Number.isInteger(value) && Number(value) >= 0;

const requiredNumber = (obj: JsonRecord, key: string, min: number, max: number, errors: string[], path: string): void => {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    errors.push(`${path}.${key} must be ${min}-${max}`);
  }
};

export function validateEdgeStocksResult(body: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(body)) return ['request body must be a JSON object'];
  if (body.contract_version !== 'EDGE_STOCKS_V1_3') errors.push('contract_version must be EDGE_STOCKS_V1_3');
  if (body.presentation_contract !== 'EFFICACY_V2') errors.push('presentation_contract must be EFFICACY_V2');
  if (body.engine !== 'EDGE_STOCKS') errors.push('engine must be EDGE_STOCKS');
  if (body.framework_version !== 'EDGE_V1') errors.push('framework_version must be EDGE_V1');
  if (!isNonEmptyString(body.ticker)) errors.push('ticker is mandatory');
  if (!isNonEmptyString(body.run_id)) errors.push('run_id is mandatory');
  if (!isNonEmptyString(body.generated_at) || Number.isNaN(Date.parse(String(body.generated_at)))) {
    errors.push('generated_at must be a valid ISO timestamp');
  }

  const presentation = body.presentation;
  if (!isObject(presentation)) errors.push('presentation is mandatory');
  else {
    if (presentation.standard_table_count !== 4) errors.push('presentation.standard_table_count must be exactly 4');
    if (presentation.table_1 !== 'EDGE_MASTER_ASSESSMENT') errors.push('presentation.table_1 must be EDGE_MASTER_ASSESSMENT');
    if (presentation.table_2 !== 'ACTIVE_CALLS') errors.push('presentation.table_2 must be ACTIVE_CALLS');
    if (presentation.table_3 !== 'CURRENT_STOCK_OUTCOME') errors.push('presentation.table_3 must be CURRENT_STOCK_OUTCOME');
    if (presentation.table_4 !== 'DRILLDOWN') errors.push('presentation.table_4 must be DRILLDOWN');
  }

  const master = body.master_assessment;
  if (!isObject(master)) errors.push('master_assessment is mandatory');
  else {
    for (const key of ['recommendations','unique_stocks','open_recommendations','closed_recommendations','official_scorable_recommendations','provisional_captured_checkpoints','provisional_due_checkpoints','provisional_forecast_scorable','provisional_forecast_hits','provisional_forecast_misses','provisional_zone_scorable','provisional_zone_hits','provisional_zone_misses']) {
      if (!nonNegativeInt(master[key])) errors.push(`master_assessment.${key} must be a non-negative integer`);
    }
    for (const key of ['recommendation_hit_rate_pct','direction_hit_rate_pct','target_hit_rate_pct','provisional_forecast_accuracy_pct','provisional_zone_accuracy_pct']) {
      if (!percentOrNull(master[key])) errors.push(`master_assessment.${key} must be null or 0-100`);
    }
    if (master.official_scorable_recommendations === 0) {
      for (const key of ['recommendation_hit_rate_pct','direction_hit_rate_pct','target_hit_rate_pct']) {
        if (master[key] !== null) errors.push(`master_assessment.${key} must be null when official_scorable_recommendations is 0`);
      }
    }
  }

  if (!Array.isArray(body.active_calls)) errors.push('active_calls must be an array');

  const decision = body.current_stock_outcome;
  if (!isObject(decision)) errors.push('current_stock_outcome is mandatory');
  else {
    const d = decision as JsonRecord;
    requiredNumber(d, 'des', -100, 100, errors, 'current_stock_outcome');
    requiredNumber(d, 'directional_agreement', 0, 100, errors, 'current_stock_outcome');
    requiredNumber(d, 'effective_conviction', 0, 1, errors, 'current_stock_outcome');
    if (!isNonEmptyString(d.definitive_forecast)) errors.push('current_stock_outcome.definitive_forecast is mandatory');
    if (!isNonEmptyString(d.forecast_horizon)) errors.push('current_stock_outcome.forecast_horizon is mandatory');
    if (!isNonEmptyString(d.primary_action)) errors.push('current_stock_outcome.primary_action is mandatory');
    if (!isNonEmptyString(d.decision_ladder)) errors.push('current_stock_outcome.decision_ladder is mandatory');
    if (!isObject(d.market_trust)) errors.push('current_stock_outcome.market_trust is mandatory');
    else {
      requiredNumber(d.market_trust as JsonRecord, 'score', 0, 100, errors, 'current_stock_outcome.market_trust');
      if (!isNonEmptyString((d.market_trust as JsonRecord).band)) errors.push('current_stock_outcome.market_trust.band is mandatory');
    }
    if (!isObject(d.bot)) errors.push('current_stock_outcome.bot is mandatory');
    else {
      requiredNumber(d.bot as JsonRecord, 'score', 0, 100, errors, 'current_stock_outcome.bot');
      if (!isNonEmptyString((d.bot as JsonRecord).grade)) errors.push('current_stock_outcome.bot.grade is mandatory');
    }
    if (!isObject(d.risk_override)) errors.push('current_stock_outcome.risk_override is mandatory');
    if (!isObject(d.expected_price_zone)) errors.push('current_stock_outcome.expected_price_zone is mandatory');
    if (!isObject(d.execution)) errors.push('current_stock_outcome.execution is mandatory');
    if (!isObject(d.probabilities)) errors.push('current_stock_outcome.probabilities is mandatory');
    else {
      const p = d.probabilities as JsonRecord;
      for (const key of ['bull','base','bear']) requiredNumber(p, key, 0, 100, errors, 'current_stock_outcome.probabilities');
      if (typeof p.bull === 'number' && typeof p.base === 'number' && typeof p.bear === 'number' && Math.abs(p.bull + p.base + p.bear - 100) > 0.01) {
        errors.push('current_stock_outcome.probabilities must sum to 100 within 0.01');
      }
    }
  }

  if (!Array.isArray(body.drilldown)) errors.push('drilldown must be an array');
  else if (body.drilldown.length === 0) errors.push('drilldown must contain at least one component');
  else {
    body.drilldown.forEach((row, index) => {
      if (!isObject(row)) {
        errors.push(`drilldown[${index}] must be an object`);
        return;
      }
      for (const key of ['component','key_outcome','interpretation']) {
        if (!isNonEmptyString(row[key])) errors.push(`drilldown[${index}].${key} is mandatory`);
      }
      if (!['VERIFIED','NOT_VERIFIED','NOT_AVAILABLE','NOT_SCORABLE','N/A'].includes(String(row.verification_status))) {
        errors.push(`drilldown[${index}].verification_status is invalid`);
      }
      if (String(row.verification_status) === 'VERIFIED') {
        const interpretation = String(row.interpretation ?? '').trim();
        if (!interpretation || /no additional interpretation|retained in immutable audit record|component evidence retained/i.test(interpretation)) {
          errors.push(`drilldown[${index}].interpretation must be meaningful for VERIFIED components`);
        }
      }
    });
  }
  return errors;
}

export function componentVerificationStatus(availability: unknown, quality: unknown): 'VERIFIED'|'NOT_VERIFIED'|'NOT_AVAILABLE'|'N/A' {
  if (availability === 'NOT_AVAILABLE') return 'NOT_AVAILABLE';
  if (availability === 'N/A') return 'N/A';
  if (availability !== 'AVAILABLE' || quality === 'NOT_VERIFIED' || quality == null) return 'NOT_VERIFIED';
  return 'VERIFIED';
}
