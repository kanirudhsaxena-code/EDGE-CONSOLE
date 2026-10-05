# EDGE Console Architecture

## Stable boundary

The console must remain stable while engines evolve.

`Engine -> Normalizer -> Versioned Output Contract -> Database -> API -> UI`

The UI never consumes raw engine output directly.

## Runtime layers

1. Engine adapters receive raw/manual/automated engine output.
2. Normalizers convert each engine result into the versioned contract.
3. Validation rejects malformed outputs before persistence.
4. Neon stores runs, evidence, outcomes and learning proposals.
5. Cloudflare Worker exposes a narrow API and serves the PWA assets.
6. UI renders only normalized/published data.

## Publication safety

- Production and shadow runs are distinct.
- Failed or partial runs never replace a valid published result automatically.
- `published=true` is reserved for the current approved result.
- Last-good-result remains available if a new run fails.
- Framework changes require version changes and governance records.

## Learning Lab rule

Learning may collect observations and propose changes autonomously, but it may not silently alter production behavior. Proposed changes must be validated/shadow-tested and explicitly approved before promotion.

## Input evolution

5DR and EDGE Stocks begin as MANUAL/HYBRID. Automation can be added later without changing the UI contract. EDGE IPO is an AUTOMATED integration target from the start.

## Deployment environments

Development -> Staging -> Production.

Preview deployments are used before production promotion.

## Market-session scheduling authority

Cloudflare/GitHub cron expressions are wake-up mechanisms, not evidence that NSE is open.

The production authority chain is:

`Exact Upstox session timing proof -> append-only verified current-year calendar cache -> bounded checked-in bootstrap`

- The EDGE provider refreshes the current-year NSE holiday/special-timing calendar automatically and persists append-only snapshots.
- The target market date receives an exact provider timing proof. A standard `09:15 IST` NSE opening is `TRADING_DAY` and pre-open eligible; a different opening is `SPECIAL_TIMING` and the standard pre-open pipeline is skipped cleanly.
- Cloudflare independently dispatches redundant refresh attempts before PREP, while the EDGE workflow also has midnight/pre-market scheduled refreshes. Refresh writes are idempotent and do not create canonicals.
- PREP, RESEARCH and AUCTION/canonical execution may proceed only when dynamic session authority returns `preopen_eligible=true`.
- `WEEKEND` and `TRADING_HOLIDAY` terminate as bounded no-ops. `SPECIAL_TIMING` terminates as a governed non-standard-session no-op. None is a missing-canonical incident merely because a scheduler woke.
- The checked-in 2026 JSON exists only as migration/emergency bootstrap. It is not the annual operating authority and creates no manual year-rollover dependency.
- If no exact proof, fresh persisted year cache, or explicitly bounded bootstrap coverage exists, the system fails closed as `CALENDAR_COVERAGE_MISSING`.
- The G5.1 proof and post-deploy 5DR acceptance consume the same production `/api/market-calendar/session` authority, preventing test/runtime calendar drift.
- D:D+4 generation is cross-year safe: when the path reaches a year not represented by the provider's current-year holiday snapshot, each candidate date is verified through exact exchange timings before inclusion.
- Calendar/session operations are evidence-governance changes only; frozen analytical scoring, probabilities, canonical-selection mathematics and trading-disabled state remain unchanged.