export const REQUIRED_5DR_EVIDENCE_CATEGORIES = [
  'PRICE_TECHNICALS',
  'DERIVATIVES_OI',
  'MARKET_TRUST',
  'EVENT_SHOCK',
  'EXECUTION_RISK'
] as const;

export type EvidenceCategory = typeof REQUIRED_5DR_EVIDENCE_CATEGORIES[number];

export function assessEvidenceReadiness(input: unknown): {
  declared: string[];
  missing: EvidenceCategory[];
  invalid: string[];
  ready: boolean;
} {
  const declared = Array.isArray(input)
    ? [...new Set(input.filter((value): value is string => typeof value === 'string').map(value => value.trim()).filter(Boolean))]
    : [];
  const invalid = declared.filter(category => !REQUIRED_5DR_EVIDENCE_CATEGORIES.includes(category as EvidenceCategory));
  const missing = REQUIRED_5DR_EVIDENCE_CATEGORIES.filter(category => !declared.includes(category));
  return { declared, missing, invalid, ready: missing.length === 0 && invalid.length === 0 };
}
