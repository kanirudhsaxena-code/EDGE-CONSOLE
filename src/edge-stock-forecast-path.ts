import { isNonEmptyString, isObject, type JsonRecord } from './normalization';

export const EDGE_STOCK_FORECAST_PATH_VERSION = 'EDGE_STOCK_FORECAST_PATH_V1' as const;
export const EDGE_STOCK_FORECAST_LABELS = ['D','D+1','D+2','D+3','D+4'] as const;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function validateEdgeStockForecastPath(value: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(value)) return ['forecast_path must be an object'];
  const path = value as JsonRecord;
  if (path.version !== EDGE_STOCK_FORECAST_PATH_VERSION) errors.push(`forecast_path.version must be ${EDGE_STOCK_FORECAST_PATH_VERSION}`);
  if (!isNonEmptyString(path.source_run_id)) errors.push('forecast_path.source_run_id is mandatory');
  if (!isNonEmptyString(path.generated_at) || Number.isNaN(Date.parse(String(path.generated_at)))) errors.push('forecast_path.generated_at must be a valid ISO timestamp');
  if (!Array.isArray(path.sessions)) return [...errors, 'forecast_path.sessions must be an array'];
  if (path.sessions.length !== EDGE_STOCK_FORECAST_LABELS.length) errors.push('forecast_path.sessions must contain exactly D through D+4');

  let previousTarget = '';
  path.sessions.forEach((entry, index) => {
    const expectedLabel = EDGE_STOCK_FORECAST_LABELS[index];
    if (!isObject(entry)) { errors.push(`forecast_path.sessions[${index}] must be an object`); return; }
    const row = entry as JsonRecord;
    if (row.label !== expectedLabel) errors.push(`forecast_path.sessions[${index}].label must be ${expectedLabel}`);
    if (!isNonEmptyString(row.target_session) || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.target_session))) errors.push(`forecast_path.sessions[${index}].target_session must be YYYY-MM-DD`);
    const target = String(row.target_session ?? '');
    if (previousTarget && target <= previousTarget) errors.push('forecast_path target sessions must be strictly increasing trading sessions');
    previousTarget = target;

    if (!isObject(row.probabilities)) errors.push(`forecast_path.sessions[${index}].probabilities is mandatory`);
    else {
      const p = row.probabilities as JsonRecord;
      for (const key of ['bull','base','bear']) if (!finite(p[key]) || Number(p[key]) < 0 || Number(p[key]) > 100) errors.push(`forecast_path.sessions[${index}].probabilities.${key} must be 0-100`);
      if (finite(p.bull) && finite(p.base) && finite(p.bear) && Math.abs(p.bull + p.base + p.bear - 100) > 0.01) errors.push(`forecast_path.sessions[${index}].probabilities must sum to 100 within 0.01`);
    }

    if (!isObject(row.expected_price_zone)) errors.push(`forecast_path.sessions[${index}].expected_price_zone is mandatory`);
    else {
      const zone = row.expected_price_zone as JsonRecord;
      if (!finite(zone.low) || !finite(zone.high) || zone.low > zone.high) errors.push(`forecast_path.sessions[${index}].expected_price_zone must contain numeric low <= high`);
    }
    if (!isNonEmptyString(row.lineage_id)) errors.push(`forecast_path.sessions[${index}].lineage_id is mandatory`);
  });
  return errors;
}
