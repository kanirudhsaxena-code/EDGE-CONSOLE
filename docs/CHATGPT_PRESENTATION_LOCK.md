# ChatGPT presentation lock — Console is the renderer

Status: production control

## Rule

For ChatGPT-triggered EDGE NIFTY and EDGE Stocks runs, ChatGPT must not reconstruct, summarize or independently format the raw engine result.

The live EDGE Console is the presentation source of truth.

The governed chat runner must:
1. complete the canonical production run;
2. open the deployed Console with an automated browser;
3. select the exact NIFTY request or stock;
4. capture the live rendered Console text from the Console DOM;
5. validate mandatory Console sections;
6. expose only that captured presentation for the ChatGPT response.

If the Console presentation cannot be captured or required sections are missing, the chat workflow fails closed. Raw engine JSON must not be used as a fallback presentation.

## Why this is permanent

The capture reads the Console DOM itself rather than maintaining a second ChatGPT template. Therefore future Console wording, section-order and presentation changes automatically flow into ChatGPT once deployed.

Visual CSS cannot be reproduced inside ChatGPT, but the rendered Console information hierarchy, labels and visible content remain the source.

## Covered paths

- EDGE NIFTY: assessment + current rendered NIFTY output.
- EDGE Stocks: the full canonical EDGE Stocks renderer, including master assessment, current stock outcome, drill-down and active calls.

This control changes presentation only. It does not modify analytical methodology, probabilities, DES, Market Trust, BOT, Decision Ladder, recommendation semantics, efficacy, persistence or Learning Lab governance.

CI requirement: any change that breaks the Console DOM capture selectors or mandatory section validation must fail before merge.

Capture-only validation is supported for existing canonical runs, so presentation tests do not need to create duplicate forecasts.

## G5 visible-path closure — 4 Oct 2026

For EDGE Stocks, the governed chat runner must wait for the complete five-session D:D+4 Console DOM before capture succeeds. The parity requirement is mandatory on every standard stock run and may not be disabled by request metadata.

The captured presentation must include all five rows with trading date, direction, Bull/Base/Bear probabilities, expected zone, regime context, evidence basis and verification state, and must parity-check them against the governed API read model.

A VERIFIED drill-down row with missing persisted key outcome or interpretation is a presentation failure. ChatGPT must not substitute score-derived prose.


## Build 2.75 NIFTY invocation lock — 7 Oct 2026

A user command to run EDGE NIFTY / NIFTY EDGE is an execution request, not an inspection request.

The canonical ChatGPT execution path is:
1. update the permanent launcher file `requests/chat-run/nifty.json` on branch `chat-edge-production` with a fresh `client_invocation_id`, `module: EDGE_NIFTY`, and no `capture_only`;
2. allow `EDGE Chat · Console-rendered Production Run` to create the governed Console request;
3. preserve the exact request_id through acquisition, normalization, engine execution and publication;
4. capture the exact published run from the live Console DOM;
5. return only the validated Console presentation.

Inspection of Drive, GitHub state, assessment handoff or market data is not execution and must never be described as a completed run. A NIFTY execution response is invalid unless a fresh request_id exists, or the user explicitly requested capture-only readback of an existing request.

The permanent launcher is an orchestration simplification only. It does not change 5DR methodology, probabilities, DES5, Market Trust, Execution Edge, efficacy, canonical selection or Learning Lab governance.


## Build 2.75 corrective user-output contract — 7 Oct 2026

The prior NIFTY rule that treated the expanded live Console DOM as the ChatGPT presentation source is superseded for standard EDGE NIFTY responses.

### Authoritative standard NIFTY response

For every fresh EDGE NIFTY user invocation, the chat workflow must create a deterministic user payload from the exact published run and that run's frozen assessment snapshot.

The standard user payload is exactly:

1. `TABLE 1 — 5DR ASSESSMENT & EFFICACY`
2. `TABLE 2 — CURRENT 5DR RUN`

No standard response may include diagnostic narrative sections such as `WHAT WE SAW`, `WHAT IT MEANS`, `WHY IT MATTERS NOW`, `Advanced details`, or `Future performance scorecard` unless the user explicitly requests a drill-down.

The user-facing horizon labels are exactly `D, D+1, D+2, D+3, D+4`. Internal engine slots may remain `D+1..D+5`; the mapping is presentation-only and must be deterministic.

### Exact-run binding

The generated user payload must be bound to:

- the fresh `request_id`;
- the exact published `run_id`;
- the exact frozen assessment snapshot embedded in that published result;
- a SHA-256 hash of the rendered user payload.

A request/run identity mismatch, missing frozen assessment, incomplete five-session path, missing probability vector, missing forecast/recommendation assessment, or missing tradeability information is a hard failure. No previous run, latest-run lookup, raw JSON fallback, or model reconstruction may be substituted.

### Console role

The live Console remains a verification/readback and diagnostic surface. It is not allowed to redefine the standard NIFTY chat format.

The workflow may validate the same run is visible in the Console, but a green Console render is not sufficient for user-path acceptance.

### Chat handoff rule

A successful NIFTY chat workflow must preserve:

- `chat-user-output.md` — exact two-table user response;
- `chat-user-output-manifest.json` — request/run identity, horizon contract and output hash;
- the Console capture and raw run files for diagnostics.

ChatGPT must return the exact validated `chat-user-output.md` content for the invocation. It must not summarize, reformat, reconstruct or replace it. If the exact validated artifact cannot be retrieved, the user invocation is not complete and must fail closed.

Therefore the following are explicitly different states:

- **RUN COMPLETE** — engine published a governed result.
- **CONSOLE VALID** — exact result rendered in Console.
- **CHAT USER OUTPUT VALID** — exact two-table payload passed contract validation.
- **USER DELIVERED** — ChatGPT returned that validated payload to the user.

No earlier state may be reported as end-to-end success.

This correction changes orchestration and presentation only. It does not change 5DR methodology, DES5, probability mapping, Market Trust, Event Shock, tradeability thresholds, canonical selection, efficacy or Learning Lab governance.
