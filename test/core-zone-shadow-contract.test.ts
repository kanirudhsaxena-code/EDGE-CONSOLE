import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const schema = JSON.parse(readFileSync(new URL("../contracts/core-zone-shadow-v1.schema.json", import.meta.url), "utf8"));

test("G6 Core Zone is additive SHADOW-only with immutable provenance", () => {
  assert.equal(schema.properties.run_role.const, "SHADOW");
  assert.ok(schema.required.includes("lineage"));
  for (const field of ["source_run_id","source_report_hash","spec_version","issued_at","evidence_snapshot_id","production_isolated"])
    assert.ok(schema.properties.lineage.required.includes(field));
  assert.equal(schema.properties.lineage.properties.production_isolated.const, true);
});

test("G6 learning observes automatically but never promotes automatically", () => {
  const policy = schema.properties.learning_policy.properties;
  assert.equal(policy.automatic_observation.const, true);
  assert.equal(policy.automatic_promotion.const, false);
  assert.equal(policy.user_decision_required.const, "APPROVE_REJECT_DEFER");
});

test("both Core engines require exactly ordered D through D+4 and exclude D+5", () => {
  assert.equal(schema.properties.issuance.minItems, 5);
  assert.equal(schema.properties.issuance.maxItems, 5);
  assert.equal(schema.properties.issuance.items, false);
  assert.deepEqual(schema.properties.issuance.prefixItems.map((x: {$ref:string}) => x.$ref), [
    "#/$defs/horizonD", "#/$defs/horizonD1", "#/$defs/horizonD2", "#/$defs/horizonD3", "#/$defs/horizonD4"
  ]);
  assert.deepEqual(schema.properties.evaluation.items.properties.horizon.enum, ["D","D+1","D+2","D+3","D+4"]);
  assert.equal(JSON.stringify(schema).includes('"D+5"'), false);
});

test("G6 freezes full-session zone and centre/miss evaluation fields", () => {
  const required = schema.properties.evaluation.items.required;
  for (const field of ["session_open","session_high","session_low","session_close","core_interaction","core_close_hit","outer_interaction","outer_close_hit","centre_error","normalized_centre_error","miss_distance","width_normalized_miss","direction_hit","direction_zone_hit","scorable"])
    assert.ok(required.includes(field));
});
