# EDGE Stocks V1.3 — G5 Visible Forecast Presentation Addendum

Status: **CORRECTIVE PRESENTATION AUTHORITY**
Date: **4 October 2026**
Wire contract: `EDGE_STOCKS_V1_3` (unchanged)
Presentation contract: `EFFICACY_V2`
Analytical framework: `EDGE_V1` (unchanged)

## Purpose

This addendum closes the G5 presentation gap without changing frozen EDGE analytical methodology.

The existing V1.3 machine contract already requires the governed five-session forecast path. This addendum makes its **visible rendering and ChatGPT capture mandatory** for every standard EDGE Stocks result.

## Mandatory top-level order

The four authoritative sections remain unchanged:

1. EDGE MASTER ASSESSMENT
2. ACTIVE CALLS
3. CURRENT STOCK OUTCOME
4. DRILL-DOWN

No new top-level analytical section is introduced.

## Mandatory CURRENT STOCK OUTCOME content

CURRENT STOCK OUTCOME must visibly include the exact persisted G5 path for:

- D
- D+1
- D+2
- D+3
- D+4

Each visible row must expose:

- target trading date;
- dominant direction;
- Bull / Base / Bear probabilities;
- expected price zone;
- regime context;
- evidence basis;
- verification state.

The visible values must be read directly from the immutable production read model. The Console and ChatGPT may not independently reconstruct, interpolate, decay, rescore or infer any horizon row.

If the exact five-row path is missing, incomplete, misordered, invalid, or unavailable to the renderer, the standard user output is incomplete and must fail closed.

## Mandatory DRILL-DOWN semantics

A VERIFIED drill-down component must use persisted evidence-grounded `key_outcome` and `interpretation`.

Score-derived narrative reconstruction is prohibited for VERIFIED rows. Missing persisted semantics are a publication blocker.

NOT_VERIFIED and NOT_AVAILABLE rows must state the evidence state explicitly and must not infer a conclusion.

## ChatGPT parity rule

ChatGPT presentation capture must wait for the complete D:D+4 Console DOM and verify exact parity against the governed API source for:

- labels;
- trading dates;
- directions;
- probabilities;
- zones;
- regime context;
- evidence basis;
- verification state.

The prior optional G5 parity mode is retired. Complete D:D+4 parity is mandatory on every standard EDGE Stocks ChatGPT run.

## Non-impact boundary

This addendum does **not** change:

- component weights;
- DES;
- Market Trust;
- Bull/Base/Bear calculations;
- BOT Hunter;
- Decision Ladder;
- Event-Shock methodology;
- execution logic;
- efficacy calculations;
- canonical-selection logic;
- Learning Lab methodology;
- trading permissions.

It is a presentation/read-model enforcement correction only.

## Acceptance

Production closure requires:

1. static contract and unit tests green;
2. Console renderer shows exactly five D:D+4 rows;
3. regime/evidence/verification are visible for every row;
4. VERIFIED drill-down rows contain persisted evidence-grounded semantics;
5. ChatGPT Console capture waits for and captures the full path;
6. captured values exactly match the governed API source;
7. fresh production runs for LTF, CUPID and RELIANCE pass;
8. NIFTY full standard output remains unaffected and complete.
