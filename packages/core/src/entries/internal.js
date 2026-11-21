// what-core/internal: what what-core shares with its sibling packages and
// tools (what-server, what-devtools, what-devtools-mcp). Not for applications,
// and not covered by semver: a name here changes with the packages that use it.

// Devtools. what-devtools reads these, and the diagnostics read API below,
// from this module's namespace object.
export { __setDevToolsHooks, __drainPreinstallBuffer, __depsOf, __subsOf, __currentEffect, __ownerOf, __ownerPath } from '../reactive.js';
export { __getCacheSnapshot } from '../data.js';
export { report as reportDiagnostic, subscribe as subscribeDiagnostics, getDiagnostics } from '../diagnostics.js';
export {
  configureGuardrails,
  getGuardrailConfig,
  validateImports,
} from '../guardrails.js';

// The error catalogue, for tools that render or classify errors.
export { ERROR_CODES, createWhatError, classifyError } from '../errors.js';

// Where each name the root entry dropped in 0.15 went (validateImports, docs, lint).
export { IMPORT_CHANGES } from '../import-changes.js';

// Server rendering (what-server).
export {
  getServerContext,
  setServerContext,
  runWithServerContext,
  __installServerContextStorage,
  __flushOutsideServerContext,
  __outsideServerContext,
} from '../server-context.js';
export { beginHeadCollection, endHeadCollection } from '../head.js';
export { escapeHtml as _escapeHtml } from '../markup-rules.js';
export { _isAriaAttr, _beginComponentSSR, _endComponentSSR, _runInComponentSSR } from '../dom.js';
export { _mapArrayToArray } from '../render.js';
// The vnode brand: what-server's renderers and its compiled-markup runtime,
// islands and react-compat recognise vnodes by it.
export { isVNode } from '../vnode-renderer.js';
export { __readHydrationData, __resetHydrationData, _assignOwnerPath, _currentOwnerPath } from '../hydration-data.js';
