# Phase 2.0 G4 — Promotion Governance Acceptance

Status: implementation candidate

## Scope

G4 adds the governed human-decision layer on top of the immutable G3 Learning Lab state. It does not alter the frozen 5DR/EDGE scoring methodology, canonical selection, official efficacy populations, tradeability logic, or the protected pre-open canonical workflows.

## Acceptance requirements

1. The latest Learning Lab snapshot is visible for both `5DR` and `EDGE_STOCKS`.
2. Presentation state is explicit: `LIVE`, `PARTIAL`, `STALE`, or `FAILED`.
3. Pending challenger candidates expose proposal, baseline metrics, challenger metrics and validation state before any decision.
4. Governance decisions are explicit user actions: `APPROVE`, `REJECT`, or `DEFER`.
5. Governance decisions require authenticated `OWNER` identity.
6. `APPROVE` maps only to `APPROVED_FOR_BUILD`.
7. Every decision is recorded in `learning_approval_events_vnext` with the frozen candidate content hash and decision context.
8. Approval is build/validation authorization only. `production_change_allowed` and `production_promotion_authorized` remain `false`.
9. Automatic adoption remains prohibited.
10. Existing immutable Learning Lab import routes remain reachable through the production wrapper.
11. Existing 5DR production result persistence remains routed exactly as before.
12. The 08:40 NIFTY/LTF canonical path, frozen methodology, Market Trust, recommendation logic, canonical selection, efficacy rules and trading logic are not modified by this gate.

## Staleness contract

The G4 presentation layer marks a complete snapshot as `STALE` after 36 hours. A missing/invalid/future snapshot or an explicit failure/block/invalid data-quality state is `FAILED`. `PARTIAL` snapshots and degraded/gap quality states remain visible but are not represented as current-complete learning state.

This is a presentation/governance freshness contract only. It does not control production forecast release.

## Promotion firewall

`PENDING_USER_APPROVAL -> APPROVED_FOR_BUILD` means the challenger may enter the next build/validation stage. It does **not** mean approved for production. Production promotion requires a separate explicit gate and separate user approval after the required evidence window.

For `CORE_ZONE_V0.1`, SHADOW status remains unchanged until its formal review evidence is available and separately approved.
