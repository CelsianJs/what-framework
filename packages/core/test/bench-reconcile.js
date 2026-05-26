// Benchmark: keyed reconciler swap and single-move performance
// Run: node packages/core/test/bench-reconcile.js

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.SVGElement = dom.window.SVGElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));
if (!global.customElements) {
  const registry = new Map();
  global.customElements = {
    get: (name) => registry.get(name),
    define: (name, cls) => registry.set(name, cls),
  };
}

const { signal, flushSync } = await import('../src/reactive.js');
const { mapArray } = await import('../src/render.js');

const ITEM_COUNT = 420;
const ITERATIONS = 100;

function createItems(count) {
  return Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, label: `Label ${i}` }));
}

function Row(item) {
  // 3 DOM nodes per item
  const frag = document.createDocumentFragment();
  const a = document.createElement('div');
  a.textContent = item.label;
  a.dataset.id = item.id;
  const b = document.createElement('span');
  b.textContent = item.id;
  const c = document.createElement('em');
  c.textContent = '!';
  frag.appendChild(a);
  frag.appendChild(b);
  frag.appendChild(c);
  return frag;
}

function setupList() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const initial = createItems(ITEM_COUNT);
  const items = signal(initial);
  const inserter = mapArray(items, Row, { key: (i) => i.id, raw: true });
  inserter(container, null);
  flushSync();
  return { container, items, initial };
}

function swapItems(arr, i, j) {
  const copy = arr.slice();
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

function moveItem(arr, from, to) {
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function benchmark(name, setupFn, mutateFn) {
  const times = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const { items, initial } = setupFn();
    // Alternate between mutated and original to measure both directions
    const target = i % 2 === 0 ? mutateFn(initial) : initial;
    if (i % 2 === 1) {
      // Reset to mutated first
      items(mutateFn(initial));
      flushSync();
    }

    const start = performance.now();
    items(target);
    flushSync();
    const elapsed = performance.now() - start;
    times.push(elapsed);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const min = times[0];
  const max = times[times.length - 1];
  console.log(`${name}: median=${median.toFixed(3)}ms  p95=${p95.toFixed(3)}ms  min=${min.toFixed(3)}ms  max=${max.toFixed(3)}ms`);
  return median;
}

console.log(`\nKeyed reconciler benchmark: ${ITEM_COUNT} items, ${ITERATIONS} iterations each\n`);

const swapMedian = benchmark(
  'Swap (item 0 <-> item 419)',
  setupList,
  (arr) => swapItems(arr, 0, 419)
);

const moveMedian = benchmark(
  'Move (item 0 -> pos 210) ',
  setupList,
  (arr) => moveItem(arr, 0, 210)
);

const reverseMedian = benchmark(
  'Full reverse (general)   ',
  setupList,
  (arr) => arr.slice().reverse()
);

console.log(`\n--- Summary ---`);
console.log(`Swap:    ${swapMedian.toFixed(3)}ms ${swapMedian < 2 ? '  PASS' : '  FAIL (> 2ms)'}`);
console.log(`Move:    ${moveMedian.toFixed(3)}ms ${moveMedian < 2 ? '  PASS' : '  FAIL (> 2ms)'}`);
console.log(`Reverse: ${reverseMedian.toFixed(3)}ms (general case baseline)`);
