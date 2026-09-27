import { createHash } from "node:crypto";
import { assertCoreZoneShadowContract } from "./core-zone-shadow.js";

type UnknownRecord = Record<string, unknown>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as UnknownRecord;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
  }
  return value;
}

export function canonicalCoreZoneHash(payload: unknown): string {
  assertCoreZoneShadowContract(payload);
  const stable = canonicalize(payload);
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export type CoreZoneReadModel = {
  surface: "CANONICAL";
  run_id: string;
  engine: "5DR" | "EDGE_STOCKS";
  contract_version: string;
  report_hash: string;
  payload_hash: string;
  payload: UnknownRecord;
};

/**
 * G6-A5 canonical read-model. Console and ChatGPT must consume this same object;
 * surfaces may format it, but must not recalculate Core values or lineage.
 */
export function buildCoreZoneReadModel(payload: unknown): CoreZoneReadModel {
  assertCoreZoneShadowContract(payload);
  const p = payload as UnknownRecord;
  return Object.freeze({
    surface: "CANONICAL" as const,
    run_id: String(p.run_id ?? ""),
    engine: p.engine as "5DR" | "EDGE_STOCKS",
    contract_version: String(p.contract_version ?? ""),
    report_hash: String(p.report_hash ?? ""),
    payload_hash: canonicalCoreZoneHash(payload),
    payload: p,
  });
}

export function assertCoreZoneSurfaceParity(consoleModel: CoreZoneReadModel, chatModel: CoreZoneReadModel): void {
  for (const key of ["run_id", "engine", "contract_version", "report_hash", "payload_hash"] as const) {
    if (consoleModel[key] !== chatModel[key]) throw new Error(`CORE_ZONE_SURFACE_PARITY_MISMATCH:${key}`);
  }
}
