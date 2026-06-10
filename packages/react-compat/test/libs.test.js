// Real React libraries running on what-react's compat runtime (jsdom).
//
// Libraries are imported from test/app/node_modules (the browser fixture's
// install). Bare 'react' / 'react-dom' imports inside the libraries are
// aliased to what-react via a module-customization hook. If the fixture's
// node_modules is missing, these tests SKIP — run `npm install` in
// packages/react-compat/test/app first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

register('./_helpers/react-alias-loader.mjs', import.meta.url);

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
for (const k of [
  'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node', 'SVGElement',
  'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'InputEvent',
  'getComputedStyle', 'DocumentFragment', 'Text', 'Comment', 'MutationObserver', 'history', 'location',
  'NodeFilter', 'TreeWalker', 'Range', 'DOMRect', 'PointerEvent',
]) {
  try { if (!(k in global) || global[k] === undefined) global[k] = dom.window[k]; } catch (e) { /* read-only */ }
}
try { global.navigator = dom.window.navigator; } catch (e) { /* Node ≥21 read-only */ }
global.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
window.requestAnimationFrame = global.requestAnimationFrame;
window.cancelAnimationFrame = global.cancelAnimationFrame;
// jsdom lacks these — minimal stubs used by headlessui/floating-ui/hot-toast
class ResizeObserverStub {
  observe() {} unobserve() {} disconnect() {}
}
global.ResizeObserver = ResizeObserverStub;
window.ResizeObserver = ResizeObserverStub;
class IntersectionObserverStub {
  observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
}
global.IntersectionObserver = IntersectionObserverStub;
window.IntersectionObserver = IntersectionObserverStub;
const matchMediaStub = () => ({
  matches: false, media: '', addListener() {}, removeListener() {},
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});
global.matchMedia = matchMediaStub;
window.matchMedia = matchMediaStub;
if (!window.Element.prototype.scrollIntoView) {
  window.Element.prototype.scrollIntoView = () => {};
}

const APP_MODULES = new URL('./app/node_modules/', import.meta.url);
const hasLibs = existsSync(fileURLToPath(new URL('zustand', APP_MODULES)));
const lib = (p) => import(new URL(p, APP_MODULES).href);
const skip = hasLibs ? false : 'test/app/node_modules not installed (run npm install in packages/react-compat/test/app)';

const React = await import('../src/index.js');
const ReactDOM = await import('../src/dom.js');
const { createElement: h, useState, act } = React;
const { createRoot } = ReactDOM;

function mount(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return { container, root };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function settle(times = 4) {
  for (let i = 0; i < times; i++) {
    await tick();
    act(() => {});
  }
}

// ---------------------------------------------------------------
// zustand
// ---------------------------------------------------------------

test('zustand: selector returns VALUE, derived render, action updates UI', { skip }, async () => {
  const { create } = await lib('zustand/esm/index.mjs');
  const useStore = create((set) => ({
    count: 1,
    inc: () => set((s) => ({ count: s.count + 1 })),
  }));

  function Counter() {
    const count = useStore((s) => s.count);
    const inc = useStore((s) => s.inc);
    return h('div', null,
      h('span', { id: 'raw' }, count),
      h('span', { id: 'doubled' }, count * 2),
      h('button', { onClick: inc }, '+'),
    );
  }

  const { container } = mount(h(Counter));
  assert.equal(container.querySelector('#raw').textContent, '1', 'selector returns value');
  assert.equal(container.querySelector('#doubled').textContent, '2', 'count*2 renders (not NaN)');

  act(() => container.querySelector('button').click());
  await settle();
  assert.equal(container.querySelector('#raw').textContent, '2', 'store action re-renders UI');
  assert.equal(container.querySelector('#doubled').textContent, '4');

  act(() => useStore.getState().inc());
  await settle();
  assert.equal(container.querySelector('#raw').textContent, '3', 'external store update re-renders');
});

// ---------------------------------------------------------------
// @tanstack/react-query
// ---------------------------------------------------------------

test('react-query: QueryClientProvider + useQuery renders fetched data', { skip }, async () => {
  const { QueryClient, QueryClientProvider, useQuery } = await lib('@tanstack/react-query/build/modern/index.js');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  function User() {
    const { data, isPending, isError } = useQuery({
      queryKey: ['user'],
      queryFn: async () => {
        await tick(10);
        return { name: 'Ada Lovelace' };
      },
    });
    if (isPending) return h('div', { id: 'loading' }, 'loading…');
    if (isError) return h('div', { id: 'error' }, 'error');
    return h('div', { id: 'data' }, data.name);
  }

  const { container, root } = mount(h(QueryClientProvider, { client }, h(User)));
  assert.ok(container.querySelector('#loading'), 'pending state renders');
  await tick(30);
  await settle(6);
  assert.ok(container.querySelector('#data'), 'data state renders');
  assert.equal(container.querySelector('#data').textContent, 'Ada Lovelace');
  act(() => root.unmount());
  client.clear();
});

test('react-query: useMutation flows', { skip }, async () => {
  const { QueryClient, QueryClientProvider, useMutation } = await lib('@tanstack/react-query/build/modern/index.js');
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 }, queries: { gcTime: 0 } } });

  function Save() {
    const m = useMutation({ mutationFn: async (v) => { await tick(5); return v * 2; } });
    return h('div', null,
      h('button', { onClick: () => m.mutate(21) }, 'save'),
      h('output', null, m.isSuccess ? m.data : 'idle'),
    );
  }
  const { container, root } = mount(h(QueryClientProvider, { client }, h(Save)));
  assert.equal(container.querySelector('output').textContent, 'idle');
  act(() => container.querySelector('button').click());
  await tick(20);
  await settle(6);
  assert.equal(container.querySelector('output').textContent, '42');
  act(() => root.unmount());
  client.clear();
});

