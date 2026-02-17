// What Framework - DX Microbenchmarks
// Focused benchmarks for DX-facing runtime paths:
// - event prop casing normalization
// - innerHTML / dangerouslySetInnerHTML paths
// - form error getter access path

import { JSDOM } from 'jsdom';
import { writeFileSync } from 'node:fs';
import { h } from '../packages/core/src/h.js';
import { mount } from '../packages/core/src/dom.js';
import { signal, flushSync } from '../packages/core/src/reactive.js';
import { useForm } from '../packages/core/src/form.js';

const args = process.argv.slice(2);
const jsonIndex = args.indexOf('--json');
const jsonPath = jsonIndex >= 0 ? args[jsonIndex + 1] : null;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

if (!global.customElements) {
  const registry = new Map();
  global.customElements = {
    get: (name) => registry.get(name),
    define: (name, cls) => registry.set(name, cls),
  };
}

const results = [];

function bench(name, fn, iterations = 500) {
  for (let i = 0; i < Math.min(50, Math.floor(iterations / 10)); i++) fn();

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
  const avg = trimmed.reduce((sum, t) => sum + t, 0) / trimmed.length;
  const opsPerSec = Math.round(1000 / avg);

  const entry = {
    name,
    avg,
    p50: times[Math.floor(times.length * 0.5)],
    p99: times[Math.floor(times.length * 0.99)],
    opsPerSec,
    iterations,
  };

  results.push(entry);
  console.log(`  ${name.padEnd(42)} ${String(opsPerSec).padStart(10)} ops/s  avg=${avg.toFixed(4)}ms`);
}

function getContainer() {
  const app = document.getElementById('app');
  app.textContent = '';
  return app;
}

console.log('\n  What DX Microbenchmarks\n');

bench('event prop normalize (onClick)', () => {
  const container = getContainer();
  const items = Array.from({ length: 200 }, (_, i) => i);

  const stop = mount(
    h('div', null,
      ...items.map((i) => h('button', { onClick: () => i }, String(i))),
    ),
    container,
  );

  stop();
}, 150);

bench('event prop normalize (onclick)', () => {
  const container = getContainer();
  const items = Array.from({ length: 200 }, (_, i) => i);

  const stop = mount(
    h('div', null,
      ...items.map((i) => h('button', { onclick: () => i }, String(i))),
    ),
    container,
  );

  stop();
}, 150);

bench('innerHTML patch path', () => {
  const html = signal('<span>A</span>');
  const container = getContainer();

  function App() {
    return h('div', { id: 'x', innerHTML: html() });
  }

  const stop = mount(h(App), container);
  html('<span>B</span>');
  flushSync();
  stop();
}, 250);

bench('dangerouslySetInnerHTML patch path', () => {
  const html = signal('<span>A</span>');
  const container = getContainer();

  function App() {
    return h('div', { id: 'x', dangerouslySetInnerHTML: { __html: html() } });
  }

  const stop = mount(h(App), container);
  html('<span>B</span>');
  flushSync();
  stop();
}, 250);

bench('formState.errors getter read', () => {
  const form = useForm();
  form.setError('email', { type: 'required', message: 'Required' });
  const msg = form.formState.errors.email?.message;
  if (!msg) throw new Error('missing error');
}, 1500);

console.log('');

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    results,
  }, null, 2) + '\n');
  console.log(`  Wrote JSON report: ${jsonPath}\n`);
}
