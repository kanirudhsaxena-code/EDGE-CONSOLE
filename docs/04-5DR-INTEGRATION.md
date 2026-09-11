# 5DR Integration

## Production boundary

EDGE Console does not reimplement the 5DR forecasting engine. It consumes normalized 5DR releases and persists them through the versioned EDGE Console contract.

Current 5DR production model: `5DR_V2_1`  
Current 5DR release contract: `5DR_V2_1_2`  
EDGE Console envelope contract: `1.0`

## Required V2.1.2 release invariants

A 5DR release is rejected unless it contains:

- non-empty Forecast Assessment;
- non-empty Recommendation Assessment;
- a completed assessment snapshot;
- D+1, D+2, D+3, D+4 and D+5 horizon slots;
- a completed recommendation ledger.

These requirements mirror the production release validation implemented in the 5DR-V2 repository. Historical V2.1.1 rows may remain historical records, but new production releases into EDGE Console use V2.1.2.

## API

### `GET /api/5dr/latest`
Returns the latest published 5DR run including normalized result payload.

### `POST /api/5dr/runs`
Accepts a normalized 5DR run. The endpoint validates the envelope and V2.1.2 release invariants before persistence.

Rules:

- `run_id` is immutable and unique;
- only `SUCCESS` runs may be published;
- provenance must be `MANUAL`, `HYBRID` or `AUTOMATED`;
- source list and freshness are persisted with the run;
- shadow/failed/partial runs can be stored but cannot become the published production result through this endpoint.

## Security

The Worker is protected by Cloudflare Access. Database credentials are held only as the Cloudflare Worker secret `DATABASE_URL`; they must never be committed to GitHub or copied into documentation.

For future autonomous engine-to-console publication, use a dedicated machine/service authentication mechanism rather than weakening the user-facing Access policy.

## Next adapter step

Connect the 5DR execution/output process to this ingestion boundary. Manual screenshot evidence remains an optional input path. The engine must emit the normalized payload; the Console remains stable even if the internal 5DR implementation evolves.
