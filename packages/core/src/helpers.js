// What Framework - Helpers & Utilities
// Commonly needed patterns, zero overhead.

import { signal, effect, computed, batch } from './reactive.js';

// --- show(condition, vnode) ---
// Conditional rendering. More readable than ternary.
export function show(condition, vnode, fallback = null) {
  return condition ? vnode : fallback;
}

// --- each(list, fn) ---
// Keyed list rendering. Optimized for reconciliation.
export function each(list, fn, keyFn) {
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

// --- useMediaQuery ---
// Reactive media query. Returns a signal.
export function useMediaQuery(query) {
  if (typeof window === 'undefined') return signal(false);
  const mq = window.matchMedia(query);
  const s = signal(mq.matches);
  mq.addEventListener('change', (e) => s.set(e.matches));
  return s;
}

// --- useLocalStorage ---
// Signal synced with localStorage.
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
    } catch { /* quota exceeded, etc */ }
  });

  // Listen for changes from other tabs
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === key && e.newValue !== null) {
        try { s.set(JSON.parse(e.newValue)); } catch {}
      }
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

// --- Transition helper ---
// Animate elements in/out. Returns props to spread on the element.
export function transition(name, active) {
  return {
    class: active ? `${name}-enter ${name}-enter-active` : `${name}-leave ${name}-leave-active`,
  };
}
