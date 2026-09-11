# EDGE Console Handover

## Purpose
EDGE Console is the mobile-first control plane for 5DR, EDGE Stocks and EDGE IPO.

## Source of truth
- GitHub: code, migrations, contracts and technical documentation.
- Google Drive: human-readable master/governance documentation and reference material.
- Neon: runtime database.
- Cloudflare: hosting, API edge runtime and access control.

## Core rule
The front end consumes only the versioned normalized output contract. Engine internals may change without forcing a UI rebuild.

## Deployment flow
Development -> Staging -> Production. Validate preview/staging before production promotion.

## Rollback
If a new deployment or engine run fails, restore the previous application deployment and retain the last-good published analysis result. Failed/partial/shadow runs remain auditable but must not replace a valid published result automatically.

## Credentials
Never place credential values in this file. Record only the credential name, storage location, owner and renewal/rotation procedure.

## Recovery checklist
1. Confirm GitHub repository availability.
2. Confirm Cloudflare deployment and Access policy.
3. Confirm Neon connectivity.
4. Check `/api/health`.
5. Check latest published run.
6. Roll back application or framework version if needed.

## Change governance
Learning Lab may propose changes autonomously. Production framework changes require validation and explicit approval before promotion.
