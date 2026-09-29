# CLOSING_DATA_TEST acceptance population

Status: Phase 2 base-product acceptance control.

## Purpose

When the relevant market is closed, NIFTY and EDGE Stocks/LTF may prove the product chain immediately using the latest valid completed-session evidence instead of waiting for the next live session.

## Required identity

Every such invocation MUST carry `acceptance_population=CLOSING_DATA_TEST` and an immutable `evidence_as_of` timestamp. Evidence provenance MUST identify the completed-session source(s). The methodology input MUST NOT contain evidence timestamped after `evidence_as_of`.

`CLOSING_DATA_TEST` MUST NOT be represented as `LIVE`, `ORDINARY_PREOPEN`, or as a contemporaneous trading forecast.

## Persistence and presentation

A closing-data acceptance run must persist its immutable engine result and presentation snapshot under the same governed product-chain contracts used by production reads. Historical retrieval MUST select the exact run/result identity and MUST NOT substitute latest state.

The acceptance proof must cover, where implemented for the engine: evidence lineage, approved methodology/version identity, immutable result identity/hash, presentation identity/hash, canonical readback, Core linkage hook, outcome/Learning hook state, and engine identity.

Missing, incomplete, mismatched, or tampered identity/provenance fails closed.

## Efficacy quarantine

`CLOSING_DATA_TEST` is test-only. It is ineligible for official efficacy, canonical production selection, production recommendation promotion, and Learning ingestion unless a separately approved governed promotion rule explicitly makes that individual run eligible. No such promotion is implied by successful acceptance.

Outcome/Learning acceptance for this population proves only that the downstream hook is present and correctly quarantines the run; it MUST NOT write an official efficacy observation.

## Core

If Core evidence is exercised, the parent acceptance run must create linked immutable Core SHADOW records for exactly D,D+1,D+2,D+3,D+4 with parent/core IDs, hashes, versions, and issuance lineage. These records inherit the `CLOSING_DATA_TEST` quarantine.

## Isolation

Failure of a `CLOSING_DATA_TEST` invocation for one engine MUST NOT roll back, overwrite, rerun, or block another engine. NIFTY, Stocks and IPO retain independent execution, persistence, retry/recovery and Learning state.

## Acceptance state

A code/config/test implementation is CODED or VERIFIED only. ACCEPTED requires a governed closing-data run (or genuine live run) proving the complete available product chain with immutable identities and exact readback.