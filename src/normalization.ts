export type JsonRecord = Record<string, unknown>;

// Only evidence required to calculate a new 5DR forecast belongs upstream.
// Forecast/recommendation assessments and ledger completion are downstream lifecycle
// outputs and must never be fabricated to make a run executable.
export const REQUIRED_5DR_INPUTS = [
  'regime', 'component_scores', 'market_trust_inputs', 'event_shock',
  'execution_inputs', 'data_adequate', 'event_kill_switch', 'expected_rr',
  'horizon_slots'
] as const;

export const isObject = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function validateNormalizedEvidence(body: unknown): string[] {
  if (!isObject(body) || !Array.isArray(body.evidence)) return ['evidence must be an array'];
  if (!body.evidence.length) return ['at least one normalized evidence item is required'];
  if (body.evidence.length > 20) return ['maximum 20 normalized evidence items'];
  const errors: string[] = [];
  body.evidence.forEach((item, index) => {
    if (!isObject(item)) { errors.push(`evidence[${index}] must be an object`); return; }
    if (!isNonEmptyString(item.evidence_type)) errors.push(`evidence[${index}].evidence_type is mandatory`);
    if (!isNonEmptyString(item.source_ref)) errors.push(`evidence[${index}].source_ref is mandatory`);
    if (item.captured_at !== undefined && item.captured_at !== null &&
      (!isNonEmptyString(item.captured_at) || Number.isNaN(Date.parse(item.captured_at)))) {
      errors.push(`evidence[${index}].captured_at must be a valid ISO timestamp`);
    }
    if (!isObject(item.normalized) || Object.keys(item.normalized).length === 0) {
      errors.push(`evidence[${index}].normalized must be a non-empty object`);
    }
  });
  return errors;
}

export function assessCompleteness(evidence: unknown[]): { missing: string[]; conflicts: string[] } {
  const seen = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const item of evidence) {
    if (!isObject(item) || !isObject(item.normalized)) continue;
    for (const [key, value] of Object.entries(item.normalized)) {
      if (!REQUIRED_5DR_INPUTS.includes(key as typeof REQUIRED_5DR_INPUTS[number])) continue;
      const encoded = JSON.stringify(value);
      if (seen.has(key) && seen.get(key) !== encoded) conflicts.add(key);
      else seen.set(key, encoded);
    }
  }
  return { missing: REQUIRED_5DR_INPUTS.filter(key => !seen.has(key)), conflicts: [...conflicts] };
}
