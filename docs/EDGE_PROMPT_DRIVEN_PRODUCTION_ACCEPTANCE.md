# EDGE Stocks Prompt-Driven Autonomous Invocation — Production Acceptance

**Status:** PRODUCTION ACCEPTED / GO  
**Accepted:** 18 September 2026  
**Command contract:** `EDGE <stock/company/ticker>`  
**Output contract:** `EDGE_STOCKS_V1_2`

## Accepted production path

`EDGE <ticker/company>`
→ EDGE Console command parser
→ governed ticker/company resolution
→ Cloudflare-secured invocation API
→ GitHub workflow dispatch
→ existing `EDGE---V1` autonomous publisher
→ frozen EDGE V1 methodology
→ Neon persistence
→ EDGE Console V1.2 report API
→ exactly two canonical standard tables
→ efficacy separately.

## Production proof

### Runtime readiness
- EDGE Console deploy commit: `8d46b2c14af882dcb4c94a018b374d6b385fc0bd`
- Cloudflare Worker deployment: successful
- `EDGE_GITHUB_TOKEN` synced into Worker runtime: successful
- Production dispatch-readiness gate: successful
- GitHub workflow access: `autonomous-publish.yml`
- Trading execution: disabled

### Real prompt-path test
Command:
`EDGE JIOFIN`

Live Console invocation result:
- status: `DISPATCHED`
- engine: `EDGE_STOCKS`
- contract: `EDGE_STOCKS_V1_2`
- ticker: `JIOFIN`
- trading_enabled: `false`

Triggered governed workflow:
- Repository: `kanirudhsaxena-code/EDGE---V1`
- Workflow: `EDGE Autonomous Publish`
- Run ID: `35377835620`
- Conclusion: `success`

Published immutable recommendation:
- recommendation_id: `EDGE-JIOFIN-20260918-180236-AUTO`
- persistence_id: `EDGE-JIOFIN-20260918-180236-AUTO`
- status: `PUBLISHED`
- trading_enabled: `false`

### Canonical report reconciliation
A second production E2E check confirmed the live report API returned the same run:
- `contract_version = EDGE_STOCKS_V1_2`
- `ticker = JIOFIN`
- `run_id = EDGE-JIOFIN-20260918-180236-AUTO`
- exactly two standard tables
- Table 1 = `EDGE_OUTCOME_DECISION`
- Table 2 = `INSTITUTIONAL_DRILLDOWN`
- OFFICIAL efficacy label preserved
- PROVISIONAL checkpoint diagnostics label preserved

## Governance boundary

This acceptance does not change EDGE V1 scoring, weights, DES, Market Trust, probability logic, BOT, decision ladder, execution semantics, efficacy rules, historical records, or Learning Lab governance.

The prompt layer only routes a governed command into the already-approved autonomous EDGE Stocks production runner.

## Fail-closed behavior

The prompt-driven path blocks rather than guessing when:
- the command is not in canonical `EDGE <...>` form;
- a company name cannot be resolved unambiguously;
- the dispatch credential is absent or unusable;
- the autonomous runner fails its efficacy/evidence/release gates;
- mandatory V1.2 output fields are incomplete.

Same-day autonomous recommendations remain idempotent: if a governed run already exists for the ticker that trading day, the Console returns that run rather than creating a duplicate.
