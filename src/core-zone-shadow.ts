export const CORE_ZONE_HORIZONS = ["D", "D+1", "D+2", "D+3", "D+4"] as const;
export type CoreZoneHorizon = (typeof CORE_ZONE_HORIZONS)[number];
export type CoreZoneEngine = "5DR" | "EDGE_STOCKS";

export class CoreZoneContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoreZoneContractError";
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Runtime fail-closed guard for G6/Core SHADOW payloads.
 * This is intentionally independent of production EDGE methodology: it only
 * validates the additive SHADOW envelope before persistence/rendering.
 */
export function assertCoreZoneShadowContract(payload: unknown): asserts payload is UnknownRecord {
  if (!isRecord(payload)) throw new CoreZoneContractError("CORE_ZONE_PAYLOAD_INVALID");
  if (payload.run_role !== "SHADOW") throw new CoreZoneContractError("CORE_ZONE_NOT_SHADOW");
  if (payload.engine !== "5DR" && payload.engine !== "EDGE_STOCKS")
    throw new CoreZoneContractError("CORE_ZONE_ENGINE_INVALID");

  const issuance = payload.issuance;
  if (!Array.isArray(issuance) || issuance.length !== CORE_ZONE_HORIZONS.length)
    throw new CoreZoneContractError("CORE_ZONE_HORIZON_COUNT_INVALID");

  const actual = issuance.map((row) => isRecord(row) ? row.horizon : undefined);
  for (let i = 0; i < CORE_ZONE_HORIZONS.length; i += 1) {
    if (actual[i] !== CORE_ZONE_HORIZONS[i])
      throw new CoreZoneContractError(`CORE_ZONE_HORIZON_ORDER_INVALID:${String(actual[i])}:${CORE_ZONE_HORIZONS[i]}`);
  }
  if (actual.includes("D+5")) throw new CoreZoneContractError("CORE_ZONE_D5_FORBIDDEN");

  const lineage = payload.lineage;
  if (!isRecord(lineage) || lineage.production_isolated !== true)
    throw new CoreZoneContractError("CORE_ZONE_PRODUCTION_ISOLATION_REQUIRED");
  for (const key of ["source_run_id", "source_report_hash", "spec_version", "issued_at", "evidence_snapshot_id"] as const) {
    if (typeof lineage[key] !== "string" || lineage[key].length === 0)
      throw new CoreZoneContractError(`CORE_ZONE_LINEAGE_MISSING:${key}`);
  }

  const learning = payload.learning_policy;
  if (!isRecord(learning) || learning.automatic_observation !== true || learning.automatic_promotion !== false || learning.user_decision_required !== "APPROVE_REJECT_DEFER")
    throw new CoreZoneContractError("CORE_ZONE_LEARNING_POLICY_INVALID");
}
