# Cost Controls

EDGE Console is zero-cost-first.

## Policy
- No paid upgrade without explicit approval.
- Use free allowances first.
- Prefer caching, lower refresh frequency and manual fallback before adding paid capacity.
- Configure usage warnings where providers support them.

## Provider approach
- Cloudflare: free Worker, static assets and Zero Trust capabilities first.
- Neon: stay within the Free plan and control retained data volume.
- GitHub: keep Actions usage light.
- Google Drive: governance and reference storage only.
- Upstox: data integration only in the initial release.

## Fallback order
1. Keep the console readable.
2. Preserve the last-good published result.
3. Reduce refresh frequency.
4. Fall back to manual or hybrid ingestion.
5. Require approval before spending.
