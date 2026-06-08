// Full-stack store server: Node adapter + origin-first ISR + revalidation
// webhook + poll scheduler. `node server.js` → http://localhost:3000.
// No CDN required; add one for edge ISR and the engine fans purges out to it.

import { createServer, createRequestHandler } from 'what-framework/server';
import {
  createCacheEngine,
  createMemoryStore,
  createRevalidateWebhook,
  createScheduler,
} from 'what-cache';
import { routes } from './src/routes.js';

const REVALIDATE_SECRET = process.env.WHAT_REVALIDATE_SECRET || 'dev-secret';

const cache = createCacheEngine({ store: createMemoryStore() });

// Keep the storefront grid warm every 5 minutes regardless of traffic.
const scheduler = createScheduler(cache);
scheduler.register({ path: '/', query: {}, config: routes[0].page }, { intervalMs: 5 * 60 * 1000 });

export function createHandler() {
  return createRequestHandler({
    routes,
    cache,
    revalidateWebhook: createRevalidateWebhook(cache, { secret: REVALIDATE_SECRET }),
    document: { clientEntry: '/src/entry-client.js' },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer({
    routes,
    cache,
    scheduler,
    revalidateWebhook: createRevalidateWebhook(cache, { secret: REVALIDATE_SECRET }),
    document: { clientEntry: '/src/entry-client.js' },
  });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`What Shop → http://localhost:${port}`));
}
