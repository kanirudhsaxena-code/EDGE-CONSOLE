# G5 D:D+4 Critical Path — 30 Sep 2026

Status: IMPLEMENTATION IN PROGRESS

## Outcome
A standard `EDGE <ticker>` request must return one governed production EDGE Stocks output whose current forecast path contains exactly five ordered NSE trading sessions: D, D+1, D+2, D+3, D+4. The live EDGE Console is the ChatGPT presentation source of truth. Current D+5 forecast semantics are prohibited.

## Critical sequence
1. Production contract binding.
2. Trading-calendar semantics.
3. Five-row engine payload.
4. Immutable persistence/readback.
5. Console rendering in the existing four-section order.
6. Governed Chat capture/parity validation.
7. Permanent schema and D+5 rejection tests.
8. LTF + CUPID targeted regression.
9. Fresh governed end-to-end acceptance and production manifest promotion.

## Frozen boundaries
No change to EDGE_V1 scoring, weights, probabilities, DES, Market Trust, BOT, Decision Ladder, execution rules, canonical-selection rules, official efficacy rules, or historical recommendations.

## Paused until acceptance
P0-07 pre-open hardening; Core Zone/G6; PVPO/G7; IPO/P0-14 remediation; Learning Lab/P0-13 enhancements beyond strict acceptance needs; UI polish; multi-user/security hardening; new data providers; broad refactors; unrelated NIFTY presentation work.

## Acceptance checklist
- [ ] Contract requires exactly D:D+4.
- [ ] Calendar includes D and next four valid NSE sessions.
- [ ] Machine output carries exactly five day-wise rows.
- [ ] All five rows persist/read back immutably.
- [ ] Console renders all five rows inside CURRENT STOCK OUTCOME.
- [ ] Current D+5 forecast wording is rejected.
- [ ] Standard four-section EDGE Stocks hierarchy remains unchanged.
- [ ] Governed Chat uses RUN -> CONSOLE -> CAPTURE -> VALIDATE -> DISPLAY.
- [ ] Chat/Console mandatory-field parity passes.
- [ ] LTF regression passes.
- [ ] CUPID false-negative regression passes.
- [ ] Fresh governed production run passes.
- [ ] Production release manifest updated only after acceptance.
