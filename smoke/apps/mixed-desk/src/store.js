// The desk's store: plain What signals, shared by every route. Native pages
// read them as usual; React components get them as props (an island's props
// are built again when a signal they read changes) or read them while they
// render (what-react re-renders a component whose render read a signal).

import { signal } from 'what-framework';

export const SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOG', 'META', 'TSLA', 'AMD'];
// The feed writes the first six; the last two stay quiet, so a quote that
// renders without a change of its own shows up in the counts.
export const LIVE = SYMBOLS.slice(0, 6);

// Each write sets a symbol's price to the feed's sequence number, so the
// last value a symbol was given is known exactly.
export const prices = Object.fromEntries(SYMBOLS.map((s) => [s, signal(0)]));
export const writes = Object.fromEntries(SYMBOLS.map((s) => [s, 0]));
export const lastWrite = Object.fromEntries(SYMBOLS.map((s) => [s, 0]));
export const focus = signal('AAPL');
export const history = signal([]);

// --- The feed: `rate` writes a second on a 10 ms timer that catches up -----

const feed = { emitted: 0, running: false, timer: null, listeners: new Set() };
window.__feed = feed;

function emit() {
  const n = ++feed.emitted;
  const sym = LIVE[n % LIVE.length];
  writes[sym]++;
  lastWrite[sym] = n;
  prices[sym](n);
  if (sym === focus()) history((h) => [...h.slice(-59), { n, price: n % 97 }]);
  for (const fn of feed.listeners) fn(sym, n);
}

export function startFeed(rate) {
  stopFeed();
  feed.running = true;
  const t0 = performance.now();
  const base = feed.emitted;
  feed.timer = setInterval(() => {
    const due = Math.floor(((performance.now() - t0) * rate) / 1000);
    while (feed.emitted - base < due) emit();
  }, 10);
}

export function stopFeed() {
  if (feed.timer) clearInterval(feed.timer);
  feed.timer = null;
  feed.running = false;
}

export function emitOnce() { emit(); }

/** A subscription to every trade; returns the unsubscribe. */
export function onTrade(fn) {
  feed.listeners.add(fn);
  return () => feed.listeners.delete(fn);
}

// --- Values React lifts into the store ---------------------------------------

export const lifted = signal(0);
export const liftLog = [];
window.__liftLog = liftLog;
export function lift(value) {
  liftLog.push(value);
  lifted(value);
}

// --- 10,000 deals: one signal holding the array, replaced on each change ---

const DESKS = ['Rates', 'Credit', 'FX', 'Equities'];
function makeDeal(i) {
  return { id: i, name: `Deal ${String(i).padStart(5, '0')}`, desk: DESKS[i % 4], notional: ((i * 7919) % 100000) / 10, rev: 0 };
}
export const deals = signal(Array.from({ length: 10_000 }, (_, i) => makeDeal(i)));

/** Bump one deal's notional and revision: a new array, the other rows the same objects. */
export function touchDeal(i, notional) {
  deals((list) => {
    const next = list.slice();
    next[i] = { ...list[i], notional, rev: list[i].rev + 1 };
    return next;
  });
}

/** Every deal changes at once. */
export function touchAll(delta) {
  deals((list) => list.map((d) => ({ ...d, notional: Math.round((d.notional + delta) * 10) / 10, rev: d.rev + 1 })));
}

export function addDeal(deal) {
  deals((list) => [{ ...makeDeal(list.length), ...deal, id: list.length }, ...list]);
}

// --- Files a React dropzone hands to the store ------------------------------

export const uploads = signal([]);
