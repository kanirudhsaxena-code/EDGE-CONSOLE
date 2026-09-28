import {
  assertPresentationSnapshot,
  semanticPresentationHash,
  type PresentationSnapshot,
} from './presentation-snapshot';

type JsonRecord = Record<string, unknown>;

const HEX64 = /^[0-9a-f]{64}$/;
const REQUIRED_SECTIONS = [
  'TABLE_1_5DR_ASSESSMENT_EFFICACY',
  'TABLE_2_CURRENT_5DR_RUN',
] as const;

function record(value: unknown, error: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(error);
  return value as JsonRecord;
}

function id(value: unknown, error: string): string {
  if ((typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') || String(value).trim() === '') {
    throw new Error(error);
  }
  return String(value);
}

function exactId(value: unknown, expected: string, error: string): void {
  if (id(value, error) !== expected) throw new Error(error);
}

/**
 * Convert one persisted 5DR presentation row into the shared P0-11 contract.
 *
 * This validates both the outer immutable presentation hash and the inner source
 * identity/hash. A hash-valid row that points at the wrong run, forecast,
 * assessment, daily path, component rows, or execution plan is rejected.
 */
export function validate5drPersistedPresentation(
  rowValue: unknown,
  expected: { runId: string; forecastId: string },
): PresentationSnapshot {
  const row = record(rowValue, 'P0_11_5DR_PRESENTATION_ROW_INVALID');
  if (row.presentation_contract_version !== 'P0_11_PRESENTATION_V1') {
    throw new Error('P0_11_5DR_PRESENTATION_VERSION_MISMATCH');
  }
  if (row.engine !== '5DR') throw new Error('P0_11_5DR_PRESENTATION_ENGINE_MISMATCH');
  exactId(row.run_id, expected.runId, 'P0_11_5DR_PRESENTATION_RUN_MISMATCH');
  exactId(row.result_id, expected.forecastId, 'P0_11_5DR_PRESENTATION_FORECAST_MISMATCH');
  if (row.checkpoint_id !== null && row.checkpoint_id !== undefined) {
    throw new Error('P0_11_5DR_PRESENTATION_CHECKPOINT_MUST_BE_NULL');
  }
  if (row.governance_state !== 'SELECTED') {
    throw new Error('P0_11_5DR_PRESENTATION_GOVERNANCE_MISMATCH');
  }
  if (typeof row.source_payload_hash !== 'string' || !HEX64.test(row.source_payload_hash)) {
    throw new Error('P0_11_5DR_SOURCE_HASH_INVALID');
  }
  if (typeof row.presentation_hash !== 'string' || !HEX64.test(row.presentation_hash)) {
    throw new Error('P0_11_5DR_PRESENTATION_HASH_INVALID');
  }

  if (!Array.isArray(row.sections) || row.sections.length !== 2) {
    throw new Error('P0_11_5DR_SECTION_COUNT_MISMATCH');
  }
  const first = record(row.sections[0], 'P0_11_5DR_SECTION_1_INVALID');
  const second = record(row.sections[1], 'P0_11_5DR_SECTION_2_INVALID');
  if (first.name !== REQUIRED_SECTIONS[0] || second.name !== REQUIRED_SECTIONS[1]) {
    throw new Error('P0_11_5DR_SECTION_ORDER_MISMATCH');
  }

  const assessment = record(first.assessment_snapshot, 'P0_11_5DR_ASSESSMENT_MISSING');
  exactId(assessment.run_id, expected.runId, 'P0_11_5DR_ASSESSMENT_RUN_MISMATCH');
  exactId(assessment.forecast_id, expected.forecastId, 'P0_11_5DR_ASSESSMENT_FORECAST_MISMATCH');
  if (assessment.completeness_status !== 'COMPLETE') {
    throw new Error('P0_11_5DR_ASSESSMENT_INCOMPLETE');
  }

  const run = record(second.run, 'P0_11_5DR_RUN_MISSING');
  exactId(run.run_id, expected.runId, 'P0_11_5DR_EMBEDDED_RUN_MISMATCH');

  const forecast = record(second.forecast, 'P0_11_5DR_FORECAST_MISSING');
  exactId(forecast.run_id, expected.runId, 'P0_11_5DR_EMBEDDED_FORECAST_RUN_MISMATCH');
  exactId(forecast.forecast_id, expected.forecastId, 'P0_11_5DR_EMBEDDED_FORECAST_MISMATCH');

  if (!Array.isArray(second.daily_forecasts) || second.daily_forecasts.length !== 5) {
    throw new Error('P0_11_5DR_DAILY_PATH_INCOMPLETE');
  }
  second.daily_forecasts.forEach((value, index) => {
    const daily = record(value, 'P0_11_5DR_DAILY_ROW_INVALID');
    exactId(daily.forecast_id, expected.forecastId, 'P0_11_5DR_DAILY_FORECAST_MISMATCH');
    if (Number(daily.day_number) !== index + 1) throw new Error('P0_11_5DR_DAILY_PATH_ORDER_MISMATCH');
  });

  if (!Array.isArray(second.component_scores)) throw new Error('P0_11_5DR_COMPONENTS_INVALID');
  second.component_scores.forEach((value) => {
    const component = record(value, 'P0_11_5DR_COMPONENT_ROW_INVALID');
    exactId(component.forecast_id, expected.forecastId, 'P0_11_5DR_COMPONENT_FORECAST_MISMATCH');
  });

  const executionPlan = record(second.execution_plan, 'P0_11_5DR_EXECUTION_PLAN_MISSING');
  exactId(executionPlan.forecast_id, expected.forecastId, 'P0_11_5DR_EXECUTION_FORECAST_MISMATCH');

  const currentRun = {
    run,
    forecast,
    daily_forecasts: second.daily_forecasts,
    component_scores: second.component_scores,
    execution_plan: executionPlan,
  };
  const recomputedSourceHash = semanticPresentationHash({
    assessment_snapshot: assessment,
    current_run: currentRun,
  });
  if (recomputedSourceHash !== row.source_payload_hash) {
    throw new Error('P0_11_5DR_SOURCE_HASH_MISMATCH');
  }

  const snapshot: PresentationSnapshot = {
    presentation_contract_version: 'P0_11_PRESENTATION_V1',
    engine: '5DR',
    identity: {
      run_id: expected.runId,
      result_id: expected.forecastId,
      checkpoint_id: null,
    },
    governance_state: 'SELECTED',
    sections: row.sections as JsonRecord[],
    source_payload_hash: row.source_payload_hash,
    presentation_hash: row.presentation_hash,
  };
  assertPresentationSnapshot(snapshot);
  return snapshot;
}
