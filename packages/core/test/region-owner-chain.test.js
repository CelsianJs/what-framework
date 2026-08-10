// A reactive region must keep its owning component for every re-run, not just
// the first.
//
// The effect behind `{() => ...}` re-runs long after the synchronous render
// that created it, when the component stack has unwound. Anything it builds on
// a re-run therefore got `parentCtx = null`, severing the chain that two
// separate lookups walk:
//
//   - useContext walks parent contexts, so it fell through to the context
//     DEFAULT for anything rendered after a state change.
//   - the ErrorBoundary / Suspense lookup walks the same chain, so a throw from
//     a component created by an inner region escaped the boundary wrapping it.
//
// Both are invisible on first paint and only appear once the app is
// interactive, which is the hardest timing there is to notice: the page looks
// right, and then a click makes context silently wrong.
//
// dom.js was given this fix. render.js's insert(), which is the path the
// COMPILER emits for every reactive expression, was not, so it was broken for
// exactly the users on the recommended build setup. This file pins both paths.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.SVGElement = dom.window.SVGElement;

const { signal, flushSync } = await import('../src/reactive.js');
const { h } = await import('../src/h.js');
const { insert } = await import('../src/render.js');
const { mount } = await import('../src/dom.js');
const { ErrorBoundary } = await import('../src/components.js');
const { createContext, useContext } = await import('../src/hooks.js');

const root = () => document.getElementById('root');

function reset() {
  document.body.innerHTML = '<div id="root"></div>';
}

const Theme = createContext('DEFAULT');
const Leaf = () => h('span', { 'data-value': '' }, useContext(Theme));

/**
 * Two ways to put a reactive region inside an element, which take two different
 * code paths that have to agree:
 *   - 'runtime'  : h('div', {}, () => ...)   -> createDOM  (dom.js)
 *   - 'compiled' : insert(el, () => ...)     -> insert      (render.js)
 * The compiler emits the second for every `{() => ...}` in JSX.
 */
const HOSTS = {
  runtime: (child) => () => h('div', {}, child),
  compiled: (child) => () => {
    const el = document.createElement('div');
    insert(el, child);
    return el;
  },
};

describe('context still resolves for components created after a state change', () => {
  for (const [name, host] of Object.entries(HOSTS)) {
    it(`on the ${name} path`, () => {
      reset();
      const show = signal(false);
      const Page = host(() => (show() ? h(Leaf, {}) : h('em', {}, 'off')));

      mount(h(Theme.Provider, { value: 'PROVIDED' }, h(Page, {})), '#root');
      flushSync();
      assert.equal(root().textContent, 'off');

      show(true);
      flushSync();
      assert.equal(
        root().querySelector('[data-value]').textContent,
        'PROVIDED',
        'a component built by a region re-run must still see its provider, not the default',
      );
    });
  }

  it('keeps resolving across repeated toggles', () => {
    reset();
    const show = signal(true);
    const Page = HOSTS.compiled(() => (show() ? h(Leaf, {}) : h('em', {}, 'off')));
    mount(h(Theme.Provider, { value: 'PROVIDED' }, h(Page, {})), '#root');
    flushSync();

    for (let i = 0; i < 3; i++) {
      show(false); flushSync();
      show(true); flushSync();
      assert.equal(root().querySelector('[data-value]').textContent, 'PROVIDED', `cycle ${i}`);
    }
  });
});

describe('an ErrorBoundary still catches throws from an inner region', () => {
  for (const [name, host] of Object.entries(HOSTS)) {
    it(`on the ${name} path`, () => {
      reset();
      const boom = signal(false);
      const Bad = () => { throw new Error('component exploded'); };
      const Good = () => h('p', { 'data-good': '' }, 'fine');
      const Page = host(() => (boom() ? h(Bad, {}) : h(Good, {})));

      const originalError = console.error;
      console.error = () => {};
      try {
        mount(
          h(ErrorBoundary, { fallback: ({ error }) => h('p', { 'data-caught': '' }, error.message) },
            h(Page, {})),
          '#root',
        );
        flushSync();
        assert.ok(root().querySelector('[data-good]'), 'renders normally first');

        boom(true);
        flushSync();
      } finally {
        console.error = originalError;
      }

      const caught = root().querySelector('[data-caught]');
      assert.ok(caught, 'the boundary must catch a throw from a region re-run, not let it escape');
      assert.equal(caught.textContent, 'component exploded');
    });
  }
});
