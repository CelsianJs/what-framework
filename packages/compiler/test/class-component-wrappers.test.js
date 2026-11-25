// A class component handed to each wrapper in what-core that runs a component
// it is given: lazy(), memo(), a context provider, <Portal>, <Suspense>, and an
// <ErrorBoundary> whose fallback is a class, on the compiled path and through
// h(). memo(Class) was fixed in 0.15 (it called the class as a function); an
// <ErrorBoundary> called a function fallback with `{ error, reset }`, which a
// class cannot be: it threw "Class constructor cannot be invoked without
// 'new'" from the boundary's effect and showed nothing. Every one of them runs
// a class through the bridge the renderers use (render.js
// _toFunctionComponent). what-core has no forwardRef (what-react's takes a
// render function, and React 19.3.0's forwardRef(Class) throws the same
// TypeError).

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { cleanup } = installDOM();
after(cleanup);

const { mount, flushSync } = await import('what-framework');

const mod = await loadCompiled(`
  import { lazy, memo, Suspense, ErrorBoundary, createContext, useContext, Portal, h } from 'what-framework';
  export class Legacy { constructor(props) { this.props = props; } render() { return <b class="legacy">{this.props.label}</b>; } }
  export class Fallback { constructor(props) { this.props = props; } render() { return <i class="fallback">{this.props.error.message}</i>; } }
  const Ctx = createContext('none');
  export class Reader { render() { return <b class="reader">{useContext(Ctx)}</b>; } }
  const Lazy = lazy(() => Promise.resolve({ default: Legacy }));
  const Memo = memo(Legacy);
  function Boom() { throw new Error('boom'); }
  export const target = document.createElement('div');
  export const compiled = {
    lazy: () => <Suspense fallback={<p>wait</p>}><Lazy label="lazy" /></Suspense>,
    memo: () => <Memo label="memo" />,
    provider: () => <Ctx.Provider value="provided"><Reader /></Ctx.Provider>,
    portal: () => <div><Portal target={target}><Legacy label="portal" /></Portal></div>,
    boundary: () => <ErrorBoundary fallback={Fallback}><Boom /></ErrorBoundary>,
  };
  export const viaH = {
    lazy: () => h(Suspense, { fallback: 'wait' }, h(Lazy, { label: 'lazy' })),
    memo: () => h(memo(Legacy), { label: 'memo' }),
    provider: () => h(Ctx.Provider, { value: 'provided' }, h(Reader)),
    portal: () => h('div', {}, h(Portal, { target }, h(Legacy, { label: 'portal' }))),
    boundary: () => h(ErrorBoundary, { fallback: Fallback }, h(Boom)),
  };
`);

const shown = (el) => el.innerHTML.replace(/<!--[^>]*-->/g, '');

async function render(view) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mod.target.innerHTML = '';
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(String(args[0]));
  try {
    mount(view, host);
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
  } finally {
    console.error = original;
  }
  return { host: shown(host), portal: shown(mod.target), errors };
}

for (const [path, views] of [['compiled JSX', mod.compiled], ['h()', mod.viaH]]) {
  describe(`a class component in what-core's wrappers (${path})`, () => {
    it('lazy() resolving to a class', async () => {
      assert.deepEqual(await render(views.lazy), { host: '<b class="legacy">lazy</b>', portal: '', errors: [] });
    });
    it('memo() of a class', async () => {
      assert.deepEqual(await render(views.memo), { host: '<b class="legacy">memo</b>', portal: '', errors: [] });
    });
    it('a class under a context provider reads its value', async () => {
      assert.deepEqual(await render(views.provider), { host: '<b class="reader">provided</b>', portal: '', errors: [] });
    });
    it('a class in a <Portal>', async () => {
      const out = await render(views.portal);
      assert.equal(out.portal, '<b class="legacy">portal</b>');
      assert.deepEqual(out.errors, []);
    });
    it('an <ErrorBoundary> whose fallback is a class renders it with the error', async () => {
      assert.deepEqual(await render(views.boundary), { host: '<i class="fallback">boom</i>', portal: '', errors: [] });
    });
  });
}
