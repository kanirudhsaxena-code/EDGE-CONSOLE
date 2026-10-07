import {
  BUILD3_ZONE_CHALLENGER_TOLERANCE_PCT,
  BUILD3_ZONE_PRIMARY_TOLERANCE_PCT,
  type Build3RecommendationEfficacySummary,
} from './build-3-efficacy-contract';
import { readBuild3RecommendationEfficacySummary } from './build-3-recommendation-efficacy';
import { readBuild3TruthMetrics, type Build3TruthMetrics } from './build-3-truth-metrics';
import { readBuild3NoTradeOutcomeSummary, summarizeBuild3NoTradeOutcomes, type Build3NoTradeOutcomeSummary } from './build-3-no-trade-efficacy';

export const BUILD3_SCORECARD_VERSION='MDOS_BUILD_3_SCORECARD_V1' as const;

export type Build3Scorecard={
  version:typeof BUILD3_SCORECARD_VERSION;
  generated_at:string;
  scope:'ALL'|'5DR'|'EDGE_STOCKS';
  diagnostic_only:true;
  official_efficacy_mutated:false;
  production_methodology_changed:false;
  zone_contract:{
    primary_tolerance_pct:typeof BUILD3_ZONE_PRIMARY_TOLERANCE_PCT;
    challenger_tolerance_pct:typeof BUILD3_ZONE_CHALLENGER_TOLERANCE_PCT;
    headline_hit_definition:'ACTUAL_CLOSE_INSIDE_FROZEN_ZONE_INCLUSIVE';
    deviation_definition:'MAX_HIGH_LOW_BREACH_DIVIDED_BY_SAME_ZONE_WIDTH';
    outer_core_separate:true;
  };
  forecast:Build3TruthMetrics;
  recommendation:Build3RecommendationEfficacySummary;
  no_trade:Build3NoTradeOutcomeSummary;
};

export function buildBuild3Scorecard(input:{
  truth:Build3TruthMetrics;
  recommendation:Build3RecommendationEfficacySummary;
  no_trade?:Build3NoTradeOutcomeSummary;
  scope?:'ALL'|'5DR'|'EDGE_STOCKS';
  generated_at?:string;
}):Build3Scorecard{
  const generated=input.generated_at??new Date().toISOString();
  if(Number.isNaN(Date.parse(generated)))throw new Error('BUILD3_SCORECARD_TIMESTAMP_INVALID');
  return {
    version:BUILD3_SCORECARD_VERSION,
    generated_at:new Date(generated).toISOString(),
    scope:input.scope??'ALL',
    diagnostic_only:true,
    official_efficacy_mutated:false,
    production_methodology_changed:false,
    zone_contract:{
      primary_tolerance_pct:BUILD3_ZONE_PRIMARY_TOLERANCE_PCT,
      challenger_tolerance_pct:BUILD3_ZONE_CHALLENGER_TOLERANCE_PCT,
      headline_hit_definition:'ACTUAL_CLOSE_INSIDE_FROZEN_ZONE_INCLUSIVE',
      deviation_definition:'MAX_HIGH_LOW_BREACH_DIVIDED_BY_SAME_ZONE_WIDTH',
      outer_core_separate:true,
    },
    forecast:input.truth,
    recommendation:input.recommendation,
    no_trade:input.no_trade??summarizeBuild3NoTradeOutcomes([]),
  };
}

export async function readBuild3Scorecard(
  databaseUrl:string|undefined,
  engine?:'5DR'|'EDGE_STOCKS',
):Promise<Build3Scorecard>{
  const [truth,recommendation,noTrade]=await Promise.all([
    readBuild3TruthMetrics(databaseUrl,engine),
    readBuild3RecommendationEfficacySummary(databaseUrl,engine),
    readBuild3NoTradeOutcomeSummary(databaseUrl,engine),
  ]);
  return buildBuild3Scorecard({
    truth,recommendation,no_trade:noTrade,
    scope:engine??'ALL',
  });
}
