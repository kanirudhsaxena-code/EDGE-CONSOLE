import { createHash } from "node:crypto";

type UnknownRecord = Record<string, unknown>;
export type PresentationEngine = "5DR" | "EDGE_STOCKS" | "IPO_EDGE";

/**
 * Language-neutral semantic hashing for P0-11.
 *
 * The engines are Python while the Console is TypeScript. Hashing ordinary JSON
 * text directly is unsafe because runtimes can stringify equivalent numbers
 * differently (for example 1.0 vs 1). Instead every value is converted to a
 * typed semantic AST. Finite numbers are represented by their exact IEEE-754
 * binary64 bytes, object keys are sorted, and array order is preserved.
 *
 * This is still P0_11_PRESENTATION_V1: no persisted V1 snapshots existed before
 * this representation was locked. All engine implementations must use this exact
 * semantic-node algorithm and the shared test vector before persistence is enabled.
 */
function f64Hex(value: number): string {
  if (!Number.isFinite(value)) throw new Error("PRESENTATION_NON_FINITE_NUMBER");
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new Error("PRESENTATION_UNSAFE_INTEGER_USE_STRING");
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function semanticNode(value: unknown): unknown {
  if (value === null) return ["null"];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "number") return ["number_f64", f64Hex(value)];
  if (Array.isArray(value)) return ["array", value.map(semanticNode)];
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("PRESENTATION_NON_JSON_OBJECT");
    }
    const record = value as UnknownRecord;
    return ["object", Object.keys(record).sort().map((key) => [key, semanticNode(record[key])])];
  }
  throw new Error("PRESENTATION_NON_JSON_VALUE");
}

export function semanticPresentationHash(value: unknown): string {
  const semantic = JSON.stringify(semanticNode(value));
  return createHash("sha256").update(semantic, "utf8").digest("hex");
}

export type PresentationSnapshot = Readonly<{
  presentation_contract_version: "P0_11_PRESENTATION_V1";
  engine: PresentationEngine;
  identity: Readonly<{ run_id: string; result_id: string; checkpoint_id: string | null }>;
  governance_state: string;
  sections: readonly UnknownRecord[];
  source_payload_hash: string;
  presentation_hash: string;
}>;

/** Persist the returned object as the user-facing semantic source. Surfaces may format it only. */
export function buildPresentationSnapshot(input: {
  engine: PresentationEngine;
  run_id: string;
  result_id: string;
  checkpoint_id?: string | null;
  governance_state: string;
  sections: readonly UnknownRecord[];
  source_payload_hash: string;
}): PresentationSnapshot {
  if (!input.run_id) throw new Error("PRESENTATION_MISSING_RUN_ID");
  if (!input.result_id) throw new Error("PRESENTATION_MISSING_RESULT_ID");
  if (!input.source_payload_hash) throw new Error("PRESENTATION_MISSING_SOURCE_HASH");
  if (!input.governance_state) throw new Error("PRESENTATION_MISSING_GOVERNANCE_STATE");
  if (!input.sections.length) throw new Error("PRESENTATION_MISSING_SECTIONS");
  const basis = {
    presentation_contract_version: "P0_11_PRESENTATION_V1" as const,
    engine: input.engine,
    identity: {run_id: input.run_id, result_id: input.result_id, checkpoint_id: input.checkpoint_id ?? null},
    governance_state: input.governance_state,
    sections: input.sections,
    source_payload_hash: input.source_payload_hash,
  };
  return Object.freeze({
    ...basis,
    identity: Object.freeze(basis.identity),
    sections: Object.freeze([...basis.sections]),
    presentation_hash: semanticPresentationHash(basis),
  });
}

export function assertPresentationSnapshot(snapshot: PresentationSnapshot): void {
  const {presentation_hash, ...basis} = snapshot;
  if (snapshot.presentation_contract_version !== "P0_11_PRESENTATION_V1") {
    throw new Error("PRESENTATION_CONTRACT_VERSION_UNSUPPORTED");
  }
  if (semanticPresentationHash(basis) !== presentation_hash) throw new Error("PRESENTATION_HASH_MISMATCH");
}

export function assertPresentationParity(consoleSnapshot: PresentationSnapshot, chatSnapshot: PresentationSnapshot): void {
  assertPresentationSnapshot(consoleSnapshot);
  assertPresentationSnapshot(chatSnapshot);
  if (consoleSnapshot.presentation_hash !== chatSnapshot.presentation_hash) {
    throw new Error("PRESENTATION_SURFACE_PARITY_MISMATCH");
  }
}
