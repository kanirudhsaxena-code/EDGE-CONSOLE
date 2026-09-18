export const REQUIRED_USER_5DR_EVIDENCE_CATEGORIES = [
  'PRICE_TECHNICALS',
  'DERIVATIVES_OI'
] as const;

export const SYSTEM_OWNED_5DR_EVIDENCE_CATEGORIES = [
  'MARKET_TRUST',
  'EVENT_SHOCK',
  'EXECUTION_RISK'
] as const;

export type UserEvidenceCategory = typeof REQUIRED_USER_5DR_EVIDENCE_CATEGORIES[number];
export type SystemEvidenceCategory = typeof SYSTEM_OWNED_5DR_EVIDENCE_CATEGORIES[number];

export function assessUserEvidenceReadiness(input: unknown): {
  declared: string[];
  missing: UserEvidenceCategory[];
  invalid: string[];
  ready: boolean;
} {
  const declared = Array.isArray(input)
    ? [...new Set(input.filter((value): value is string => typeof value === 'string').map(value => value.trim()).filter(Boolean))]
    : [];
  const invalid = declared.filter(category => !REQUIRED_USER_5DR_EVIDENCE_CATEGORIES.includes(category as UserEvidenceCategory));
  const missing = REQUIRED_USER_5DR_EVIDENCE_CATEGORIES.filter(category => !declared.includes(category));
  return { declared, missing, invalid, ready: missing.length === 0 && invalid.length === 0 };
}

// Backward-compatible aliases while Mobile V1 routes are migrated. The semantics
// are intentionally narrowed to the two screenshot evidence families the user owns.
export const REQUIRED_5DR_EVIDENCE_CATEGORIES = REQUIRED_USER_5DR_EVIDENCE_CATEGORIES;
export const assessEvidenceReadiness = assessUserEvidenceReadiness;
