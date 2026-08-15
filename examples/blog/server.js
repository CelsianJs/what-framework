// Full-stack server: wires the Node adapter + the origin-first ISR engine +
// the on-demand revalidation webhook + the poll scheduler. Works on any host —
// no CDN required. `node server.js` and visit http://localhost:3000.

import { createServer, createRequestHandler, renderDocument } from 'what-framework/server';
import {
  createCacheEngine,
  createMemoryStore,
  createRevalidateWebhook,
  createScheduler,
} from 'what-isr';
import { routes } from './src/routes.js';

const REVALIDATE_SECRET = process.env.WHAT_REVALIDATE_SECRET || 'dev-secret';

const documentOptions = { clientEntry: '/src/entry-client.js' };

// The scheduler regenerates a page with nobody asking for it, so there is no
// incoming request to render from. It calls engine.regenerate(), which uses the
// engine's own `render`. Without one, every scheduled tick throws
// `doRender is not a function` into the logger and nothing is ever kept warm.
// Function declarations hoist, so referencing renderRoute above its definition
// is fine.
const cache = createCacheEngine({ store: createMemoryStore(), render: renderRoute });

async function renderRoute(routeMatch) {
  const { route, params, query, request } = routeMatch;
  const reqCtx = { params, query, request };
  const pageModule = { default: route.component, loader: route.loader };
  return {
    html: await renderDocument(pageModule, reqCtx, documentOptions),
    status: 200,
    tags: (routeMatch.config && routeMatch.config.tags) || [],
    path: routeMatch.path,
  };
}

// Keep the home listing warm every 5 minutes regardless of traffic. `route` and
// `params` are both required: renderRoute reads route.component and route.loader,
// and a registration without them renders nothing even once a render exists.
const scheduler = createScheduler(cache);
scheduler.register(
  { path: '/', query: {}, params: {}, config: routes[0].page, route: routes[0] },
  { intervalMs: 5 * 60 * 1000 }
);

export function createHandler() {
  return createRequestHandler({
    routes,
    cache,
    revalidateWebhook: createRevalidateWebhook(cache, { secret: REVALIDATE_SECRET }),
    document: documentOptions,
  });
}

// Started directly (node server.js), not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer({
    routes,
    cache,
    scheduler,
    revalidateWebhook: createRevalidateWebhook(cache, { secret: REVALIDATE_SECRET }),
    document: documentOptions,
  });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`What Blog → http://localhost:${port}`));
}
