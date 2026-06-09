// Full-stack server: wires the Node adapter + the origin-first ISR engine +
// the on-demand revalidation webhook + the poll scheduler. Works on any host —
// no CDN required. `node server.js` and visit http://localhost:3000.

import { createServer, createRequestHandler } from 'what-framework/server';
import {
  createCacheEngine,
  createMemoryStore,
  createRevalidateWebhook,
  createScheduler,
} from 'what-isr';
import { routes } from './src/routes.js';

const REVALIDATE_SECRET = process.env.WHAT_REVALIDATE_SECRET || 'dev-secret';

// Origin ISR cache. Swap createMemoryStore() for createFilesystemStore({dir}) to
// survive restarts, or createRedisStore({client}) for multi-instance.
const cache = createCacheEngine({ store: createMemoryStore() });

// Keep the home listing warm every 5 minutes regardless of traffic.
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

// Started directly (node server.js), not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer({
    routes,
    cache,
    scheduler,
    revalidateWebhook: createRevalidateWebhook(cache, { secret: REVALIDATE_SECRET }),
    document: { clientEntry: '/src/entry-client.js' },
  });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`What Blog → http://localhost:${port}`));
}
