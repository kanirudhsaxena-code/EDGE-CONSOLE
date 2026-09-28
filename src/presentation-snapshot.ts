import { createHash } from "node:crypto";

type UnknownRecord = Record<string, unknown>;
export type PresentationEngine = "5DR" | "EDGE_STOCKS" | "IPO_EDGE";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as UnknownRecord;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
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
  return Object.freeze({...basis, identity: Object.freeze(basis.identity), sections: Object.freeze([...basis.sections]), presentation_hash: hash(basis)});
}

export function assertPresentationSnapshot(snapshot: PresentationSnapshot): void {
  const {presentation_hash, ...basis} = snapshot;
  if (snapshot.presentation_contract_version !== "P0_11_PRESENTATION_V1") throw new Error("PRESENTATION_CONTRACT_VERSION_UNSUPPORTED");
  if (hash(basis) !== presentation_hash) throw new Error("PRESENTATION_HASH_MISMATCH");
}

export function assertPresentationParity(consoleSnapshot: PresentationSnapshot, chatSnapshot: PresentationSnapshot): void {
  assertPresentationSnapshot(consoleSnapshot);
  assertPresentationSnapshot(chatSnapshot);
  if (consoleSnapshot.presentation_hash !== chatSnapshot.presentation_hash) throw new Error("PRESENTATION_SURFACE_PARITY_MISMATCH");
}
