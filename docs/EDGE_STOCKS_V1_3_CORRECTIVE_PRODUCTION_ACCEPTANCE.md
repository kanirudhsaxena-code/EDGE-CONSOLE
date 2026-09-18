# EDGE Stocks V1.3 / Efficacy V2 — Corrective Production Acceptance

**Status:** PRODUCTION ACCEPTED / GO — semantic acceptance restored  
**Date:** 18 September 2026  
**Contract:** `EDGE_STOCKS_V1_3`  
**Presentation:** `EFFICACY_V2`

## Incident corrected

The prior V1.2 acceptance validated transport, persistence, schema, probability integrity and a two-table renderer, but failed to detect two semantic defects:
1. the Console presentation did not start with the mandatory Efficacy V2 EDGE MASTER ASSESSMENT;
2. VERIFIED drill-down rows could reach the user without meaningful interpretation.

The prior V1.2 acceptance records remain immutable historical evidence but are superseded for production governance.

## Root cause

- The later EDGE Efficacy V2 renderer in `EDGE---V1/src/report.py` mandated four user-facing sections.
- A later Console integration incorrectly treated the older two-table presentation contract as canonical.
- Component scores were persisted, but evidence-grounded component summaries were not carried through to the immutable audit rows.
- Acceptance tests checked schema/plumbing more strongly than semantic completeness.

## Remediation

Engine semantic persistence:
- EDGE V1 merge: `8d9c31789472e9176f2b986eb0cf6d8e0c3a86d0`
- component summaries now survive interpreter → governed computation → component audit rows;
- VERIFIED components persist structured `key_outcome` and `interpretation`.

Console semantic enforcement:
- EDGE Console merge: `523bffa6e65ae40e9e365777147753d1234f5014`
- contract upgraded to `EDGE_STOCKS_V1_3`;
- presentation contract fixed to `EFFICACY_V2`;
- exact mandatory order:
  1. EDGE MASTER ASSESSMENT
  2. ACTIVE CALLS
  3. CURRENT STOCK OUTCOME
  4. DRILL-DOWN
- VERIFIED components with blank or boilerplate interpretation fail closed.

## Fresh post-fix proof

Fresh autonomous production fixture:
- Ticker: TCS
- Recommendation: `EDGE-TCS-20260918-181704-AUTO`
- Autonomous publish workflow: success
- Trading execution: disabled

Direct database verification confirmed structured non-boilerplate interpretations were persisted for all VERIFIED TCS components.

Authenticated production smoke:
- Run: `35379877461`
- Result: **SUCCESS**
- V1.3 surface: passed
- production health: passed
- prompt dispatch credential: passed
- TCS Efficacy V2 report semantics: passed
- canonical V1.3 renderer: passed
- master efficacy separation: passed

## Non-regression gates

Production acceptance now requires:
- V1.3 + Efficacy V2 version markers;
- exactly four sections in exact order;
- assessment first;
- active calls before current stock outcome;
- valid governed decision fields and probabilities;
- OFFICIAL vs PROVISIONAL separation;
- meaningful evidence-grounded interpretation for every VERIFIED component;
- explicit rejection of the obsolete V1.2 two-table presentation;
- fresh post-contract production fixture in smoke tests.

A transport/schema-only green run is no longer sufficient for EDGE Stocks product production acceptance.

## Methodology boundary

No frozen analytical method was changed. Scoring, weights, DES, Market Trust, probabilities, BOT, Decision Ladder, execution rules, efficacy calculations, historical recommendations and Learning Lab governance remain unchanged.
