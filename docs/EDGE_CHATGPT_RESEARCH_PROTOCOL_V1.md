# EDGE ChatGPT Research Protocol V1

Status: GOVERNED IMPLEMENTATION CONTRACT

For any user command of the form `EDGE <stock/company/ticker>`, ChatGPT is the mandatory research and orchestration authority.

Sequence:
1. Retrieve/assess prior EDGE recommendations and efficacy context.
2. Perform fresh stock-specific web research for the current run.
3. Use native ChatGPT web research as mandatory retrieval. Exa may be used as an optional retrieval accelerator. Upstox may be consumed as structured supporting evidence.
4. Prefer company, exchange and regulatory primary sources for corporate facts. Use credible secondary sources for corroboration/context.
5. Distinguish publication date from event date and reject recycled news as a fresh catalyst.
6. Reconcile material claims. HIGH/CRITICAL claims cannot be VERIFIED solely by Upstox and require independent web validation.
7. Build exactly one `EDGE_RESEARCH_BUNDLE_V1` with source provenance, claims, materiality, direction, verification state and limitations.
8. Submit `{command,research_bundle}` through the governed EDGE chat request bridge.
9. EDGE---V1 independently revalidates the bundle before frozen computation.
10. Final user output is the canonical Efficacy V2 order: EDGE MASTER ASSESSMENT, ACTIVE CALLS, CURRENT STOCK OUTCOME, DRILL-DOWN.

Fail-closed rules:
- No fresh ChatGPT research bundle: no production recommendation.
- Missing CHATGPT_WEB: no production recommendation.
- Stale research (>24h): no production recommendation.
- HIGH/CRITICAL provider-only validation: no production recommendation.
- Unresolved HIGH/CRITICAL conflict: no production recommendation.
- Missing assessment-first output or meaningful VERIFIED interpretation: no production acceptance.

Exa is optional and must never be a single point of failure or authority. Upstox is a supporting provider and cannot self-validate its own material research claims.
