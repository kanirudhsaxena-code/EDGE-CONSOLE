#!/usr/bin/env node

const base = String(process.env.P0_BASE_URL || '').replace(/\/$/, '');
const ticker = String(process.env.P0_TICKER || 'LTF').trim().toUpperCase();
if (!base) {
  console.error('P0_BASE_URL is required');
  process.exit(2);
}

const authHeaders = {};
if (process.env.P0_AUTHORIZATION) authHeaders.authorization = process.env.P0_AUTHORIZATION;
if (process.env.P0_CF_ACCESS_CLIENT_ID) authHeaders['CF-Access-Client-Id'] = process.env.P0_CF_ACCESS_CLIENT_ID;
if (process.env.P0_CF_ACCESS_CLIENT_SECRET) authHeaders['CF-Access-Client-Secret'] = process.env.P0_CF_ACCESS_CLIENT_SECRET;

const checks = [
  {
    id: 'P0-03',
    name: 'NIFTY current run',
    path: '/api/5dr/current',
    validate: body => body && body.run && body.run.run_id && body.retrieval?.kind === 'CURRENT_LATEST_SUCCESSFUL_PUBLISHED',
  },
  {
    id: 'P0-04',
    name: `EDGE Stocks current run (${ticker})`,
    path: `/api/edge-stocks/current?ticker=${encodeURIComponent(ticker)}`,
    validate: body => body && body.current_run && body.current_run.recommendation_id && body.retrieval?.kind === 'CURRENT_LATEST_TICKER_RUN',
  },
  {
    id: 'P0-05',
    name: '5DR canonical performance',
    path: '/api/5dr/canonical-performance',
    validate: body => body && body.engine === '5DR' && body.retrieval?.exact_persisted_snapshot === true,
  },
  {
    id: 'P0-05',
    name: `EDGE canonical performance (${ticker})`,
    path: `/api/edge-stocks/canonical-performance?ticker=${encodeURIComponent(ticker)}`,
    validate: body => body && body.engine === 'EDGE_STOCKS' && body.retrieval?.exact_persisted_selection === true && Array.isArray(body.canonical_runs),
  },
];

let failed = 0;
for (const check of checks) {
  const url = base + check.path;
  try {
    const response = await fetch(url, { headers: { accept: 'application/json', ...authHeaders }, redirect: 'follow' });
    let body = null;
    try { body = await response.json(); } catch {}
    const ok = response.ok && check.validate(body);
    console.log(JSON.stringify({ id: check.id, name: check.name, url, http_status: response.status, passed: Boolean(ok) }));
    if (!ok) failed += 1;
  } catch (error) {
    console.log(JSON.stringify({ id: check.id, name: check.name, url, passed: false, error: error instanceof Error ? error.message : String(error) }));
    failed += 1;
  }
}

if (failed) {
  console.error(`P0 live acceptance failed: ${failed}/${checks.length} checks failed`);
  process.exit(1);
}
console.log(`P0 live acceptance passed: ${checks.length}/${checks.length} checks passed`);
