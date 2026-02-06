// What Framework - Core
// The closest framework to vanilla JS.

// Reactive primitives
export { signal, computed, effect, batch, untrack } from './reactive.js';

// Virtual DOM
export { h, Fragment, html } from './h.js';

// DOM mounting & rendering
export { mount } from './dom.js';

// Hooks (React-compatible API)
export {
  useState,
  useSignal,
  useComputed,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useContext,
  useReducer,
  createContext,
} from './hooks.js';

// Component helpers
export { memo, lazy, Suspense, ErrorBoundary } from './components.js';

// Store
export { createStore, atom } from './store.js';

// Head management
export { Head, clearHead } from './head.js';

// Utilities
export {
  show,
  each,
  cls,
  style,
  debounce,
  throttle,
  useMediaQuery,
  useLocalStorage,
  Portal,
  transition,
} from './helpers.js';
