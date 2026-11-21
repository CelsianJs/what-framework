// What Framework - Core
//
// The root entry: what an app needs to write components, from React's names
// (which mean what they mean in React) and What's signals. Domain kits are
// subpaths (what-framework/a11y, /ui, /motion, /dom, /form, /data), the
// compiled-JSX runtime is what-framework/render, and what sibling packages
// share with what-core is what-core/internal. test/exports.test.js pins this
// list, so growth is a decision. Names that left this entry, and where they
// went, are in import-changes.js.

// Reactivity
export { signal, effect, batch, untrack, flushSync, createRoot, getOwner, runWithOwner } from './reactive.js';
// Async values in the graph: computed() may return a promise; transitions,
// optimistic overlays and React 19's use() are built on it (docs/ASYNC.md).
export { computed, refresh, isPending, startTransition, useTransition, useOptimistic, use, settled } from './async.js';
// O(1) keyed selection: isSelected(key) re-runs only the readers of the keys a change involves.
export { createSelector } from './selector.js';

// Rendering. h, Fragment and Island are also compiler targets: compiled JSX
// imports them from here.
export { h, Fragment, html } from './h.js';
export { mount } from './dom.js';
export { hydrate } from './render.js';
export { applyStreamedBoundaries } from './hydration-data.js';

// Hooks
export {
  useState,
  useSignal,
  useComputed,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useReducer,
  createContext,
  useContext,
  onMount,
  onCleanup,
  createResource,
  useLoaderData,
} from './hooks.js';
export { useId } from './a11y.js';

// Components and boundaries
export { memo, lazy, Suspense, ErrorBoundary, Show, For, Switch, Match, Island } from './components.js';
export { Portal } from './helpers.js';

// Stores
export { createStore, derived } from './store.js';

// Document head and the server response
export { Head } from './head.js';
export { getResponse } from './server-context.js';

// Diagnostics: what development checks reported, and what a code means
export { getDiagnostics, subscribe as subscribeDiagnostics, clearDiagnostics } from './diagnostics.js';
export { getErrorDefinition, WhatError } from './errors.js';
