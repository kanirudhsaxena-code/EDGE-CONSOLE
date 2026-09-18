> **STATUS: SUPERSEDED / CORRECTIVE ACCEPTANCE REQUIRED.** The V1.2 transport/runtime acceptance below is retained as historical audit evidence only. It did not validate the later Efficacy V2 semantic ordering or meaningful component interpretation. New production acceptance is governed by `EDGE_STOCKS_V1_3 / EFFICACY_V2` and `docs/EDGE_STOCKS_V1_3_CORRECTIVE_PRODUCTION_ACCEPTANCE.md`.

# EDGE Stocks V1.2 — Production Acceptance

**Status:** PRODUCTION ACCEPTED / GO  
**Accepted:** 18 September 2026  
**Contract:** `EDGE_STOCKS_V1_2`  
**Repository:** `kanirudhsaxena-code/EDGE-CONSOLE`

## Acceptance basis

Production acceptance was completed against the live Cloudflare Worker protected by Cloudflare Access.

Validated production workflow:
- Workflow: `EDGE Production Smoke`
- Run: `35360819247`
- Successful attempt: `4`
- Accepted commit: `550b7d456d08a632f770caf18a1884f90901ec48`

All required production checks passed:
1. Deployed V1.2 surface detected.
2. EDGE production health endpoint passed.
3. Live LTF EDGE Stocks report contract passed.
4. Canonical V1.2 renderer asset passed.
5. OFFICIAL vs PROVISIONAL efficacy separation passed.
6. Cloudflare Access service-token authentication passed.

## Production invariant

Standard `EDGE <stock/company/ticker>` output must use the canonical EDGE Stocks V1.2 contract:
- exactly two standard user-facing tables;
- governed decision values only;
- explicit verification status for evidence;
- one primary action;
- Bull/Base/Bear probabilities summing to 100%;
- OFFICIAL efficacy separated from PROVISIONAL checkpoint diagnostics;
- fail closed when mandatory contract data is incomplete.

## Change boundary

This acceptance records deployment and presentation/runtime validation only.

It does **not** modify EDGE V1 scoring, weights, DES, Market Trust, probability logic, BOT, execution semantics, efficacy rules, historical records, or learning governance.

## Operational state

Main-branch changes now run:
- CI validation;
- Cloudflare Worker deployment;
- authenticated production smoke validation.

A future main-branch change that breaks the deployed V1.2 surface or contract is expected to fail the production smoke gate.
