import { evaluateMaturedBuild3Outcomes, type Build3OutcomeEvaluatorEnv } from './build-3-outcome-evaluator';
import { readBuild3TruthMetrics } from './build-3-truth-metrics';

export const BUILD3_TRUTH_CRON='7,37 11 * * 1-5' as const;
export const BUILD3_TRUTH_SCHEDULER_VERSION='MDOS_BUILD_3_TRUTH_SCHEDULER_V1' as const;

export async function runBuild3TruthScheduledTick(
  env:Build3OutcomeEvaluatorEnv,
  scheduledTime:number|Date,
):Promise<Record<string,unknown>>{
  const now=scheduledTime instanceof Date?scheduledTime:new Date(scheduledTime);
  if(Number.isNaN(now.getTime()))throw new Error('BUILD3_TRUTH_SCHEDULED_TIME_INVALID');
  const results=await evaluateMaturedBuild3Outcomes(env,{now,limit:100});
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
    truth_metrics:truthMetrics,
    trading_enabled:false,
    methodology_changed:false,
  };
}
