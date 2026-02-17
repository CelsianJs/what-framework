// What Framework - Benchmark Suite
// Measures core operations in Node.js. No browser needed.

import { signal, computed, effect, batch, untrack } from '../packages/core/src/reactive.js';
import { h, Fragment } from '../packages/core/src/h.js';
import { renderToString } from '../packages/server/src/index.js';
import { writeFileSync } from 'node:fs';

const results = [];
const args = process.argv.slice(2);
const jsonIndex = args.indexOf('--json');
const jsonPath = jsonIndex >= 0 ? args[jsonIndex + 1] : null;

function bench(name, fn, iterations = 10000) {
  // Warmup
  for (let i = 0; i < Math.min(100, iterations / 10); i++) fn();

  // Force GC if available
  if (global.gc) global.gc();

  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const p10 = Math.floor(times.length * 0.1);
  const p90 = Math.floor(times.length * 0.9);
  const trimmed = times.slice(p10, p90);
  const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  const min = times[0];
  const max = times[times.length - 1];
  const p50 = times[Math.floor(times.length * 0.5)];
  const p99 = times[Math.floor(times.length * 0.99)];
  const opsPerSec = Math.round(1000 / avg);

  const result = { name, avg, min, max, p50, p99, opsPerSec, iterations };
  results.push(result);

  const bar = '█'.repeat(Math.min(50, Math.round(opsPerSec / 5000)));
  console.log(
    `  ${name.padEnd(40)} ${String(opsPerSec).padStart(10)} ops/s  ` +
    `avg=${avg.toFixed(4)}ms  p50=${p50.toFixed(4)}ms  p99=${p99.toFixed(4)}ms  ${bar}`
  );
}

console.log('\n  What Framework Benchmarks\n');
console.log('  ' + '='.repeat(90));

// --- Signal benchmarks ---
console.log('\n  Signals\n');

bench('signal() create', () => {
  signal(0);
});

bench('signal() read', () => {
  const s = signal(42);
  for (let i = 0; i < 100; i++) s();
}, 5000);

bench('signal() write (no subscribers)', () => {
  const s = signal(0);
  for (let i = 0; i < 100; i++) s.set(i);
}, 5000);

bench('signal() write (1 subscriber)', () => {
  const s = signal(0);
  effect(() => s());
  for (let i = 0; i < 100; i++) s.set(i);
}, 5000);

bench('signal() write (10 subscribers)', () => {
  const s = signal(0);
  for (let i = 0; i < 10; i++) effect(() => s());
  for (let i = 0; i < 100; i++) s.set(i);
}, 1000);

bench('signal.peek()', () => {
  const s = signal(42);
  for (let i = 0; i < 100; i++) s.peek();
}, 5000);

// --- Computed benchmarks ---
console.log('\n  Computed\n');

bench('computed() create + read', () => {
  const a = signal(1);
  const c = computed(() => a() * 2);
  c();
});

bench('computed() chain (depth 5)', () => {
  const s = signal(1);
  const c1 = computed(() => s() * 2);
  const c2 = computed(() => c1() + 1);
  const c3 = computed(() => c2() * 3);
  const c4 = computed(() => c3() - 1);
  const c5 = computed(() => c4() + c1());
  c5();
  s.set(2);
  c5();
});

bench('computed() diamond dependency', () => {
  const s = signal(1);
  const left = computed(() => s() * 2);
  const right = computed(() => s() * 3);
  const join = computed(() => left() + right());
  join();
  s.set(2);
  join();
});

// --- Effect benchmarks ---
console.log('\n  Effects\n');

bench('effect() create + dispose', () => {
  const s = signal(0);
  const dispose = effect(() => s());
  dispose();
});

bench('effect() with 10 signal deps', () => {
  const signals = Array.from({ length: 10 }, () => signal(0));
  const dispose = effect(() => {
    let sum = 0;
    for (const s of signals) sum += s();
  });
  dispose();
});

// --- Batch benchmarks ---
console.log('\n  Batch\n');

bench('batch() 100 writes, 1 effect', () => {
  const s = signal(0);
  effect(() => s());
  batch(() => {
    for (let i = 0; i < 100; i++) s.set(i);
  });
}, 2000);

bench('batch() 10 signals, 10 writes each', () => {
  const signals = Array.from({ length: 10 }, () => signal(0));
  effect(() => { for (const s of signals) s(); });
  batch(() => {
    for (const s of signals) {
      for (let i = 0; i < 10; i++) s.set(i);
    }
  });
}, 2000);

// --- VNode benchmarks ---
console.log('\n  VNode / h()\n');

bench('h() element', () => {
  h('div', { class: 'foo', id: 'bar' }, 'text');
});

bench('h() nested (3 levels)', () => {
  h('div', { class: 'outer' },
    h('div', { class: 'middle' },
      h('span', null, 'inner'),
    ),
  );
});

bench('h() list of 100 items', () => {
  h('ul', null,
    ...Array.from({ length: 100 }, (_, i) =>
      h('li', { key: i }, `Item ${i}`)
    ),
  );
}, 2000);

bench('h() component call', () => {
  function Comp({ name }) {
    return h('span', null, name);
  }
  h(Comp, { name: 'test' });
});

// --- SSR benchmarks ---
console.log('\n  SSR (renderToString)\n');

bench('renderToString() simple', () => {
  renderToString(h('div', { class: 'test' }, 'Hello'));
}, 5000);

bench('renderToString() nested', () => {
  renderToString(
    h('div', null,
      h('header', null, h('h1', null, 'Title')),
      h('main', null,
        h('p', null, 'Paragraph 1'),
        h('p', null, 'Paragraph 2'),
      ),
      h('footer', null, 'Footer'),
    )
  );
}, 2000);

bench('renderToString() list of 100', () => {
  renderToString(
    h('ul', null,
      ...Array.from({ length: 100 }, (_, i) =>
        h('li', { class: 'item', 'data-index': String(i) }, `Item ${i}`)
      ),
    )
  );
}, 500);

bench('renderToString() component tree', () => {
  function Item({ text }) {
    return h('li', null, text);
  }
  function List({ items }) {
    return h('ul', null, ...items.map(t => h(Item, { text: t })));
  }
  renderToString(
    h(List, { items: Array.from({ length: 50 }, (_, i) => `Item ${i}`) })
  );
}, 500);

// --- Summary ---
console.log('\n  ' + '='.repeat(90));
console.log('\n  Summary\n');

const total = results.reduce((sum, r) => sum + r.avg * r.iterations, 0);
console.log(`  Total benchmark time: ${(total / 1000).toFixed(2)}s`);
console.log(`  Tests: ${results.length}`);

const fastest = results.reduce((best, r) => r.opsPerSec > best.opsPerSec ? r : best);
const slowest = results.reduce((worst, r) => r.opsPerSec < worst.opsPerSec ? r : worst);

console.log(`  Fastest: ${fastest.name} (${fastest.opsPerSec.toLocaleString()} ops/s)`);
console.log(`  Slowest: ${slowest.name} (${slowest.opsPerSec.toLocaleString()} ops/s)`);
console.log('');

if (jsonPath) {
  writeFileSync(
    jsonPath,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      results,
    }, null, 2) + '\n'
  );
  console.log(`  Wrote JSON report: ${jsonPath}\n`);
}
