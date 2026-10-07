# EDGE Console — Build Status

Last updated: 7 October 2026

## Production priority

Current release scope is limited to **5DR + EDGE Stocks**.

Explicitly deferred from this release:
- IPO EDGE completion / source-completeness remediation
- multi-user / tester-access enforcement and Cloudflare identity hardening

These deferred items must not block the 5DR + EDGE Stocks production cutover.

## 5DR

Status: **PRODUCTION / GO — OPEN-MARKET GATE PASSED**

Completed:
- canonical 5DR V2.2.3 specification release-bound;
- production model remains `5DR_V2_1`;
- output contract remains `5DR_V2_1_2`;
- Upstox structured evidence is the automated primary path;
- screenshots are fallback/diagnostic only;
- governed research, normalization, frozen-engine execution and result persistence are wired;
- cross-repository workflow permission blocker removed through governed proxy execution of the pinned 5DR engine;
- weekend/closed-session transport acceptance passes fail-closed;
- Console CI, deployment, smoke and automated production acceptance are green on 20 September 2026;
- 5DR CI and read-only Upstox verification are green.

Production proof:
- pre-cutover real NSE open-session zero-upload acceptance run `35563847508` passed;
- post-cutover real NSE open-session zero-upload acceptance run `35568275080` passed with `acceptance_mode=FULL_LIVE_E2E`;
- post-cutover sandbox request `5drreq_443c8973-3830-4625-8895-f3b1915de6a6` completed as run `5drrun_36600cf6-faa2-4e19-ba2d-51f0a1d18fca`;
- sandbox boundary held: unpublished and Learning-Lab-ineligible;
- no methodology, scoring, DES/tradeability, output semantics or Learning Lab governance changed during cutover.

5DR engine checkpoint:
- `ad2afc81e3fcaee86e9f647abcce1ec8d138ceeb`

## EDGE Stocks

Status: **PRODUCTION ACCEPTED / GO**

Canonical production contract:
- analytical core: `EDGE_V1`
- user-facing contract: `EDGE_STOCKS_V1_3`
- presentation semantics: `EFFICACY_V2`
- fresh governed research required

Required user-facing order:
1. EDGE MASTER ASSESSMENT
2. CURRENT STOCK OUTCOME
3. DRILL-DOWN
4. ACTIVE CALLS

Production validation includes:
- canonical V1.3 renderer;
- market-metric visual v7: user-facing Direction strength, Evidence confidence and Trade setup strength moved into Today’s Market View; raw DES5/Market Trust/Execution Edge removed from Advanced Details;
- EDGE Stocks paired highlight cards standardized: same 16px value size/weight for Range-bound and Expected 5-Day Range, no forced blank card height, tighter spacing to the probability row;
- UI asset version edge-ui-v7-20260921 with Worker-first no-store delivery;
- research-backed invocation;
- dispatch credential health;
- probability integrity;
- OFFICIAL vs PROVISIONAL efficacy separation;
- meaningful interpretation for VERIFIED drill-down rows;
- fail-closed behavior when governed research is absent;
- trading execution disabled.

Current EDGE engine checkpoint:
- `d1d8f3d531a5e4f59b1e1a9b36ce0fea7ed45d56`

Latest production LTF proof:
- autonomous publish run `35568242052` passed on 21 September 2026;
- recommendation `EDGE-LTF-20260921-062352-AUTO` published;
- forecast: `BASE_RANGE`;
- probabilities: Bull 34.241%, Base 64.146%, Bear 1.613%;
- Market Trust: 91/100, VERY HIGH;
- expected D+5 zone: ₹305.20–₹320.40;
- definitive recommendation: NO TRADE; NO OPTION TRADE;
- trading execution remains disabled.

The stale supersession PR was closed because V1.3/Efficacy V2 is already canonical on `main`.

## Console / cutover

Production Console checkpoint:
- `3f8024897b6be7f3306462838ee3cd2234c42eea`

Production cutover:
- PR #76 merged to `main`;
- `APP_ENV=production` verified;
- deployment run `35568226911` passed;
- EDGE production smoke run `35568226877` rerun passed;
- Console CI run `35568227008` passed.

Identity mode remains `AUDIT` for this release. Multi-user enforcement is a separate, explicitly deferred workstream and must not be mixed into the 5DR + EDGE Stocks release.

## Production lock

All release gates passed on 21 September 2026:
1. production deployment passed;
2. EDGE production smoke passed after deployment;
3. post-cutover real NSE open-session EDGE NIFTY/5DR zero-upload acceptance passed;
4. sandbox publish/Learning-Lab boundaries held;
5. fresh LTF autonomous publish passed on the fixed EDGE engine;
6. `APP_ENV=production` is active.

Production remains fail-closed. Trading execution remains disabled. Future methodology, scoring, recommendation-semantics or Learning Lab changes require explicit governance rather than being folded into production maintenance.


## Build 2.75 corrective status — 7 October 2026

Status: **PRODUCTION ACCEPTED / CLOSED — FINAL USER-OUTPUT PROOF VALID**

Closed corrective controls:
- fresh NIFTY research is required before market acquisition/scoring;
- research transport success is distinct from FACT_READY evidence;
- current RBI policy/rate evidence and latest Fed policy evidence are factual gates;
- unresolved policy facts fail closed rather than silently becoming neutral/zero;
- exact NIFTY request/run identity is preserved through publication;
- every standard NIFTY chat run deterministically generates `chat-user-output.md` from the exact published run and its frozen assessment snapshot;
- the standard user payload contains exactly two tables: 5DR Assessment & Efficacy, then Current 5DR Run;
- user-facing horizons are exactly D through D+4;
- diagnostic Console narrative is excluded from the standard response unless drill-down is requested;
- `chat-user-output-manifest.json` binds request_id, run_id, horizon contract and SHA-256 output hash;
- Console render success is parity evidence only and cannot be reported as end-to-end user success;
- envelope contract and governed 5DR output contract identities are stored separately.

Final production proof:
- GitHub workflow: `EDGE Chat · Console-rendered Production Run`, run `37658652763` — SUCCESS;
- fresh request: `5drreq_73eea724-aeaa-40a5-a611-0be5d2b2f60c` — COMPLETED;
- exact published run: `5drrun_ca1df57c-c187-44ff-9cbc-5e0637a4d341`;
- research manifest: `NIFTY_G5_1_V2_FACT_COMPLETE` — complete, no fact blockers and no missing dimensions;
- market evidence: `AUTOMATED_MARKET_DATA_READY` — no blockers;
- reconciliation: `NORMALIZED_AND_DISPATCHED`;
- exact user-output contract: `BUILD_2_75_NIFTY_CHAT_USER_OUTPUT_V1`;
- envelope contract: `1.0`;
- governed 5DR output contract: `5DR_V2_1_2`;
- output sections: exactly `TABLE_1_5DR_ASSESSMENT_EFFICACY` + `TABLE_2_CURRENT_5DR_RUN`;
- display horizons: exactly `D, D+1, D+2, D+3, D+4`;
- exact user-output SHA-256: `b29f374e301ae7940e18ce4cb2307a81e15ae2a4d0c9dfdda4d37ce965bec44e`;
- proof artifact: GitHub Actions artifact `11500007447`.

Closure condition:
The active ChatGPT closure response must return the exact validated `chat-user-output.md` from the proof artifact without reconstruction. If that exact payload is not returned, `USER DELIVERED` has not occurred and Build 2.75 must be treated as reopened.
