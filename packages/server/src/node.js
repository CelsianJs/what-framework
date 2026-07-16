// What Framework - Node server runtime.
//
// Keep Node async context and Node-only deployment adapters behind the
// package's `node` export condition. The default entry remains safe to resolve
// in browser and non-Node edge bundles, including client server-action builds.

import { AsyncLocalStorage } from 'node:async_hooks';
import { __installServerContextStorage } from 'what-core';

// Async components may access loader/resource/island state after an `await`.
// One process-local provider keeps those reads bound to the request that
// invoked the component even when multiple streams interleave.
__installServerContextStorage(new AsyncLocalStorage());

export * from './index.js';
export { createServer, toNodeListener, whatMiddleware } from './adapter/node.js';
export { exportStatic } from './adapter/static.js';
export { createVercelHandler, buildVercelOutput } from './adapter/vercel.js';