// ---------------------------------------------------------------
// react-hook-form
// ---------------------------------------------------------------

test('react-hook-form: register + submit + validation error display', { skip }, async () => {
  const { useForm } = await lib('react-hook-form/dist/index.esm.mjs');
  let submitted = null;

  function Form() {
    const { register, handleSubmit, formState: { errors } } = useForm();
    return h('form', { onSubmit: handleSubmit((data) => { submitted = data; }) },
      h('input', { id: 'email', ...register('email', { required: 'Email is required' }) }),
      errors.email && h('p', { id: 'email-error', role: 'alert' }, errors.email.message),
      h('button', { type: 'submit' }, 'Send'),
    );
  }

  const { container } = mount(h(Form));
  const form = container.querySelector('form');
  const input = container.querySelector('#email');

  // Submit empty → validation error appears
  act(() => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  await settle(6);
  assert.ok(container.querySelector('#email-error'), 'validation error rendered');
  assert.equal(container.querySelector('#email-error').textContent, 'Email is required');
  assert.equal(submitted, null);

  // Type a value → submit succeeds, error clears
  input.value = 'ada@lovelace.dev';
  act(() => input.dispatchEvent(new window.Event('input', { bubbles: true })));
  await settle(2);
  act(() => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  await settle(6);
  assert.deepEqual(submitted, { email: 'ada@lovelace.dev' });
  assert.equal(container.querySelector('#email-error'), null, 'error cleared after valid submit');
});

// ---------------------------------------------------------------
// react-hot-toast
// ---------------------------------------------------------------

test('react-hot-toast: Toaster mounts and toast() displays', { skip }, async () => {
  const mod = await lib('react-hot-toast/dist/index.mjs');
  const toast = mod.default || mod.toast;
  const { Toaster } = mod;

  const { container, root } = mount(h('div', null, h(Toaster)));
  await settle(2);

  act(() => { toast.success('Saved successfully'); });
  await settle(6);
  assert.ok(container.textContent.includes('Saved successfully'), 'toast message rendered');

  // remove (not dismiss) → no pending exit-animation timers keep the process alive
  act(() => { toast.remove(); });
  await settle(4);
  act(() => root.unmount());
});

// ---------------------------------------------------------------
// @headlessui/react
// ---------------------------------------------------------------

test('@headlessui/react: Menu opens and closes', { skip }, async () => {
  const { Menu, MenuButton, MenuItems, MenuItem } = await lib('@headlessui/react/dist/headlessui.esm.js');
  let picked = null;

  const { container } = mount(
    h(Menu, null,
      h(MenuButton, null, 'Options'),
      h(MenuItems, { static: false },
        h(MenuItem, null, h('button', { onClick: () => { picked = 'a'; } }, 'Item A')),
        h(MenuItem, null, h('button', { onClick: () => { picked = 'b'; } }, 'Item B')),
      ),
    ),
  );
  await settle(4);

  const button = container.querySelector('button[aria-haspopup="menu"]');
  assert.ok(button, 'MenuButton rendered');
  assert.equal(document.querySelector('[role="menu"]'), null, 'menu closed initially');

  act(() => button.click());
  await settle(6);
  assert.equal(button.getAttribute('aria-expanded'), 'true', 'button marked expanded');
  const items = [...document.querySelectorAll('[role="menuitem"]')];
  assert.equal(items.length, 2, 'menu items visible after click');
  assert.deepEqual(items.map((i) => i.textContent), ['Item A', 'Item B']);

  act(() => items[0].click());
  await settle(6);
  assert.equal(picked, 'a', 'item click handler ran');
  assert.equal(document.querySelector('[role="menu"]'), null, 'menu closed after selecting an item');
});

test('@headlessui/react: Switch toggles', { skip }, async () => {
  const { Switch } = await lib('@headlessui/react/dist/headlessui.esm.js');
  function App() {
    const [on, setOn] = useState(false);
    return h('div', null,
      h(Switch, { checked: on, onChange: setOn, id: 'sw' }, 'toggle'),
      h('output', null, on ? 'on' : 'off'),
    );
  }
  const { container } = mount(h(App));
  await settle(2);
  assert.equal(container.querySelector('output').textContent, 'off');
  act(() => container.querySelector('#sw').click());
  await settle(4);
  assert.equal(container.querySelector('output').textContent, 'on');
});
