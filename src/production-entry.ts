import mobile from './mobile-v1-entry';
import app from './index';
import { handleLearningGovernanceRequest } from './learning-governance';

/**
 * Production entrypoint shim.
 *
 * The mobile-first worker owns the current Console orchestration routes, while
 * the frozen 5DR result-persistence handler and immutable Learning Lab import
 * handlers still live in src/index.ts. G4 governance decisions are isolated in
 * src/learning-governance.ts and may authorize build/validation only; they never
 * authorize production promotion or mutate canonical selection/scoring rules.
 */
export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
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
    return mobile.fetch(request, env);
  },
};
