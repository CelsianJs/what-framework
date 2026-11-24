// what-react/mixed: native What components and React components in one tree
// (jsdom). Native components here are written with h(); the browser test
// (mixed-browser.mjs) covers compiled JSX through the Vite plugin.
// Run: node --test packages/react-compat/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { dom } = installDOM('<!DOCTYPE html><html><body></body></html>');
for (const k of ['HTMLElement', 'Element', 'Node', 'SVGElement', 'CustomEvent', 'Event', 'MouseEvent', 'DocumentFragment', 'Text', 'Comment']) {
  try { if (!(k in global)) global[k] = dom.window[k]; } catch { /* read-only global */ }
}

const { h, mount, signal, Show, createContext: nativeContext, useContext: useNativeContext, flushSync, getDiagnostics, clearDiagnostics } = await import('what-core');
const React = await import('../src/index.js');
const { createRoot } = await import('../src/dom.js');
const { ReactIsland, native } = await import('../src/mixed.js');
const { createElement: rce, useState, useEffect, useContext, createContext, act } = React;

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { flushSync(); await tick(); await tick(); };
function container() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

// A React component with state of its own.
function Clicker({ label }) {
  const [c, setC] = useState(0);
  return rce('button', { onClick: () => setC(c + 1) }, `${label}:${c}`);
}

test('an island re-renders when a native signal its props read changes, and keeps React state', async () => {
  const n = signal(1);
  const el = container();
  mount(h(ReactIsland, { view: () => rce(Clicker, { label: `n${n()}` }) }), el);
  const button = el.querySelector('button');
  assert.equal(button.textContent, 'n1:0');
  click(button); await settle();
  click(button); await settle();
  assert.equal(el.querySelector('button').textContent, 'n1:2');
  n(5);
  await settle();
  assert.equal(el.querySelector('button').textContent, 'n5:2');
  assert.equal(el.querySelector('button'), button, 'the same DOM: reconciled, not rebuilt');
});

test("an island unmounts with its native owner and runs React's cleanups", async () => {
  const show = signal(true);
  let cleaned = 0;
  function WithEffect() {
    useEffect(() => () => { cleaned++; }, []);
    return rce('i', null, 'here');
  }
  const el = container();
  mount(h('div', null, h(Show, { when: show }, () => h(ReactIsland, { view: () => rce(WithEffect) }))), el);
  await settle();
  assert.equal(el.querySelector('i')?.textContent, 'here');
  show(false);
  await settle();
  assert.equal(el.querySelector('i'), null);
  assert.equal(cleaned, 1);
});

test('a signal read while a React component renders re-renders it (render props, React files)', async () => {
  const n = signal(1);
  let renders = 0;
  function List({ render }) { renders++; return rce('ul', null, render()); }
  const el = container();
  const root = createRoot(el);
  act(() => root.render(rce(List, { render: () => rce('li', null, `item ${n()}`) })));
  assert.equal(el.textContent, 'item 1');
  n(2);
  await settle();
  assert.equal(el.textContent, 'item 2');
  assert.equal(renders, 2);
});

// A native component: runs once, keeps a signal, reads its props live.
function NativeCounter(props) {
  const k = signal(0);
  return h('span', { class: 'nc', onclick: () => k(k() + 1) }, () => `${props.label}:${k()}`);
}

test('a native component inside React keeps its state, sees new props and calls the latest callback', async () => {
  const seen = [];
  function Parent() {
    const [c, setC] = useState(0);
    return rce('div', null,
      rce('button', { id: 'p', onClick: () => setC(c + 1) }, 'parent'),
      rce(native(NativeCounter), { label: `c${c}`, onPick: () => seen.push(c) }));
  }
  let pick = null;
  const Picker = (props) => { pick = () => props.onPick(); return h('b', null, 'picker'); };
  function Parent2() {
    const [c, setC] = useState(0);
    return rce('div', null, rce('button', { id: 'p2', onClick: () => setC(c + 1) }, 'p2'), rce(native(Picker), { onPick: () => seen.push(c) }));
  }
  const el = container();
  const root = createRoot(el);
  act(() => root.render(rce('section', null, rce(Parent), rce(Parent2))));
  const span = el.querySelector('.nc');
  assert.equal(span.textContent, 'c0:0');
  click(span); click(span); click(span);
  await settle();
  assert.equal(el.querySelector('.nc').textContent, 'c0:3');
  click(el.querySelector('#p'));
  await settle();
  assert.equal(el.querySelector('.nc'), span, 'the native component was not rebuilt');
  assert.equal(span.textContent, 'c1:3', 'new prop value, native state kept');

  click(el.querySelector('#p2')); await settle();
  click(el.querySelector('#p2')); await settle();
  pick();
  assert.deepEqual(seen, [2], 'the native component calls the callback of the latest render');
});

