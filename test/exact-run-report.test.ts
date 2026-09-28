import test from "node:test";
import assert from "node:assert/strict";
import { buildExactRunReport, assertExactRunParity } from "../src/exact-run-report.js";
import type { CoreZoneReadModel } from "../src/core-zone-read-model.js";

const model: CoreZoneReadModel = {
  surface: "CANONICAL",
  run_id: "run-1",
  engine: "5DR",
  contract_version: "G6_CORE_SHADOW_V1",
  report_hash: "report-abc",
  payload_hash: "payload-abc",
  payload: {},
};

test("G8 exact-run report is deterministic and parity-safe", () => {
  const consoleReport = buildExactRunReport(model);
  const chatReport = buildExactRunReport({...model});
  assert.equal(consoleReport.exact_run_hash, chatReport.exact_run_hash);
  assert.doesNotThrow(() => assertExactRunParity(consoleReport, chatReport));
});

test("G8 parity fails closed on any hash deviation", () => {
  const consoleReport = buildExactRunReport(model);
  const chatReport = {...consoleReport, payload_hash: "different"};
  assert.throws(() => assertExactRunParity(consoleReport, chatReport), /EXACT_RUN_SURFACE_PARITY_MISMATCH:payload_hash/);
});

test("G8 refuses incomplete canonical lineage", () => {
  assert.throws(() => buildExactRunReport({...model, report_hash: ""}), /EXACT_RUN_MISSING_REPORT_HASH/);
});
