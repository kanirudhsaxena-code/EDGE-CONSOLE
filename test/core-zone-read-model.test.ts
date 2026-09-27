import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCoreZoneReadModel, assertCoreZoneSurfaceParity } from "../src/core-zone-read-model.js";

function fixture() {
  return {
    contract_version: "CORE_ZONE_SHADOW_V1",
    engine: "5DR",
    run_id: "g6-fixture-1",
    framework_version: "fixture",
    calibration_version: "fixture",
    run_role: "SHADOW",
    report_hash: "source-report-hash",
    lineage: {
      source_run_id: "source-1", source_report_hash: "source-report-hash", spec_version: "G6-A",
      issued_at: "2026-09-27T10:00:00.000Z", evidence_snapshot_id: "ev-1", production_isolated: true,
    },
    issuance: ["D","D+1","D+2","D+3","D+4"].map((horizon, i) => ({ horizon, target_session: `2026-09-${28+i}`, expected_centre: 25000+i, core_low: 24900+i, core_high: 25100+i, core_width_points: 200, core_width_pct: 0.8, outer_low: 24800+i, outer_high: 25200+i, regime: "FIXTURE", evidence_snapshot_id: "ev-1", created_at: "2026-09-27T10:00:00.000Z", verification_state: "SYNTHETIC_ENGINEERING_ONLY" })),
    learning_policy: { automatic_observation: true, automatic_promotion: false, user_decision_required: "APPROVE_REJECT_DEFER" },
  };
}

test("Console and ChatGPT canonical Core models have exact run/hash/version parity", () => {
  const stored = fixture();
  const consoleModel = buildCoreZoneReadModel(stored);
  const chatModel = buildCoreZoneReadModel(JSON.parse(JSON.stringify(stored)));
  assertCoreZoneSurfaceParity(consoleModel, chatModel);
  assert.equal(consoleModel.payload_hash, chatModel.payload_hash);
  assert.deepEqual((consoleModel.payload.issuance as Array<{horizon:string}>).map(x => x.horizon), ["D","D+1","D+2","D+3","D+4"]);
});

test("parity fails closed on any value deviation", () => {
  const a = buildCoreZoneReadModel(fixture());
  const changed = fixture();
  changed.issuance[2].expected_centre += 1;
  const b = buildCoreZoneReadModel(changed);
  assert.throws(() => assertCoreZoneSurfaceParity(a, b), /CORE_ZONE_SURFACE_PARITY_MISMATCH:payload_hash/);
});