test('React children a native component places keep their state when the React parent re-renders', async () => {
  const Frame = (props) => h('div', { class: 'frame' }, () => props.children);
  function Parent() {
    const [c, setC] = useState(0);
    return rce('div', null,
      rce('button', { id: 'bump', onClick: () => setC(c + 1) }, 'bump'),
      rce(native(Frame), null, rce(Clicker, { label: `p${c}` })));
  }
  const el = container();
  const root = createRoot(el);
  act(() => root.render(rce(Parent)));
  const inner = () => el.querySelector('.frame button');
  click(inner()); await settle();
  click(inner()); await settle();
  assert.equal(inner().textContent, 'p0:2');
  const button = inner();
  click(el.querySelector('#bump'));
  await settle();
  assert.equal(inner().textContent, 'p1:2', 'React state kept, new prop');
  assert.equal(inner(), button);
});

test('React context reaches through a native component, to React children and to an island inside it', async () => {
  const Theme = createContext('none');
  const Label = ({ id }) => rce('em', { id }, useContext(Theme));
  const Shell = (props) => h('div', null, () => props.children, h(ReactIsland, { view: () => rce(Label, { id: 'island' }) }));
  function App() {
    const [theme, setTheme] = useState('light');
    return rce(Theme.Provider, { value: theme },
      rce('button', { id: 'dark', onClick: () => setTheme('dark') }, 'dark'),
      rce(native(Shell), null, rce(Label, { id: 'child' })));
  }
  const el = container();
  const root = createRoot(el);
  act(() => root.render(rce(App)));
  assert.equal(el.querySelector('#child').textContent, 'light');
  assert.equal(el.querySelector('#island').textContent, 'light');
  click(el.querySelector('#dark'));
  await settle();
  assert.equal(el.querySelector('#child').textContent, 'dark');
  assert.equal(el.querySelector('#island').textContent, 'dark');
});

test('native context reaches a native component inside a React island', async () => {
  const Locale = nativeContext('xx');
  const Reader = () => h('code', null, useNativeContext(Locale));
  const el = container();
  mount(h(Locale.Provider, { value: 'fr' }, () => h(ReactIsland, { view: () => rce('p', null, rce(native(Reader))) })), el);
  await settle();
  assert.equal(el.querySelector('code')?.textContent, 'fr');
});

test('a React hook called in a native component fails with the hook error, never using a React instance', async () => {
  const Bad = () => { useState(0); return h('i', null, 'bad'); };
  const el = container();
  const root = createRoot(el);
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  try {
    try { act(() => root.render(rce('div', null, rce(native(Bad))))); } catch (e) { errors.push(String(e)); }
  } finally {
    console.error = orig;
  }
  assert.ok(errors.some((e) => e.includes('useState() called outside of a component render')), errors.join('\n'));
});

test('tabIndex on an SVG element is its tabindex attribute, as React writes it', () => {
  const el = container();
  const root = createRoot(el);
  act(() => root.render(rce('svg', { tabIndex: 0, role: 'application' }, rce('rect', { width: 1, height: 1 }))));
  const svg = el.querySelector('svg');
  assert.equal(svg.getAttribute('tabindex'), '0');
  assert.equal(svg.hasAttribute('tabIndex') && svg.getAttributeNames().includes('tabIndex'), false);
});

test('a region that rebuilds a React island reports ERR_REBUILT_COMPONENT: its React state is gone', async () => {
  clearDiagnostics();
  const n = signal(1);
  const el = container();
  // The region reads n itself (a block function child), so it runs again.
  mount(h('div', null, () => { const v = n(); return h(ReactIsland, { view: () => rce(Clicker, { label: 'n' + v }) }); }), el);
  n(2);
  await settle();
  const reports = getDiagnostics().events.filter((e) => e.code === 'ERR_REBUILT_COMPONENT');
  assert.equal(reports.length, 1, JSON.stringify(getDiagnostics().events.map((e) => e.code)));
  assert.match(reports[0].message, /rebuilt <ReactIsland>/);
});
