import mobile from './mobile-v1-entry';
import app from './index';

/**
 * Production entrypoint shim.
 *
 * The mobile-first worker owns the current Console orchestration routes, while
 * the frozen 5DR result-persistence handler still lives in src/index.ts.
 * Route only the immutable 5DR engine result callback to that handler and keep
 * every other request on the mobile-first entrypoint.
 */
export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/5dr/runs' && request.method === 'POST') {
      return app.fetch(request, env);
    }
    return mobile.fetch(request, env);
  },
};
