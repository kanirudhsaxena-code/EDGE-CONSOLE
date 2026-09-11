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
