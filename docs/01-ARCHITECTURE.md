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

- PREP, RESEARCH and AUCTION/canonical execution may proceed only when the governed NSE calendar classifies the IST date as `TRADING_DAY`.
- Weekends and known NSE `TRADING_HOLIDAY` dates must terminate as a bounded no-op: no canonical is created and no failure is raised merely because the scheduler woke.
- The G5.1 pre-open proof wakes at 09:20 IST on weekdays. On a trading day it must verify persisted NIFTY plus LTF/CUPID/RELIANCE pre-open evidence. On a known non-trading day it records `NON_TRADING_DAY` and succeeds without fabricating missing-run errors.
- If the governed calendar does not cover the target year, automation fails closed with `CALENDAR_COVERAGE_MISSING`; it must never assume an uncovered weekday is a trading day.
- Calendar policy is versioned and auditable. Updating calendar coverage is an operational governance change, not an analytical-method change.
