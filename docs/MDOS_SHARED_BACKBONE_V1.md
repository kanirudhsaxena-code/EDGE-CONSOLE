# MDOS Shared Backbone V1 — Canonical Infrastructure Contract

Status: FROZEN AFTER PRODUCTION ACCEPTANCE

## Scope

This contract governs shared infrastructure used by three independent consumers:

- 5DR
- EDGE Stocks
- IPO EDGE

It does not contain or modify any consumer methodology, scoring model, weights,
probability engine, DES/Market Trust logic, recommendation semantics, grading
thresholds, historical checkpoints, or trading logic.

## Canonical flow

Acquisition / cache
→ provenance-bound evidence
→ consumer isolation
→ consumer-owned engine
→ canonical persistence
→ outcome checkpoints
→ efficacy
→ governed Learning Lab runtime
→ explicit promotion decision

## Shared invariants

1. Consumer isolation is mandatory. Evidence/cache identifiers are consumer-namespaced.
2. Shared market cache documents use market-cache-document-v1 with SHA-256 dataset and document binding.
3. Cache failure may fall back to an approved authenticated provider; cache data may never silently replace conflicting fresh evidence.
4. The control plane may route commands and report status. It may not calculate consumer scores or recommendations.
5. Trading/order execution is prohibited in the shared backbone.
6. Learning is observation/testing first. Automatic adoption is prohibited.
7. A learning change requires independent validation and an explicit consumer-owned promotion decision.
8. Historical checkpoint mutation is prohibited.
9. Every production consumer keeps its own canonical database and frozen methodology boundary.
10. Source health/fallback/reconciliation must fail closed when required evidence cannot be verified.

## Registered consumers

| Engine | Production repository | Invocation |
|---|---|---|
| 5DR | kanirudhsaxena-code/5DR-V2 | 5DR / 5DR NIFTY prompt guard + scheduled structured acquisition |
| EDGE Stocks | kanirudhsaxena-code/EDGE---V1 | EDGE <ticker/company> autonomous governed publisher |
| IPO EDGE | kanirudhsaxena-code/IPO-EDGE | scheduled or manual V1.1 live runtime |

## Shared data/cache state

- 5DR: durable cache-first historical backbone validated and production-active.
- EDGE Stocks: durable EDGE_STOCK-namespaced historical cache using the same document integrity contract; authenticated provider write-through fallback.
- IPO EDGE: multi-source discovery registry, health/fallback and Mainboard/SME reconciliation; latest production validation requires COVERAGE_COMPLETE.

## Learning runtime contract

Schema: mdos-learning-runtime-v1

Common statuses:
DEFERRED, OBSERVING, CANDIDATE, VALIDATING, APPROVAL_REQUIRED, ADOPTED, REJECTED.

Common fields:
engine, cycle_id, status, sample_size, candidate_count, source_ref, occurred_at, automatic_adoption, methodology_changed.

The common ledger is an audit/control-plane view only. Engine-specific Learning Lab
tables remain authoritative for hypotheses, shadow tests, validations and promotions.

## Change control

Changes to this document may extend execution resilience, provenance, observability,
routing or storage only when they preserve all invariants above.

Any change to a consumer methodology requires a separate consumer-specific approval
and must not be introduced through a shared-backbone change.
