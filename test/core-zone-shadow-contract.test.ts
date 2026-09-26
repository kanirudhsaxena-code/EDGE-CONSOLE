import { describe, expect, it } from "vitest";
import schema from "../contracts/core-zone-shadow-v1.schema.json";

describe("G6 Core Zone SHADOW readiness contract", () => {
  it("is additive SHADOW-only and requires immutable provenance", () => {
    expect(schema.properties.run_role.const).toBe("SHADOW");
    expect(schema.required).toContain("lineage");
    expect(schema.properties.lineage.required).toEqual(expect.arrayContaining([
      "source_run_id", "source_report_hash", "spec_version", "issued_at",
      "evidence_snapshot_id", "production_isolated"
    ]));
    expect(schema.properties.lineage.properties.production_isolated.const).toBe(true);
  });

  it("requires automatic observation but forbids automatic promotion", () => {
    const policy = schema.properties.learning_policy.properties;
    expect(policy.automatic_observation.const).toBe(true);
    expect(policy.automatic_promotion.const).toBe(false);
    expect(policy.user_decision_required.const).toBe("APPROVE_REJECT_DEFER");
  });

  it("keeps five ordered engine horizons without copying stock horizons to NIFTY", () => {
    expect(schema.properties.issuance.minItems).toBe(5);
    expect(schema.properties.issuance.maxItems).toBe(5);
    const encoded = JSON.stringify(schema.allOf);
    expect(encoded).toContain("5DR");
    expect(encoded).toContain("D+5");
    expect(encoded).toContain("EDGE_STOCKS");
  });

  it("freezes full-session zone and centre/miss evaluation fields", () => {
    const required = schema.properties.evaluation.items.required;
    expect(required).toEqual(expect.arrayContaining([
      "session_open", "session_high", "session_low", "session_close",
      "core_interaction", "core_close_hit", "outer_interaction", "outer_close_hit",
      "centre_error", "normalized_centre_error", "miss_distance",
      "width_normalized_miss", "direction_hit", "direction_zone_hit", "scorable"
    ]));
  });
});
