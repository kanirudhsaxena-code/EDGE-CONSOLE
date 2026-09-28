import { createHash } from "node:crypto";
import type { CoreZoneReadModel } from "./core-zone-read-model.js";

export type ExactRunReport = Readonly<{
  report_version: "G8_EXACT_RUN_V1";
  run_id: string;
  engine: CoreZoneReadModel["engine"];
  contract_version: string;
  report_hash: string;
  payload_hash: string;
  exact_run_hash: string;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** G8 additive report: fingerprints the canonical read-model; never recalculates engine values. */
export function buildExactRunReport(model: CoreZoneReadModel): ExactRunReport {
  if (model.surface !== "CANONICAL") throw new Error("EXACT_RUN_NON_CANONICAL_SOURCE");
  for (const key of ["run_id", "contract_version", "report_hash", "payload_hash"] as const) {
    if (!model[key]) throw new Error(`EXACT_RUN_MISSING_${key.toUpperCase()}`);
  }
  const basis = [model.run_id, model.engine, model.contract_version, model.report_hash, model.payload_hash].join("|");
  return Object.freeze({
    report_version: "G8_EXACT_RUN_V1",
    run_id: model.run_id,
    engine: model.engine,
    contract_version: model.contract_version,
    report_hash: model.report_hash,
    payload_hash: model.payload_hash,
    exact_run_hash: sha256(basis),
  });
}

export function assertExactRunParity(consoleReport: ExactRunReport, chatReport: ExactRunReport): void {
  for (const key of ["report_version", "run_id", "engine", "contract_version", "report_hash", "payload_hash", "exact_run_hash"] as const) {
    if (consoleReport[key] !== chatReport[key]) throw new Error(`EXACT_RUN_SURFACE_PARITY_MISMATCH:${key}`);
  }
}
