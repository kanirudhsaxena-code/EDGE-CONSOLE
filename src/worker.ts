import router from './router';

type Env = {
  EDGE_DATABASE_URL?: string;
  APP_ENV?: string;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' }
});

function classifyError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('password') || message.includes('authentication') || message.includes('28p01')) return 'AUTHENTICATION';
  if (message.includes('does not exist') || message.includes('relation') || message.includes('column')) return 'QUERY_OR_SCHEMA';
  if (message.includes('connect') || message.includes('fetch failed') || message.includes('network') || message.includes('timeout')) return 'CONNECTION';
  return 'UNKNOWN';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/edge-stocks/health') {
      return json({
        ok: true,
        service: 'EDGE Console',
        edge_database_configured: Boolean(env.EDGE_DATABASE_URL),
        environment: env.APP_ENV ?? null
      });
    }

    try {
      return await router.fetch(request, env as never);
    } catch (error) {
      console.error('Unhandled EDGE Console Worker error', error);
      return json({
        error: 'EDGE Console Worker request failed',
        code: 'EDGE_WORKER_REQUEST_FAILED',
        error_class: classifyError(error),
        edge_database_configured: Boolean(env.EDGE_DATABASE_URL)
      }, 500);
    }
  }
};
