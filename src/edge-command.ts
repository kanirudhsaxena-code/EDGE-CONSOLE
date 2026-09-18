import { isNonEmptyString } from './normalization';

export type EdgeCommand = {
  raw: string;
  target: string;
};

export type EdgeDispatchResult = {
  ok: boolean;
  status: number;
  error?: string;
};

export function parseEdgeCommand(input: unknown): EdgeCommand | null {
  if (!isNonEmptyString(input)) return null;
  const raw = input.trim();
  const match = raw.match(/^EDGE\s+(.+)$/i);
  if (!match) return null;
  const target = match[1].trim();
  if (!target || target.length > 120) return null;
  return { raw, target };
}

export function normalizeTickerCandidate(value: string): string | null {
  const symbol = value.trim().toUpperCase();
  return /^[A-Z0-9._&-]{1,20}$/.test(symbol) ? symbol : null;
}

export async function dispatchEdgeWorkflow(
  token: string,
  ticker: string,
  holdingState = 'UNKNOWN',
): Promise<EdgeDispatchResult> {
  if (!token.trim()) return { ok: false, status: 503, error: 'EDGE dispatch credential is not configured' };
  const response = await fetch(
    'https://api.github.com/repos/kanirudhsaxena-code/EDGE---V1/actions/workflows/autonomous-publish.yml/dispatches',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'EDGE-CONSOLE',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          ticker,
          holding_state: holdingState,
        },
      }),
    },
  );

  if (response.status === 204) return { ok: true, status: 204 };
  let detail = '';
  try {
    const payload = await response.json() as { message?: string };
    detail = payload.message || '';
  } catch {
    detail = await response.text().catch(() => '');
  }
  return {
    ok: false,
    status: response.status,
    error: detail || 'GitHub workflow dispatch failed',
  };
}
