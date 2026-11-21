// what-router/match: route matching without the DOM, for server adapters and
// other code that must not load the client router.
export { compilePath, matchRoute, parseQuery } from './index.js';
export type { CompiledPath } from './index.js';
