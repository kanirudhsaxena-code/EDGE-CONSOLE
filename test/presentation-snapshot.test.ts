import test from "node:test";
import assert from "node:assert/strict";
import {buildPresentationSnapshot, assertPresentationParity, assertPresentationSnapshot, semanticPresentationHash, type PresentationEngine} from "../src/presentation-snapshot.js";

for (const engine of ["5DR", "EDGE_STOCKS", "IPO_EDGE"] as PresentationEngine[]) {
  test(`${engine} Console and ChatGPT resolve identical immutable presentation`, () => {
    const input = {engine, run_id:`${engine}-run`, result_id:`${engine}-result`, governance_state:"SELECTED", sections:[{name:"summary", status:"VERIFIED", value:42}], source_payload_hash:"source-abc"};
    const consoleSnapshot = buildPresentationSnapshot(input);
    const chatSnapshot = buildPresentationSnapshot({...input, sections:[{value:42, status:"VERIFIED", name:"summary"}]});
    assert.equal(consoleSnapshot.presentation_hash, chatSnapshot.presentation_hash);
    assert.doesNotThrow(() => assertPresentationParity(consoleSnapshot, chatSnapshot));
  });
}

test("cross-language P0-11 semantic hash vector is locked", () => {
  const basis = {
    presentation_contract_version:"P0_11_PRESENTATION_V1",
    engine:"5DR",
    identity:{run_id:"run-42",result_id:"forecast-7",checkpoint_id:null},
    governance_state:"SELECTED",
    sections:[
      {name:"TABLE_1_5DR_OUTCOME",value:1.0,probability:42.5,verified:true},
      {name:"TABLE_2_5DR_DRILL_DOWN",items:["PVPO",null,-0]},
    ],
    source_payload_hash:"source-abc",
  };
  assert.equal(semanticPresentationHash(basis), "43cab49103f841c9a85d2213756ecb6db2ee54cbdbb5c0ec6545cc7dbb80b020");
});

test("fails closed when persisted presentation semantics are changed", () => {
  const snapshot = buildPresentationSnapshot({engine:"5DR", run_id:"r", result_id:"x", governance_state:"SELECTED", sections:[{status:"VERIFIED"}], source_payload_hash:"s"});
  const tampered = {...snapshot, governance_state:"REJECTED"};
  assert.throws(() => assertPresentationSnapshot(tampered), /PRESENTATION_HASH_MISMATCH/);
});

test("missing intermediate fields cannot be silently presented as NOT_VERIFIED", () => {
  assert.throws(() => buildPresentationSnapshot({engine:"IPO_EDGE", run_id:"r", result_id:"x", governance_state:"SELECTED", sections:[], source_payload_hash:"s"}), /PRESENTATION_MISSING_SECTIONS/);
});

test("non-finite numbers and unsafe integers fail closed before hashing", () => {
  assert.throws(() => semanticPresentationHash({value:Number.NaN}), /PRESENTATION_NON_FINITE_NUMBER/);
  assert.throws(() => semanticPresentationHash({value:Number.MAX_SAFE_INTEGER + 1}), /PRESENTATION_UNSAFE_INTEGER_USE_STRING/);
});

test("non-JSON objects fail closed instead of receiving runtime-specific hashes", () => {
  assert.throws(() => semanticPresentationHash({value:new Date("2026-09-28T00:00:00Z")}), /PRESENTATION_NON_JSON_OBJECT/);
});
