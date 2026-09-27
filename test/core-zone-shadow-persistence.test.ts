import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sql = readFileSync(new URL("../migrations/010_core_zone_shadow.sql", import.meta.url), "utf8");

test("Core Zone persistence is additive SHADOW-only and horizon locked", () => {
  assert.match(sql, /core_zone_shadow_runs/);
  assert.match(sql, /engine IN \('5DR', 'EDGE_STOCKS'\)/);
  assert.match(sql, /\["D","D\+1","D\+2","D\+3","D\+4"\]/);
  assert.match(sql, /NOT \(horizons \? 'D\+5'\)/);
  assert.match(sql, /production_isolated = TRUE/);
  assert.match(sql, /automatic_observation = TRUE/);
  assert.match(sql, /automatic_promotion = FALSE/);
  assert.match(sql, /APPROVE_REJECT_DEFER/);
});

test("Core Zone persistence keeps lineage and exact payload hash", () => {
  for (const field of ["source_run_id", "source_report_hash", "evidence_snapshot_id", "spec_version", "issued_at", "payload_sha256"]) {
    assert.match(sql, new RegExp(`${field} TEXT NOT NULL|${field} TIMESTAMPTZ NOT NULL`));
  }
  assert.match(sql, /length\(payload_sha256\) = 64/);
  assert.match(sql, /UNIQUE INDEX[\s\S]*source_run_id, engine, spec_version/);
});
