// Cloudflare Workers adapter — exposes a `fetch(request, env, ctx)` worker
// entry over the same Web-Fetch core handler. ISR runs via the origin cache
// engine; pass a what-cache redis/KV-backed store for cross-isolate caching and
// use ctx.waitUntil for background regeneration.

import { createRequestHandler } from './core.js';

export function createCloudflareHandler(options = {}) {
  const handle = createRequestHandler(options);
  return {
    async fetch(request, env, ctx) {
      // Expose env/ctx to render via the request for adapters that need them.
      if (env) request.__env = env;
      if (ctx) request.__ctx = ctx;
      return handle(request);
    },
  };
}
