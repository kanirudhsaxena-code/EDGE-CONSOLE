import { SYSTEM_OWNED_5DR_EVIDENCE_CATEGORIES, type SystemEvidenceCategory } from './evidence-readiness';

export type AutonomousEvidenceStatus = 'PENDING' | 'VERIFIED' | 'DEGRADED' | 'UNAVAILABLE';

export type AutonomousEvidenceItem = {
  category: SystemEvidenceCategory;
  status: AutonomousEvidenceStatus;
  source_refs: string[];
  retrieved_at?: string;
  detail?: string;
};

export type AutonomousEvidenceAssessment = {
  complete: boolean;
  degraded: boolean;
  missing: SystemEvidenceCategory[];
  unverifiable: SystemEvidenceCategory[];
  next_stage: 'AUTONOMOUS_EVIDENCE_READY' | 'AUTONOMOUS_EVIDENCE_BLOCKED';
};

export function assessAutonomousEvidence(items: AutonomousEvidenceItem[]): AutonomousEvidenceAssessment {
  const byCategory = new Map(items.map(item => [item.category, item]));
  const missing = SYSTEM_OWNED_5DR_EVIDENCE_CATEGORIES.filter(category => !byCategory.has(category));
  const unverifiable = SYSTEM_OWNED_5DR_EVIDENCE_CATEGORIES.filter(category => {
    const item = byCategory.get(category);
    if (!item) return false;
    if (item.status === 'PENDING' || item.status === 'UNAVAILABLE') return true;
    return item.status === 'VERIFIED' && item.source_refs.length === 0;
  });
  const degraded = SYSTEM_OWNED_5DR_EVIDENCE_CATEGORIES.some(category => byCategory.get(category)?.status === 'DEGRADED');
  const complete = missing.length === 0 && unverifiable.length === 0;
  return {
    complete,
    degraded,
    missing,
    unverifiable,
    next_stage: complete ? 'AUTONOMOUS_EVIDENCE_READY' : 'AUTONOMOUS_EVIDENCE_BLOCKED'
  };
}

export function initialAutonomousEvidenceState(): AutonomousEvidenceItem[] {
  return SYSTEM_OWNED_5DR_EVIDENCE_CATEGORIES.map(category => ({
    category,
    status: 'PENDING',
    source_refs: []
  }));
}
