# Security

## Principles

- No broker order placement in V1.
- No credentials or tokens in GitHub or Google Drive documents.
- Production access is protected by Cloudflare Access.
- Secrets live only in provider secret stores (for example Cloudflare Worker secrets or GitHub Actions secrets when required).
- Public repository content must remain non-sensitive.

## Current Cloudflare foundation

- Zero Trust plan: Free
- Team: `edge-intelligence`
- Team domain: `edge-intelligence.cloudflareaccess.com`
- Default one-time PIN authentication is available.
- Access application will be created only after a deployed console URL exists.

## Secrets registry policy

Documentation may record secret names, purpose, storage location, owner, rotation date and renewal steps, but never secret values.

Expected secret names include:

- `DATABASE_URL`
- Upstox access/refresh credentials when the engine integration reaches that stage
- Any future provider-specific API credentials

## Data controls

- Raw evidence and normalized results are distinct.
- Every run stores provenance and framework version.
- Failed/partial runs do not silently replace published results.
- Learning proposals cannot promote themselves to production.
