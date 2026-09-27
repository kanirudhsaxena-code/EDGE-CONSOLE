import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCoreZoneShadowContract, CORE_ZONE_HORIZONS } from "../src/core-zone-shadow";

function valid(engine: "5DR" | "EDGE_STOCKS") {
  return {
    run_role: "SHADOW",
    engine,
    issuance: CORE_ZONE_HORIZONS.map((horizon) => ({ horizon })),
    lineage: {
      source_run_id: "run-1",
      source_report_hash: "hash-1",
      spec_version: "G6_CORE_SHADOW_V1",
      issued_at: "2026-09-27T00:00:00Z",
      evidence_snapshot_id: "evidence-1",
      production_isolated: true,
    },
    learning_policy: {
      automatic_observation: true,
      automatic_promotion: false,
      user_decision_required: "APPROVE_REJECT_DEFER",
    },
  };
}

for (const engine of ["5DR", "EDGE_STOCKS"] as const) {
  test(`${engine} accepts only the aligned five-horizon Core SHADOW envelope`, () => {
    assert.doesNotThrow(() => assertCoreZoneShadowContract(valid(engine)));
  });

  test(`${engine} rejects D+5`, () => {
    const p = valid(engine);
    p.issuance[4] = { horizon: "D+5" as never };
    assert.throws(() => assertCoreZoneShadowContract(p), /CORE_ZONE_HORIZON_ORDER_INVALID|CORE_ZONE_D5_FORBIDDEN/);
  });

  test(`${engine} rejects omission of D`, () => {
    const p = valid(engine);
    p.issuance = p.issuance.slice(1);
    assert.throws(() => assertCoreZoneShadowContract(p), /CORE_ZONE_HORIZON_COUNT_INVALID/);
  });

  test(`${engine} rejects reordered horizons`, () => {
    const p = valid(engine);
    [p.issuance[0], p.issuance[1]] = [p.issuance[1], p.issuance[0]];
    assert.throws(() => assertCoreZoneShadowContract(p), /CORE_ZONE_HORIZON_ORDER_INVALID/);
  });
}

test("Core SHADOW cannot cross production isolation or auto-promote", () => {
  const isolated = valid("5DR");
  isolated.lineage.production_isolated = false;
  assert.throws(() => assertCoreZoneShadowContract(isolated), /CORE_ZONE_PRODUCTION_ISOLATION_REQUIRED/);

  const promotion = valid("EDGE_STOCKS");
  promotion.learning_policy.automatic_promotion = true;
  assert.throws(() => assertCoreZoneShadowContract(promotion), /CORE_ZONE_LEARNING_POLICY_INVALID/);
});
