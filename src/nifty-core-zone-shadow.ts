import { createHash } from "node:crypto";
import { CORE_ZONE_HORIZONS, assertCoreZoneShadowContract } from "./core-zone-shadow.js";

type HorizonInput = {
  horizon: (typeof CORE_ZONE_HORIZONS)[number];
  target_session: string;
  expected_centre: number;
  core_low: number;
  core_high: number;
  outer_low: number;
  outer_high: number;
  calibration_version: string;
};

export type NiftyCoreZoneShadowInput = {
  run_id: string;
  source_report_hash: string;
  evidence_snapshot_id: string;
  issued_at: string;
  spec_version: string;
  evidence_verified: boolean;
  synthetic_fixture?: boolean;
  issuance: HorizonInput[];
};

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** G6-B SHADOW-only adapter. It consumes already-calibrated Core values; it never calibrates or changes production. */
export function buildNiftyCoreZoneShadow(input: NiftyCoreZoneShadowInput) {
  if (!input.evidence_verified || input.synthetic_fixture === true) throw new Error("CORE_ZONE_REAL_EVIDENCE_REQUIRED");
  if (!input.run_id || !input.source_report_hash || !input.evidence_snapshot_id || !input.spec_version || !input.issued_at)
    throw new Error("CORE_ZONE_NIFTY_LINEAGE_INCOMPLETE");
  if (input.issuance.length !== CORE_ZONE_HORIZONS.length) throw new Error("CORE_ZONE_HORIZON_COUNT_INVALID");

  const issuance = input.issuance.map((row, index) => {
    if (row.horizon !== CORE_ZONE_HORIZONS[index]) throw new Error("CORE_ZONE_HORIZON_ORDER_INVALID");
    for (const value of [row.expected_centre, row.core_low, row.core_high, row.outer_low, row.outer_high]) {
      if (!Number.isFinite(value)) throw new Error("CORE_ZONE_NIFTY_NUMERIC_INVALID");
    }
    if (!(row.outer_low <= row.core_low && row.core_low <= row.expected_centre && row.expected_centre <= row.core_high && row.core_high <= row.outer_high))
      throw new Error("CORE_ZONE_NIFTY_GEOMETRY_INVALID");
    if (!row.target_session || !row.calibration_version) throw new Error("CORE_ZONE_NIFTY_ROW_LINEAGE_INCOMPLETE");
    return Object.freeze({ ...row, core_width_points: row.core_high - row.core_low, core_width_percent: ((row.core_high - row.core_low) / row.expected_centre) * 100 });
  });

  const report_hash = stableHash({ source_report_hash: input.source_report_hash, evidence_snapshot_id: input.evidence_snapshot_id, issuance });
  const payload = Object.freeze({
    run_id: `core-nifty-${input.run_id}`,
    engine: "5DR" as const,
    run_role: "SHADOW" as const,
    contract_version: input.spec_version,
    report_hash,
    issuance,
    lineage: Object.freeze({ source_run_id: input.run_id, source_report_hash: input.source_report_hash, spec_version: input.spec_version, issued_at: input.issued_at, evidence_snapshot_id: input.evidence_snapshot_id, production_isolated: true }),
    learning_policy: Object.freeze({ automatic_observation: true, automatic_promotion: false, user_decision_required: "APPROVE_REJECT_DEFER" }),
  });
  assertCoreZoneShadowContract(payload);
  return payload;
}
