# P0-07 — Two-stage morning canonical timing contract

Status: Phase 2.0 acceptance contract; production methodology unchanged until governed release.

## Stage 1 — PREP_BUNDLE

At 08:50 IST, preparation only. Persist an immutable PREP_BUNDLE for the target trading date containing prior close, overnight/global context, approved current research, calendar/provider readiness, and all evidence that does not require the NSE regular pre-open session.

Required identity: bundle_id, target_trading_date, created_at_ist, contract_version, ordered source list/provenance, payload_hash. The bundle is immutable after persistence.

08:50 is not an ordinary canonical issuance time and must not be represented as auction-state evidence.

## Stage 2 — AUCTION_SNAPSHOT and ordinary canonical

At 09:10–09:12 IST, retrieve and hash-verify the PREP_BUNDLE and acquire attributable exchange-derived auction evidence. Preferred Upstox surface: Market Data Feed V3 `preOpenSessionStatus` plus Indicative Equilibrium Price (IEP), or an equivalently attributable exchange-derived pre-open field.

Intraday candle availability MUST NOT be used as the pre-open market-state signal.

Freeze an immutable AUCTION_SNAPSHOT before 09:15 IST with timestamp, payload hash and source provenance. Generate both NIFTY and Stock/LTF ORDINARY_PREOPEN canonical candidates solely from the verified PREP_BUNDLE plus frozen AUCTION_SNAPSHOT and complete them before 09:15 IST.

Any auction request/response at or after 09:15 IST is ineligible for ordinary pre-open evidence. Transport retries are bounded resilience only and never substitute for unavailable auction evidence. If no valid ordinary candidate completes before 09:15, persist MISSING.

A 09:20 finalizer may select/verify only an already-completed pre-open candidate. It MUST NOT recalculate with post-open evidence.

Later same-day recovery is EXCEPTION_CANONICAL and MUST NOT repair or enter the ORDINARY_PREOPEN efficacy population.

## Population isolation

ORDINARY_PREOPEN, EXCEPTION_CANONICAL, REPLAY and DIAGNOSTIC are distinct populations and may not be silently reclassified.

## Acceptance failures

Fail P0-07 if any of the following occurs: 08:50 creates an ordinary canonical; candle availability stands in for auction state; auction evidence is acquired/frozen at or after 09:15 for an ordinary canonical; the 09:20 finalizer recalculates; missing auction evidence is backfilled into ordinary efficacy; PREP_BUNDLE or AUCTION_SNAPSHOT lacks immutable identity/hash/provenance; or NIFTY/Stock ordinary canonical is not derived solely from the verified two-stage evidence chain.

## Downstream linkage

P0-08 consumes only an eligible successful parent canonical. Core SHADOW horizons for both NIFTY and Stocks are exactly ordered D,D+1,D+2,D+3,D+4; D+5, missing D, wrong order, or any non-five-row payload fails closed.
