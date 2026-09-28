import test from "node:test";
import assert from "node:assert/strict";
import {buildPresentationSnapshot, assertPresentationParity, assertPresentationSnapshot, type PresentationEngine} from "../src/presentation-snapshot.js";

for (const engine of ["5DR", "EDGE_STOCKS", "IPO_EDGE"] as PresentationEngine[]) {
  test(`${engine} Console and ChatGPT resolve identical immutable presentation`, () => {
    const input = {engine, run_id:`${engine}-run`, result_id:`${engine}-result`, governance_state:"SELECTED", sections:[{name:"summary", status:"VERIFIED", value:42}], source_payload_hash:"source-abc"};
    const consoleSnapshot = buildPresentationSnapshot(input);
    const chatSnapshot = buildPresentationSnapshot({...input, sections:[{value:42, status:"VERIFIED", name:"summary"}]});
    assert.equal(consoleSnapshot.presentation_hash, chatSnapshot.presentation_hash);
    assert.doesNotThrow(() => assertPresentationParity(consoleSnapshot, chatSnapshot));
  });
}

test("fails closed when persisted presentation semantics are changed", () => {
  const snapshot = buildPresentationSnapshot({engine:"5DR", run_id:"r", result_id:"x", governance_state:"SELECTED", sections:[{status:"VERIFIED"}], source_payload_hash:"s"});
  const tampered = {...snapshot, governance_state:"REJECTED"};
  assert.throws(() => assertPresentationSnapshot(tampered), /PRESENTATION_HASH_MISMATCH/);
});

test("missing intermediate fields cannot be silently presented as NOT_VERIFIED", () => {
  assert.throws(() => buildPresentationSnapshot({engine:"IPO_EDGE", run_id:"r", result_id:"x", governance_state:"SELECTED", sections:[], source_payload_hash:"s"}), /PRESENTATION_MISSING_SECTIONS/);
});
