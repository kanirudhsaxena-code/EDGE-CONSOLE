# Phase 2.0 G5 — Rollback / Version Recovery Acceptance

Status: implementation candidate

## Objective

Provide a bounded production-recovery path for EDGE-CONSOLE that can restore a previously verified Cloudflare Worker version without changing 5DR/EDGE methodology, canonical selection, Learning Lab governance, trading rules, or the protected pre-open schedules.

## Recovery model

1. Every normal production deployment is tagged `git-<sha12>` in Cloudflare.
2. The deploy workflow verifies the tag exists, verifies the tagged version is present in deployment history, and then checks the live production health contract.
3. Rollback is a manual `workflow_dispatch` operation only.
4. Only the repository owner may execute the rollback workflow.
5. The operator must provide an exact Cloudflare Worker version UUID, a reason, and the exact confirmation phrase.
6. `dry_run=true` is the default and validates the entire target/provenance path without changing production.
7. A live rollback is permitted only when the target version:
   - exists in Wrangler's recoverable version window;
   - carries a governed `git-<sha12>` tag;
   - resolves to a GitHub commit;
   - has a successful `EDGE Console Deploy` run; and
   - has a successful `EDGE Production Smoke` run.
8. Live rollback uses Cloudflare's native `wrangler rollback <VERSION_ID>` operation.
9. After rollback, the workflow proves the target appears in deployment history and validates live EDGE health plus critical renderer/canonical markers.
10. Recovery inventory and before/after evidence are retained as a GitHub Actions artifact for 30 days.

## Fail-closed conditions

Recovery stops without changing production if any of the following is true:

- actor is not the repository owner;
- confirmation phrase is incorrect;
- reason is missing;
- target is not an exact Worker version UUID;
- target is outside the available version window;
- target lacks a governed Git deployment tag;
- target Git commit cannot be resolved;
- prior deploy evidence is not green;
- prior production-smoke evidence is not green;
- current control-plane typecheck/tests fail.

## Protected invariants

G5 is operational recovery only. It must not alter:

- 5DR V2.1/V2.1.2 scoring, forecast, trade methodology or thresholds;
- EDGE Stocks frozen methodology, Market Trust or recommendation logic;
- canonical-selection or official-efficacy rules;
- G4 Learning Lab approval semantics or the production-promotion firewall;
- the NIFTY and EDGE Stocks/LTF protected pre-open canonical workflows;
- the 08:25 IST pre-warm, 08:40 IST canonical window, 08:50/08:55 backups, or 08:55:59 fail-closed cutoff;
- the rule that canonical runner trading remains disabled.

The canonical workflow contract remains covered by `test/preopen-canonical-regression.test.ts` and is reasserted by the G5 recovery regression tests.

## Cloudflare caveat

Cloudflare rollback restores Worker code/version deployment state, not database state. This is intentional: Learning Lab and run records are immutable/append-only and are not automatically reversed. A rollback must therefore target only a previously green release whose current bindings/resources remain compatible.

## G5 acceptance

G5 may be marked complete only after:

1. branch CI is green;
2. the change is merged to `main`;
3. tagged production deploy succeeds;
4. the exact deployed version/tag is verified active;
5. production health and smoke are green;
6. protected NIFTY/LTF canonical regression tests remain green; and
7. a non-mutating G5 dry-run is validated against the newly tagged known-good release, when the release version ID is available from deployment evidence.
