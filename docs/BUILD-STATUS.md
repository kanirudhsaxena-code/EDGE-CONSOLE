# EDGE Console — Build Status

Last updated: 20 September 2026

## Production priority

Current release scope is limited to **5DR + EDGE Stocks**.

Explicitly deferred from this release:
- IPO EDGE completion / source-completeness remediation
- multi-user / tester-access enforcement and Cloudflare identity hardening

These deferred items must not block the 5DR + EDGE Stocks production cutover.

## 5DR

Status: **PRODUCTION CANDIDATE — OPEN-MARKET GO GATE PENDING**

Completed:
- canonical 5DR V2.2.3 specification release-bound;
- production model remains `5DR_V2_1`;
- output contract remains `5DR_V2_1_2`;
- Upstox structured evidence is the automated primary path;
- screenshots are fallback/diagnostic only;
- governed research, normalization, frozen-engine execution and result persistence are wired;
- cross-repository workflow permission blocker removed through governed proxy execution of the pinned 5DR engine;
- weekend/closed-session transport acceptance passes fail-closed;
- Console CI, deployment and EDGE production smoke are green on 20 September 2026;
- closed-session zero-upload end-to-end acceptance run `35519575645` passed with `acceptance_mode=FULL_LIVE_E2E`, request `5drreq_e9283685-0c88-4187-afdd-3f4000548f6b`, run `5drrun_596edbef-dc02-4a33-b998-40d2d576bf86`;
- sandbox persistence boundary passed: unpublished and Learning-Lab-ineligible;
- Console persistence validation is aligned with the frozen canonical 5DR directional label set via production-blocker fix PR #60;
- 5DR CI and read-only Upstox verification are green.

Remaining GO gate:
- one real NSE open-session zero-upload run must reach terminal COMPLETED without fallback/fabrication;
- sandbox acceptance must remain unpublished and Learning-Lab-ineligible;
- no methodology, scoring, DES/tradeability, output semantics or Learning Lab governance may change during cutover.

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
2. ACTIVE CALLS
3. CURRENT STOCK OUTCOME
4. DRILL-DOWN

Production validation includes:
- canonical V1.3 renderer;
- research-backed invocation;
- dispatch credential health;
- probability integrity;
- OFFICIAL vs PROVISIONAL efficacy separation;
- meaningful interpretation for VERIFIED drill-down rows;
- fail-closed behavior when governed research is absent;
- trading execution disabled.

Current EDGE engine checkpoint:
- `7152858f1d6eded9090fcd0d49459848e699e775`

The stale supersession PR was closed because V1.3/Efficacy V2 is already canonical on `main`.

## Console / cutover

Current production-candidate Console checkpoint before release:
- `e03df9955ebc9256a17d70ff4eb8303baf6be66a`

Production cutover branch:
- `release/5dr-edge-production-go-live-final`

Cutover change:
- set `APP_ENV=production`.

Identity mode remains `AUDIT` for this release. Multi-user enforcement is a separate, explicitly deferred workstream and must not be mixed into the 5DR + EDGE Stocks release.

## GO / NO-GO rule

Merge the production cutover only after:
1. EDGE production smoke remains green;
2. the next NSE open-session 5DR automated acceptance passes;
3. the 5DR run shows no fabricated/stale evidence and no unexpected fallback;
4. production deployment succeeds after cutover;
5. post-cutover EDGE smoke and 5DR health are green.

If any gate fails, keep the release unmerged or roll back to the pre-cutover Console checkpoint above. Do not weaken fail-closed behavior to obtain a green result.
