// What Framework - Helpers & Utilities
// Commonly needed patterns, zero overhead.

import { signal, effect, onCleanup, __DEV__ } from './reactive.js';
import { _vnode } from './h.js';
import { createPortalDOM } from './dom.js';
import { report } from './diagnostics.js';

// --- cls(...args) ---
// Conditional class names. Like clsx but tiny.
// cls('base', condition && 'active', { hidden: isHidden, bold: isBold })
export function cls(...args) {
  const classes = [];
  for (const arg of args) {
    if (!arg) continue;
    if (typeof arg === 'string') {
      classes.push(arg);
    } else if (typeof arg === 'object') {
      for (const [key, val] of Object.entries(arg)) {
        if (val) classes.push(key);
      }
    }
  }
  return classes.join(' ');
}

// --- style(obj) ---
// Convert a style object to a CSS string for SSR.
export function style(obj) {
  if (typeof obj === 'string') return obj;
  return Object.entries(obj)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${camelToKebab(k)}:${v}`)
    .join(';');
}

function camelToKebab(str) {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}

// --- debounce ---
// Debounced signal updates.
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// --- throttle ---
export function throttle(fn, ms) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  };
}

// --- useMediaQuery ---
// Reactive media query. Returns a signal. Cleans up listener on component unmount.
export function useMediaQuery(query) {
  if (typeof window === 'undefined') return signal(false);
  const mq = window.matchMedia(query);
  const s = signal(mq.matches);
  const handler = (e) => s.set(e.matches);
  mq.addEventListener('change', handler);

  // Stop listening when the owner (the component using it) goes away.
  onCleanup(() => mq.removeEventListener('change', handler));

  return s;
}

// --- useLocalStorage ---
// Signal synced with localStorage. Cleans up listeners on component unmount.
export function useLocalStorage(key, initial) {
  let stored;
  try {
    const raw = localStorage.getItem(key);
    stored = raw !== null ? JSON.parse(raw) : initial;
  } catch {
    stored = initial;
  }

  const s = signal(stored);

  // Sync to localStorage on changes
  effect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(s()));
    } catch (e) {
      if (__DEV__) report('ERR_STORAGE_FAILED', { data: { key, operation: 'write', reason: e?.message || String(e) } });
    }
  });

  // Listen for changes from other tabs
  /** @type {((e: StorageEvent) => void) | null} */
  let storageHandler = null;
  if (typeof window !== 'undefined') {
    storageHandler = (e) => {
      if (e.key === key && e.newValue !== null) {
        try { s.set(JSON.parse(e.newValue)); } catch (err) {
          if (__DEV__) report('ERR_STORAGE_FAILED', { data: { key, operation: 'read', reason: err?.message || String(err) } });
        }
      }
    };
    window.addEventListener('storage', storageHandler);
  }

  // The sync effect belongs to the owner it is created under; the listener
  // goes with that owner too.
  onCleanup(() => {
    if (storageHandler) window.removeEventListener('storage', storageHandler);
  });

  return s;
}

// --- portal ---
// Render children into a different DOM container. Compiled children arrive
// unbuilt (`_deferChildren`, see dom.js _installLazyChildren) and are built in
// the container: while hydrating, children built where the portal is placed
// would claim the server's nodes there.
export const Portal = /* @__PURE__ */ Object.assign(function Portal({ target, children }) {
  // In SSR, just return null (portals are client-only)
  if (typeof document === 'undefined') return null;
  const container = typeof target === 'string'
    ? document.querySelector(target)
    : target;
  if (!container) return null;
  // The DOM reconciler will mount children here
  return _vnode('__portal', { container, mount: createPortalDOM }, Array.isArray(children) ? children : [children]);
}, { _deferChildren: true });

// --- useClickOutside ---
// Detect clicks outside a ref'd element. Essential for dropdowns, modals, popovers.
export function useClickOutside(ref, handler) {
  if (typeof document === 'undefined') return;

  const listener = (e) => {
    const el = ref.current || ref;
    if (!el || el.contains(e.target)) return;
    handler(e);
  };

  document.addEventListener('mousedown', listener);
  document.addEventListener('touchstart', listener);

  onCleanup(() => {
    document.removeEventListener('mousedown', listener);
    document.removeEventListener('touchstart', listener);
  });
}

// --- transitionClass(name, active) ---
// Enter/leave classes for a CSS transition, as props to spread on the element.
export function transitionClass(name, active) {
  return {
    class: active ? `${name}-enter ${name}-enter-active` : `${name}-leave ${name}-leave-active`,
  };
}
