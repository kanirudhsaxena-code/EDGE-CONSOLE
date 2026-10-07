import { evaluateMaturedBuild3Outcomes, type Build3OutcomeEvaluatorEnv } from './build-3-outcome-evaluator';
import { readBuild3TruthMetrics } from './build-3-truth-metrics';
import { evaluateMaturedBuild3Recommendations } from './build-3-recommendation-efficacy';
import { dispatchDueBuild3RecommendationIntradayTruth } from './build-3-recommendation-intraday-dispatch';
import { evaluateMaturedBuild3NoTrades } from './build-3-no-trade-efficacy';
import type { EngineDispatchEnv } from './engine-dispatch';

export const BUILD3_TRUTH_CRON='7,37 11 * * 1-5' as const;
export const BUILD3_TRUTH_SCHEDULER_VERSION='MDOS_BUILD_3_TRUTH_SCHEDULER_V1' as const;

export async function runBuild3TruthScheduledTick(
  env:Build3OutcomeEvaluatorEnv&EngineDispatchEnv,
  scheduledTime:number|Date,
):Promise<Record<string,unknown>>{
  const now=scheduledTime instanceof Date?scheduledTime:new Date(scheduledTime);
  if(Number.isNaN(now.getTime()))throw new Error('BUILD3_TRUTH_SCHEDULED_TIME_INVALID');
  const results=await evaluateMaturedBuild3Outcomes(env,{now,limit:100});
  const intradayDispatchResults=await dispatchDueBuild3RecommendationIntradayTruth(env,{now,limit:100});
  const recommendationResults=await evaluateMaturedBuild3Recommendations(env.DATABASE_URL,{now,limit:100});
  const noTradeResults=await evaluateMaturedBuild3NoTrades(env.DATABASE_URL,{now,limit:100});
  const truthMetrics=await readBuild3TruthMetrics(env.DATABASE_URL);
  const counts=results.reduce<Record<string,number>>((acc,row)=>{
    acc[row.status]=(acc[row.status]??0)+1;
    return acc;
  },{});
  return {
    status:'BUILD3_TRUTH_EVALUATION_TICK',
    scheduler_version:BUILD3_TRUTH_SCHEDULER_VERSION,
    scheduled_at:now.toISOString(),
    evaluated:results.length,
    counts,
    results,
    intraday_truth_dispatched:intradayDispatchResults.length,
    intraday_dispatch_results:intradayDispatchResults,
    recommendation_evaluated:recommendationResults.length,
    recommendation_results:recommendationResults,
    no_trade_evaluated:noTradeResults.length,
    no_trade_results:noTradeResults,
    truth_metrics:truthMetrics,
    trading_enabled:false,
    methodology_changed:false,
  };
}
