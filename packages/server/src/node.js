// What Framework - Node server runtime.
//
// Keep Node async context and Node-only deployment adapters behind the
// package's `node` export condition. The default entry remains safe to resolve
// in browser and non-Node edge bundles, including client server-action builds.

import { AsyncLocalStorage } from 'node:async_hooks';
import { __installServerContextStorage, __markServerProcess } from 'what-core/internal';

// Async components may access loader/resource/island state after an `await`.
// One process-local provider keeps those reads bound to the request that
// invoked the component even when multiple streams interleave. Every render
// also calls ensureServerRuntime(), which finds the same provider at run time;
// this import is what covers Node releases without process.getBuiltinModule.
__installServerContextStorage(new AsyncLocalStorage(), new AsyncLocalStorage());
// A process that imports the Node server renders on the server from its first
// line on: a query cache used at import time, before the first render, is not
// one every request then shares (ERR_QUERY_OUTSIDE_RENDER).
__markServerProcess();

export * from './index.js';
export { createServer, toNodeListener, whatMiddleware } from './adapter/node.js';
export { exportStatic } from './adapter/static.js';
export { createVercelHandler, buildVercelOutput } from './adapter/vercel.js';
export { createVuraHandler, buildVuraOutput } from './adapter/vura.js';
