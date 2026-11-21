#!/usr/bin/env node
// Built-dist smoke gate — guards against the C1 dual-instance regression
// (AUDIT-2026-06-06.md) in both of What's tiers. Must be run with the
// `production` export condition so bare imports resolve to dist/*.min.js:
//
//   node --conditions=production scripts/check-prod-build.mjs
//
// It reproduces the exact compiler output path: the component is instantiated via
// the render entry (_$createComponent) while `useSignal` comes from the index
// entry. If those two entries don't share a single instance of dom.js's
// componentStack / reactive.js's tracking context, useSignal throws ("can only
// be called inside a component") or reactivity silently breaks — i.e. a blank
// page. This catches both failure modes headlessly, for:
//
//   production   what-framework + what-framework/render (dist/*.min.js)
//   development  what-core's readable dist (dist/index.js + dist/render.js)
//
// It also checks that each tier is what it claims to be: the development tier
// honours the `__WHAT_DEV__` global override, the production tier cannot be
// switched back into development mode by it.

import { JSDOM } from 'jsdom';
import assert from 'node:assert';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = dom.window;

// Set before any framework module loads: only the development tier may obey it.
globalThis.__WHAT_DEV__ = true;

const productionEntry = import.meta.resolve('what-framework');
assert.match(productionEntry, /\/dist\/index\.min\.js$/,
  `what-framework resolved to ${productionEntry}; run with --conditions=production`);

const tiers = [
  { name: 'production', index: 'what-framework', render: 'what-framework/render', dev: false },
  { name: 'development', index: '../packages/core/dist/index.js', render: '../packages/core/dist/render.js', dev: true },
];

const warn = console.warn;
for (const tier of tiers) {
  // Captured per tier: development code warns (template() called by hand,
  // below), and check 4 asserts on what was warned.
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  const { mount, useSignal, signal, computed, flushSync, h, Show, For } = await import(tier.index);
  const { _$createComponent, template, insert } = await import(tier.render);
  const label = `${tier.name} build`;

  let signalRef;

  // Mirrors what the compiler emits for: function App(){ const c=useSignal(0); return <h1>Count: {c()}</h1> }
  const tmpl = template('<h1></h1>');
  function App() {
    const count = useSignal(0); // <-- reads componentStack set by _$createComponent (render bundle)
    signalRef = count;
    const el = tmpl();
    insert(el, () => `Count: ${count()}`, null);
    return el;
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  mount(_$createComponent(App, {}), container);

  // 1) Did it render at all? (dual instance => useSignal throws before here, or 0 children)
  assert.ok(container.children.length > 0, `${label} rendered NOTHING (blank page) — dual core instance regression`);
  assert.match(container.textContent, /Count: 0/, `${label}: expected "Count: 0", got "${container.textContent}"`);

  // 2) Does reactivity work across the index<->render boundary? (proves single reactive instance)
  signalRef.set(7);
  flushSync();
  assert.match(container.textContent, /Count: 7/, `${label}: signal update did not reach the DOM — reactive context not shared (got "${container.textContent}")`);

  // 3) Nested runtime Show/For effects must dispose from the built bundle.
  // A filter UI commonly derives both the outer empty-state condition and the
  // inner list from the same signal. A stale minified bundle once retained each
  // recreated For effect, appending another copy on every filter change.
  const listContainer = document.createElement('ul');
  document.body.appendChild(listContainer);
  const items = signal([
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta' },
    { id: 'c', label: 'Gamma' },
  ]);
  mount(_$createComponent(
    Show,
    { when: () => items().length > 0, fallback: h('li', { class: 'empty' }, 'nothing') },
    [h(For, { each: () => items() }, [(item) => h('li', { key: item.id }, item.label)])],
  ), listContainer);
  assert.equal(listContainer.querySelectorAll('li').length, 3, `${label}: nested list rendered more than once initially`);
  items([{ id: 'b', label: 'Beta' }]);
  flushSync();
  assert.equal(listContainer.querySelectorAll('li').length, 1, `${label}: nested list retained stale rows after filtering`);
  assert.equal(listContainer.textContent, 'Beta');

  // 4) The tier: development code reports a write inside a computed.
  const source = signal(0);
  computed(() => { source(1); })();
  console.warn = warn;
  const warned = warnings.some((w) => w.includes('ERR_SIGNAL_WRITE_IN_COMPUTED'));
  assert.equal(warned, tier.dev, `${label}: expected ${tier.dev ? 'development' : 'production'} behaviour with globalThis.__WHAT_DEV__ = true`);

  console.log(`  ✓ ${label}: rendered, reactive, nested list disposal stayed single-owned, ${tier.dev ? 'dev checks on' : 'dev checks compiled out'}.`);
}
