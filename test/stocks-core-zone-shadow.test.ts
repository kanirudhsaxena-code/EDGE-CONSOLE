import test from "node:test";
import assert from "node:assert/strict";
import { buildStocksCoreZoneShadow } from "../src/stocks-core-zone-shadow.js";

const horizons = ["D", "D+1", "D+2", "D+3", "D+4"] as const;
const base = {
  run_id: "edge-ltf-canonical-1",
  ticker: "LTF",
  source_report_hash: "b".repeat(64),
  evidence_snapshot_id: "ev-stock-1",
  issued_at: "2026-09-28T08:40:00+05:30",
  spec_version: "G6-Core-Shadow-2026-09-26",
  evidence_verified: true,
  issuance: horizons.map((horizon, i) => ({ horizon, target_session: `2026-10-0${i + 1}`, expected_centre: 270 + i, core_low: 268 + i, core_high: 272 + i, outer_low: 264 + i, outer_high: 276 + i, calibration_version: "stocks-core-v0-shadow" })),
};

test("builds exact D:D+4 Stocks SHADOW payload with learning governance", () => {
  const result = buildStocksCoreZoneShadow(base);
  assert.deepEqual(result.issuance.map((x) => x.horizon), horizons);
  assert.equal(result.engine, "EDGE_STOCKS");
  assert.equal(result.ticker, "LTF");
  assert.equal(result.run_role, "SHADOW");
  assert.equal(result.lineage.production_isolated, true);
  assert.equal(result.learning_policy.automatic_observation, true);
  assert.equal(result.learning_policy.automatic_promotion, false);
});

test("fails closed on D+5, missing D or wrong order", () => {
  const d5 = structuredClone(base) as any;
  d5.issuance[4].horizon = "D+5";
  assert.throws(() => buildStocksCoreZoneShadow(d5), /HORIZON_ORDER/);
  const missingD = structuredClone(base) as any;
  missingD.issuance = missingD.issuance.slice(1);
  assert.throws(() => buildStocksCoreZoneShadow(missingD), /HORIZON_COUNT/);
  const wrongOrder = structuredClone(base) as any;
  [wrongOrder.issuance[1], wrongOrder.issuance[2]] = [wrongOrder.issuance[2], wrongOrder.issuance[1]];
  assert.throws(() => buildStocksCoreZoneShadow(wrongOrder), /HORIZON_ORDER/);
});

test("refuses synthetic or unverified evidence", () => {
  assert.throws(() => buildStocksCoreZoneShadow({ ...base, evidence_verified: false }), /REAL_EVIDENCE/);
  assert.throws(() => buildStocksCoreZoneShadow({ ...base, synthetic_fixture: true }), /REAL_EVIDENCE/);
});

test("does not fabricate invalid Core geometry", () => {
  const bad = structuredClone(base) as any;
  bad.issuance[2].core_low = bad.issuance[2].expected_centre + 1;
  assert.throws(() => buildStocksCoreZoneShadow(bad), /GEOMETRY/);
});
