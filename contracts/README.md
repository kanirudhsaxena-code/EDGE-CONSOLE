# Output Contracts

- `edge-stocks-output.schema.json` — legacy EDGE Stocks V1.1 contract retained for compatibility/history.
- `edge-stocks-output-v1.2.schema.json` — **DEPRECATED / historical only**. It must not be selected for new runs.
- `edge-stocks-output-v1.3.schema.json` — **CANONICAL** for all new standard `EDGE <stock/company/ticker>` outputs.

## EDGE Stocks V1.3 / Efficacy V2

V1.3 enforces the later Efficacy V2 semantic contract:

1. EDGE MASTER ASSESSMENT
2. ACTIVE CALLS
3. CURRENT STOCK OUTCOME
4. DRILL-DOWN

A VERIFIED drill-down component must carry a meaningful evidence-grounded Key Outcome and Interpretation. Missing or boilerplate interpretation fails closed.

OFFICIAL efficacy remains CLOSED/scorable only. PROVISIONAL D+1…D+5 checkpoint diagnostics remain separate and must never overwrite OFFICIAL metrics.

V1.2 is retained only for audit compatibility. Breaking changes require a new contract version; older schemas must never be silently redefined.
