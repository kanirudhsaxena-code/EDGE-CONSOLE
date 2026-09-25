import mobile from './mobile-v1-entry';
import app from './index';
import { handleLearningGovernanceRequest } from './learning-governance';
import { handleP0CurrentRead } from './p0-current-read';
import { handleP0PerformanceRead } from './p0-performance-read';
import { recoverBlocked5drAcquisition } from './5dr-acquisition-recovery';

/**
 * Production entrypoint shim.
 *
 * The mobile-first worker owns the current Console orchestration routes, while
 * the frozen 5DR result-persistence handler and immutable Learning Lab import
 * handlers still live in src/index.ts. G4 governance decisions are isolated in
 * src/learning-governance.ts and may authorize build/validation only; they never
 * authorize production promotion or mutate canonical selection/scoring rules.
 *
 * P0 operational-recovery reads are handled before the legacy routing stack so
 * owner-facing current and canonical-performance retrieval is deterministic.
 * These shims are read-only and do not modify scoring, canonical selection,
 * efficacy populations, recommendations, Market Trust, or trading behavior.
 *
 * A blocked 5DR automated-acquisition request gets one governed recovery check
 * after the normal ownership-gated mobile handler responds. This lets a later
 * successful pinned acquisition retry advance from BLOCKED to READY without
 * depending on an unauthenticated cross-repo callback. Evidence is recovered
 * from the immutable GitHub workflow marker and revalidated before persistence.
 */
export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const p0Current = await handleP0CurrentRead(request, env);
    if (p0Current) return p0Current;

    const p0Performance = await handleP0PerformanceRead(request, env);
    if (p0Performance) return p0Performance;

    const url = new URL(request.url);
    const resume = url.pathname.match(/^\/api\/5dr\/run-requests\/([^/]+)\/resume-processing$/);
    if (resume && request.method === 'POST') {
      const first = await mobile.fetch(request.clone() as any, env);
      if (first.status !== 409) return first;

      let body: Record<string, unknown> = {};
      try {
        const parsed = await first.clone().json();
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
      } catch {}

      if (body.adapter_stage !== 'AUTOMATED_MARKET_DATA_BLOCKED') return first;

      const requestId = decodeURIComponent(resume[1]);
      const recovery = await recoverBlocked5drAcquisition(env, requestId);
      if (!recovery.recovered) return first;

      return mobile.fetch(request as any, env);
    }

    if (
      url.pathname === '/api/learning-lab/governance-view' ||
      url.pathname === '/api/learning-lab/candidate-decision'
    ) {
      return handleLearningGovernanceRequest(request, env);
    }
    if (
      (url.pathname === '/api/5dr/runs' && request.method === 'POST') ||
      url.pathname.startsWith('/api/learning-lab/')
    ) {
      return app.fetch(request, env);
    }
    return mobile.fetch(request as any, env);
  },
};
