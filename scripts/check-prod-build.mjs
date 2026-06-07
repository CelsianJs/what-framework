#!/usr/bin/env node
// Production-build smoke gate — guards against the C1 dual-instance regression
// (AUDIT-2026-06-06.md). Must be run with the `production` export condition so
// imports resolve to dist/*.min.js:
//
//   node --conditions=production scripts/check-prod-build.mjs
//
// It reproduces the exact compiler output path: the component is instantiated via
// `what-framework/render` (_$createComponent) while `useSignal` comes from
// `what-framework` (index). If those two entries don't share a single instance of
// dom.js's componentStack / reactive.js's tracking context, useSignal throws
// ("can only be called inside a component") or reactivity silently breaks — i.e. a
// blank production page. This catches both failure modes headlessly.

import { JSDOM } from 'jsdom';
import assert from 'node:assert';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.window = dom.window;

// IMPORTANT: these two imports must resolve to the production (minified) builds.
const { mount, useSignal, flushSync } = await import('what-framework');
const { _$createComponent, template, insert } = await import('what-framework/render');

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

const container = document.getElementById('app');
mount(_$createComponent(App, {}), container);

// 1) Did it render at all? (dual instance => useSignal throws before here, or 0 children)
assert.ok(container.children.length > 0, 'production build rendered NOTHING (blank page) — dual core instance regression');
assert.match(container.textContent, /Count: 0/, `expected "Count: 0", got "${container.textContent}"`);

// 2) Does reactivity work across the index<->render boundary? (proves single reactive instance)
signalRef.set(7);
if (typeof flushSync === 'function') flushSync();
assert.match(container.textContent, /Count: 7/, `signal update did not reach the DOM — reactive context not shared (got "${container.textContent}")`);

console.log('  ✓ prod build smoke: rendered + reactive ("Count: 0" -> "Count: 7"). Single core instance confirmed.');
