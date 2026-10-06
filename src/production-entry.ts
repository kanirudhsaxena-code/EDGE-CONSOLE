import mobile from './mobile-v1-entry';
import app from './index';
import { handleLearningGovernanceRequest } from './learning-governance';
import { handleP0CurrentRead } from './p0-current-read';
import { handleP0PerformanceRead } from './p0-performance-read';
import { handleP05drCanonicalHistoryRead } from './p0-5dr-canonical-history-read';
import { handleP0IpoCanonicalHistoryRead } from './p0-ipo-canonical-history-read';
import { handleP0CanonicalHistoryRead } from './p0-canonical-history-read';
import { gateCanonicalHistoryResponse } from './canonical-history-release-gate';
import { recoverBlocked5drAcquisition } from './5dr-acquisition-recovery';
import { runPreopenScheduledTick } from './preopen-scheduler';
import { progressPendingNormalStockLifecycles } from './router';
import { materializePendingBuild3StockForecasts } from './build-3-stock-materializer';
import { progressPendingBuild3NiftyRuns } from './mobile-v1-entry';\nimport { BUILD3_TRUTH_CRON, runBuild3TruthScheduledTick } from './build-3-outcome-scheduler';

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
 * owner-facing current, canonical-performance and exact historical retrieval are
 * deterministic. These shims are read-only and do not modify scoring, canonical
 * selection, efficacy populations, recommendations, Market Trust, or trading behavior.
 *
 * Exact historical readers may expose governed audit evidence, but selected
 * canonicals pass a shared release firewall before HTTP success. Until the
 * persisted P0-11 presentation snapshot is attached and shared P0-12 identity
 * validation passes, selected reads fail closed as audit-only.
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

    // Each engine keeps an isolated production store but answers through the
    // same owner-only P0-12 route. Engine-specific adapters get first refusal
    // before the Stocks fallback reader; selected responses are contract-gated.
    const p05drCanonicalHistory = await handleP05drCanonicalHistoryRead(request, env);
    if (p05drCanonicalHistory) return gateCanonicalHistoryResponse(p05drCanonicalHistory);

    const p0IpoCanonicalHistory = await handleP0IpoCanonicalHistoryRead(request, env);
    if (p0IpoCanonicalHistory) return gateCanonicalHistoryResponse(p0IpoCanonicalHistory);

    const p0CanonicalHistory = await handleP0CanonicalHistoryRead(request, env);
    if (p0CanonicalHistory) return gateCanonicalHistoryResponse(p0CanonicalHistory);

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

      return mobile.fetch(request, env);
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
    return mobile.fetch(request, env);
  },
  async scheduled(controller: ScheduledController, env: any, ctx: ExecutionContext): Promise<void> {
    const cron=String((controller as any).cron??'');
    if(cron===BUILD3_TRUTH_CRON){
      ctx.waitUntil((async()=>{
        const result=await runBuild3TruthScheduledTick(env,controller.scheduledTime);
        console.log(JSON.stringify(result));
      })());
      return;
    }
    if(cron==='7,22,37,52 * * * 1-5'){
      ctx.waitUntil((async()=>{
        const [normalResults,stockBuild3,niftyBuild3]=await Promise.all([
          progressPendingNormalStockLifecycles(env,12),
          materializePendingBuild3StockForecasts(env,12),
          progressPendingBuild3NiftyRuns(env,12),
        ]);
        console.log(JSON.stringify({
          status:'BUILD3_COMPLETION_GUARD',
          normal_lifecycles:{count:normalResults.length,results:normalResults},
          stock_forecasts:{count:stockBuild3.length,results:stockBuild3},
          nifty_forecasts:{count:niftyBuild3.length,results:niftyBuild3},
          trading_enabled:false
        }));
      })());
      return;
    }
    ctx.waitUntil(runPreopenScheduledTick(env, new Date(), controller.scheduledTime));
  },
};
