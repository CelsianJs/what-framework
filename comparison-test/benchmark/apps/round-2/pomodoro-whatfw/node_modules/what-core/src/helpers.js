// What Framework - Helpers & Utilities
// Commonly needed patterns, zero overhead.

import { signal, effect, __DEV__ } from './reactive.js';

// --- each(list, fn) --- [DEPRECATED: use <For> component or .map() instead]
// Keyed list rendering. Optimized for reconciliation.
let _eachWarned = false;
export function each(list, fn, keyFn) {
  if (!_eachWarned) {
    _eachWarned = true;
    console.warn('[what] each() is deprecated. Use the <For> component or Array.map() instead.');
  }
  if (!list || list.length === 0) return [];
  return list.map((item, index) => {
    const vnode = fn(item, index);
    if (keyFn && vnode && typeof vnode === 'object') {
      vnode.key = keyFn(item, index);
    }
    return vnode;
  });
}

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

// Component context ref — injected by dom.js to avoid circular imports
let _getCurrentComponentRef = null;
export function _setComponentRef(fn) { _getCurrentComponentRef = fn; }

// --- useMediaQuery ---
// Reactive media query. Returns a signal. Cleans up listener on component unmount.
export function useMediaQuery(query) {
  if (typeof window === 'undefined') return signal(false);
  const mq = window.matchMedia(query);
  const s = signal(mq.matches);
  const handler = (e) => s.set(e.matches);
  mq.addEventListener('change', handler);

  // Register cleanup if inside a component context
  const ctx = _getCurrentComponentRef?.();
  if (ctx) {
    ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
    ctx._cleanupCallbacks.push(() => mq.removeEventListener('change', handler));
  }

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
  const dispose = effect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(s()));
    } catch (e) {
      if (__DEV__) console.warn('[what] localStorage write failed (quota exceeded?):', e);
    }
  });

  // Listen for changes from other tabs
  let storageHandler = null;
  if (typeof window !== 'undefined') {
    storageHandler = (e) => {
      if (e.key === key && e.newValue !== null) {
        try { s.set(JSON.parse(e.newValue)); } catch (err) {
          if (__DEV__) console.warn('[what] localStorage parse failed:', err);
        }
      }
    };
    window.addEventListener('storage', storageHandler);
  }

  // Register cleanup if inside a component context
  const ctx = _getCurrentComponentRef?.();
  if (ctx) {
    ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
    ctx._cleanupCallbacks.push(() => {
      dispose();
      if (storageHandler) window.removeEventListener('storage', storageHandler);
    });
  }

  return s;
}

// --- portal ---
// Render children into a different DOM container.
export function Portal({ target, children }) {
  // In SSR, just return null (portals are client-only)
  if (typeof document === 'undefined') return null;
  const container = typeof target === 'string'
    ? document.querySelector(target)
    : target;
  if (!container) return null;
  // The DOM reconciler will mount children here
  return { tag: '__portal', props: { container }, children: Array.isArray(children) ? children : [children], _vnode: true };
}

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

  const ctx = _getCurrentComponentRef?.();
  if (ctx) {
    ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
    ctx._cleanupCallbacks.push(() => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    });
  }
}

// --- Transition helper ---
// Animate elements in/out. Returns props to spread on the element.
export function transition(name, active) {
  return {
    class: active ? `${name}-enter ${name}-enter-active` : `${name}-leave ${name}-leave-active`,
  };
}
