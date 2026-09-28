import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPresentationSnapshot, semanticPresentationHash } from '../src/presentation-snapshot';
import { validate5drPersistedPresentation } from '../src/p0-5dr-presentation-read';

function fixture() {
  const assessment = {
    assessment_snapshot_id: 9,
    run_id: 42,
    forecast_id: 'forecast-42',
    output_contract_version: '5DR_V2_1_2',
    completeness_status: 'COMPLETE',
  };
  const run = { run_id: 42, command_type: '5DR', status: 'COMMITTED' };
  const forecast = { forecast_id: 'forecast-42', run_id: 42, output_contract_version: '5DR_V2_1_2' };
  const daily_forecasts = [1, 2, 3, 4, 5].map((day_number) => ({
    forecast_id: 'forecast-42', day_number, bias: 'RANGE', probability: 50,
  }));
  const component_scores = ['PRICE_STRUCTURE', 'PVPO', 'PARTICIPATION', 'MACRO_CATALYSTS'].map((component) => ({
    forecast_id: 'forecast-42', component, component_score: 0,
  }));
  const execution_plan = { forecast_id: 'forecast-42', instrument: 'NONE', execution_edge: 20 };
  const currentRun = { run, forecast, daily_forecasts, component_scores, execution_plan };
  const sourcePayloadHash = semanticPresentationHash({ assessment_snapshot: assessment, current_run: currentRun });
  const snapshot = buildPresentationSnapshot({
    engine: '5DR',
    run_id: '42',
    result_id: 'forecast-42',
    governance_state: 'SELECTED',
    source_payload_hash: sourcePayloadHash,
    sections: [
      { name: 'TABLE_1_5DR_ASSESSMENT_EFFICACY', assessment_snapshot: assessment },
      { name: 'TABLE_2_CURRENT_5DR_RUN', ...currentRun },
    ],
  });
  return {
    presentation_contract_version: snapshot.presentation_contract_version,
    engine: snapshot.engine,
    run_id: 42,
    result_id: 'forecast-42',
    checkpoint_id: null,
    governance_state: snapshot.governance_state,
    sections: snapshot.sections,
    source_payload_hash: snapshot.source_payload_hash,
    presentation_hash: snapshot.presentation_hash,
  };
}

const expected = { runId: '42', forecastId: 'forecast-42' };

test('validates exact persisted 5DR P0-11 presentation and both hashes', () => {
  const snapshot = validate5drPersistedPresentation(fixture(), expected);
  assert.equal(snapshot.identity.run_id, '42');
  assert.equal(snapshot.identity.result_id, 'forecast-42');
  assert.equal(snapshot.governance_state, 'SELECTED');
  assert.equal(snapshot.sections.length, 2);
});

test('fails closed on outer identity, governance and checkpoint mismatch', () => {
  assert.throws(() => validate5drPersistedPresentation({ ...fixture(), run_id: 41 }, expected), /RUN_MISMATCH/);
  assert.throws(() => validate5drPersistedPresentation({ ...fixture(), result_id: 'other' }, expected), /FORECAST_MISMATCH/);
  assert.throws(() => validate5drPersistedPresentation({ ...fixture(), governance_state: 'REJECTED' }, expected), /GOVERNANCE_MISMATCH/);
  assert.throws(() => validate5drPersistedPresentation({ ...fixture(), checkpoint_id: 'D+1' }, expected), /CHECKPOINT_MUST_BE_NULL/);
});

test('fails closed on section order and embedded identity mismatch', () => {
  const row = fixture();
  assert.throws(
    () => validate5drPersistedPresentation({ ...row, sections: [...row.sections].reverse() }, expected),
    /SECTION_ORDER_MISMATCH/,
  );

  const sections = structuredClone(row.sections) as Record<string, unknown>[];
  const second = sections[1] as Record<string, unknown>;
  const daily = second.daily_forecasts as Record<string, unknown>[];
  daily[2].forecast_id = 'wrong-forecast';
  assert.throws(
    () => validate5drPersistedPresentation({ ...row, sections }, expected),
    /DAILY_FORECAST_MISMATCH/,
  );
});

test('fails closed on source hash and outer presentation hash tampering', () => {
  const row = fixture();
  assert.throws(
    () => validate5drPersistedPresentation({ ...row, source_payload_hash: '0'.repeat(64) }, expected),
    /SOURCE_HASH_MISMATCH/,
  );
  assert.throws(
    () => validate5drPersistedPresentation({ ...row, presentation_hash: '0'.repeat(64) }, expected),
    /PRESENTATION_HASH_MISMATCH/,
  );
});

test('reader only marks shared canonical validation PASSED after persisted presentation validation', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile('src/p0-5dr-canonical-history-read.ts', 'utf8');
  assert.match(source, /from presentation_snapshots/);
  assert.match(source, /validate5drPersistedPresentation\(presentationRows\[0\]/);
  assert.match(source, /canonical_contract_validation: presentationAvailable \? 'PASSED'/);
  assert.match(source, /release_eligible: presentationAvailable/);
  assert.match(source, /NOT_AVAILABLE_NO_PERSISTED_SNAPSHOT/);
});
