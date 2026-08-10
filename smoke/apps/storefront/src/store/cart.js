// Global cart store.
//
// Module-scoped, so every page that imports it reads and writes the SAME state:
// this is What's answer to a global store, and it is what the suite checks when
// it asserts the header badge on one page reflects an add performed on another.
//
// Persistence is deliberate too. The cart survives a full page reload, which is
// a real requirement for a storefront and the only way to prove that client
// state is not silently reset by hydration.

import { signal, computed, batch } from 'what-framework';

const STORAGE_KEY = 'storefront:cart:v1';

function readPersisted() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((l) => l && typeof l.slug === 'string') : [];
  } catch {
    return []; // corrupt storage must not take the whole store down
  }
}

// `lines` is the single source of truth: [{ slug, title, price, qty }]
export const lines = signal(readPersisted(), 'cart:lines');

export const count = computed(() => lines().reduce((n, l) => n + l.qty, 0));
export const subtotal = computed(() => lines().reduce((n, l) => n + l.qty * l.price, 0));

function persist(next) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* quota or private mode: the cart still works in memory */ }
}

export function addItem(product, qty = 1) {
  const next = lines().map((l) => ({ ...l }));
  const hit = next.find((l) => l.slug === product.slug);
  if (hit) hit.qty += qty;
  else next.push({ slug: product.slug, title: product.title, price: product.price, qty });
  lines(next);
  persist(next);
  return next;
}

export function setQty(slug, qty) {
  const next = lines()
    .map((l) => (l.slug === slug ? { ...l, qty: Math.max(0, qty) } : l))
    .filter((l) => l.qty > 0);
  lines(next);
  persist(next);
  return next;
}

export function clear() {
  lines([]);
  persist([]);
}

/**
 * Apply several quantity changes as ONE settle.
 *
 * Each setQty is its own write. Without batch an observer runs once per write
 * and briefly sees a half-applied cart: the count already updated for the first
 * line while the second still holds its old quantity. batch collapses them, so
 * every reader sees exactly one consistent state. The suite measures the
 * observer's run count, which is the only way to tell the two apart from
 * outside: the final DOM is identical either way.
 */
export function applyBulk(updates) {
  batch(() => {
    for (const [slug, qty] of updates) setQty(slug, qty);
  });
  persist(lines());
  return lines();
}

export function formatPrice(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
