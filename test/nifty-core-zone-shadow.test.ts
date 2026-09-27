import test from "node:test";
import assert from "node:assert/strict";
import { buildNiftyCoreZoneShadow } from "../src/nifty-core-zone-shadow.js";

const horizons = ["D", "D+1", "D+2", "D+3", "D+4"] as const;
const base = {
  run_id: "nifty-canonical-1",
  source_report_hash: "a".repeat(64),
  evidence_snapshot_id: "ev-1",
  issued_at: "2026-09-28T03:00:00+05:30",
  spec_version: "G6-Core-Shadow-2026-09-26",
  evidence_verified: true,
  issuance: horizons.map((horizon, i) => ({ horizon, target_session: `2026-10-0${i + 1}`, expected_centre: 25000 + i, core_low: 24950 + i, core_high: 25050 + i, outer_low: 24800 + i, outer_high: 25200 + i, calibration_version: "nifty-core-v0-shadow" })),
};

test("builds exact D:D+4 NIFTY SHADOW payload with learning governance", () => {
  const result = buildNiftyCoreZoneShadow(base);
  assert.deepEqual(result.issuance.map((x) => x.horizon), horizons);
  assert.equal(result.engine, "5DR");
  assert.equal(result.run_role, "SHADOW");
  assert.equal(result.lineage.production_isolated, true);
  assert.equal(result.learning_policy.automatic_promotion, false);
});

test("fails closed on D+5 or missing D", () => {
  const d5 = structuredClone(base) as any;
  d5.issuance[0].horizon = "D+5";
  assert.throws(() => buildNiftyCoreZoneShadow(d5), /HORIZON_ORDER/);
  const missingD = structuredClone(base) as any;
  missingD.issuance = missingD.issuance.slice(1);
  assert.throws(() => buildNiftyCoreZoneShadow(missingD), /HORIZON_COUNT/);
});

test("refuses synthetic or unverified evidence", () => {
  assert.throws(() => buildNiftyCoreZoneShadow({ ...base, evidence_verified: false }), /REAL_EVIDENCE/);
  assert.throws(() => buildNiftyCoreZoneShadow({ ...base, synthetic_fixture: true }), /REAL_EVIDENCE/);
});

test("does not fabricate invalid Core geometry", () => {
  const bad = structuredClone(base) as any;
  bad.issuance[2].core_low = bad.issuance[2].expected_centre + 1;
  assert.throws(() => buildNiftyCoreZoneShadow(bad), /GEOMETRY/);
});
