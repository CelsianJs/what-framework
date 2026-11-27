// what-core/internal: what what-core shares with its sibling packages and
// tools (what-server, what-devtools, what-devtools-mcp). Not for applications,
// and not covered by semver: a name here changes with the packages that use it.

// Devtools. what-devtools reads these, and the diagnostics read API below,
// from this module's namespace object.
export { _devAction, __setDevToolsHooks, __drainPreinstallBuffer, __depsOf, __subsOf, __currentEffect, __ownerOf, __ownerPath } from '../reactive.js';
export { __getCacheSnapshot, __invalidateFromDevtools, _tagQueries, _pathLoaded } from '../data.js';
// what-server's <Form>: the status useFormStatus() reads, and its submission.
export { _formStatusContext, _formStatus } from '../actions.js';
// what-router's navigation: progress written outside the transition it may
// run in (it shows at once), and the commit it waits for there; and the state
// each <Router> provides to what it renders.
export { _urgent, _currentTransition, _onCommit, _contextOf, _provide, _devHoldsState } from '../reactive.js';
// The development flag, for sibling packages whose development-only text must
// fold away in a production build (what-router's error fixes).
export { __DEV__ } from '../reactive.js';
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
  _runComponentAsync,
  _runComponentSync,
  __markServerProcess,
  _isServerProcess,
  __flushOutsideServerContext,
  __outsideServerContext,
} from '../server-context.js';
export { _engine } from '../reactive.js';
export { beginHeadCollection, endHeadCollection } from '../head.js';
export { escapeHtml as _escapeHtml } from '../markup-rules.js';
export { _isAriaAttr, _beginComponentSSR, _endComponentSSR, _runInComponentSSR, _resetForm, _formMember } from '../dom.js';
// The client renderer a '__portal' vnode carries (react-compat's createPortal).
export { createPortalDOM as _mountPortal } from '../dom.js';
export { _mapArrayToArray, _rowKeyDigest, isHydrating, _claimRegion, _afterWalk } from '../render.js';
// The vnode brand: what-server's renderers and its compiled-markup runtime,
// islands and react-compat recognise vnodes by it.
export { isVNode } from '../vnode-renderer.js';
export { _symbolChild } from '../reactive.js';
export { __readHydrationData, __resetHydrationData, _assignOwnerPath, _ownerCounter, _currentOwnerPath, _actionStateKey, _actionKeySalt, _currentRowPath, _enterRow, _installRowKeys, _leaveRow, _renderSalt, _tracksRows } from '../hydration-data.js';
