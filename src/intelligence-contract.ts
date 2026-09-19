import { REQUIRED_5DR_INPUTS, isNonEmptyString, isObject, type JsonRecord } from './normalization';

export const USER_SCREENSHOT_CATEGORIES = ['PRICE_TECHNICALS', 'DERIVATIVES_OI'] as const;
export const SYSTEM_RESEARCH_CATEGORIES = ['MARKET_TRUST', 'EVENT_SHOCK', 'EXECUTION_RISK'] as const;

export type IntelligenceSourceKind = 'SCREENSHOT' | 'UPSTOX_STRUCTURED' | 'WEB_RESEARCH';
export type IntelligenceVerification = 'VERIFIED' | 'DEGRADED' | 'UNAVAILABLE';

export interface IntelligenceObservation {
  category: string;
  source_kind: IntelligenceSourceKind;
  source_ref: string;
  observed_at: string;
  retrieved_at: string;
  verification: IntelligenceVerification;
  notes?: string;
}

export interface IntelligenceHandoff {
  producer: string;
  producer_version: string;
  request_id: string;
  observations: IntelligenceObservation[];
  normalized: JsonRecord;
}

const validTimestamp = (value: unknown): value is string =>
  isNonEmptyString(value) && !Number.isNaN(Date.parse(value));

export function validateIntelligenceHandoff(body: unknown): string[] {
  if (!isObject(body)) return ['intelligence handoff must be an object'];
  const errors: string[] = [];
  if (!isNonEmptyString(body.producer)) errors.push('producer is mandatory');
  if (!isNonEmptyString(body.producer_version)) errors.push('producer_version is mandatory');
  if (!isNonEmptyString(body.request_id)) errors.push('request_id is mandatory');
  if (!Array.isArray(body.observations) || body.observations.length === 0) {
    errors.push('observations must be a non-empty array');
  } else {
    const seenCategories = new Set<string>();
    body.observations.forEach((item, index) => {
      if (!isObject(item)) { errors.push(`observations[${index}] must be an object`); return; }
      if (!isNonEmptyString(item.category)) errors.push(`observations[${index}].category is mandatory`);
      else seenCategories.add(item.category);
      if (item.source_kind !== 'SCREENSHOT' && item.source_kind !== 'UPSTOX_STRUCTURED' && item.source_kind !== 'WEB_RESEARCH') {
        errors.push(`observations[${index}].source_kind is invalid`);
      }
      if (!isNonEmptyString(item.source_ref)) errors.push(`observations[${index}].source_ref is mandatory`);
      if (!validTimestamp(item.observed_at)) errors.push(`observations[${index}].observed_at must be a valid ISO timestamp`);
      if (!validTimestamp(item.retrieved_at)) errors.push(`observations[${index}].retrieved_at must be a valid ISO timestamp`);
      if (!['VERIFIED', 'DEGRADED', 'UNAVAILABLE'].includes(String(item.verification))) {
        errors.push(`observations[${index}].verification is invalid`);
      }
      if (item.verification === 'VERIFIED' && !isNonEmptyString(item.source_ref)) {
        errors.push(`observations[${index}] VERIFIED evidence requires provenance`);
      }
    });
    for (const category of [...USER_SCREENSHOT_CATEGORIES, ...SYSTEM_RESEARCH_CATEGORIES]) {
      if (!seenCategories.has(category)) errors.push(`missing intelligence observation category ${category}`);
    }
  }

  if (!isObject(body.normalized)) {
    errors.push('normalized must be an object');
  } else {
    for (const key of REQUIRED_5DR_INPUTS) {
      if (!(key in body.normalized)) errors.push(`missing normalized input ${key}`);
    }
  }
  return errors;
}

export function canAdvanceIntelligenceHandoff(body: unknown): { ready: boolean; errors: string[]; degraded: boolean } {
  const errors = validateIntelligenceHandoff(body);
  if (errors.length || !isObject(body) || !Array.isArray(body.observations)) {
    return { ready: false, errors, degraded: false };
  }
  const unavailable = body.observations.filter(item => isObject(item) && item.verification === 'UNAVAILABLE');
  if (unavailable.length) {
    return { ready: false, errors: [...errors, 'one or more required intelligence observations are unavailable'], degraded: false };
  }
  const degraded = body.observations.some(item => isObject(item) && item.verification === 'DEGRADED');
  return { ready: true, errors, degraded };
}
