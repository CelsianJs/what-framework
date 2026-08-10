// A component using hooks must be renderable on the server.
//
// renderToString called `vnode.tag(props)` directly, with nothing on the
// component stack. Every hook that needs a context resolves it through
// getCurrentComponent(), so all ten of them plus Context.Provider threw:
//
//   [what] useState() can only be called inside a component function.
//
// A single useState, useRef, onMount or <Ctx.Provider> anywhere in the tree
// meant the page could not be server-rendered at all. Not a hydration warning,
// not a degraded render: renderToString threw and SSR failed outright. The same
// hole existed in all three server render paths (renderToString,
// renderToHydratableString, renderToStream), each with its own bare call.
//
// Nothing in the unit suite caught it because SSR tests render plain element
// trees and hook tests mount on the client. The two features are only broken
// TOGETHER, which is the shape every bug in this class has had.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { h } from 'what-core';
import {
  useState,
  useSignal,
  useComputed,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useReducer,
  onMount,
  onCleanup,
  createContext,
  useContext,
} from 'what-core';
import { renderToString, renderToHydratableString, renderToStream } from '../src/index.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('every context-dependent hook survives server rendering', () => {
  // One case per hook that calls getCtx(). If a new one is added and it is not
  // safe on the server, this table is where that shows up.
  const cases = {
    useState: () => { const [n] = useState(7); return h('p', {}, `n=${n()}`); },
    useSignal: () => { const s = useSignal(7); return h('p', {}, `n=${s()}`); },
    useComputed: () => { const c = useComputed(() => 7); return h('p', {}, `n=${c()}`); },
    useEffect: () => { useEffect(() => {}, []); return h('p', {}, 'n=7'); },
    // useMemo returns a computed accessor, not the value.
    useMemo: () => { const m = useMemo(() => 7, []); return h('p', {}, `n=${m()}`); },
    useCallback: () => { useCallback(() => {}, []); return h('p', {}, 'n=7'); },
    useRef: () => { const r = useRef(null); return h('p', {}, `n=${r.current === null ? 7 : 0}`); },
    useReducer: () => { const [n] = useReducer((s) => s, 7); return h('p', {}, `n=${n()}`); },
    onMount: () => { onMount(() => {}); return h('p', {}, 'n=7'); },
    onCleanup: () => { onCleanup(() => {}); return h('p', {}, 'n=7'); },
  };

  for (const [name, Component] of Object.entries(cases)) {
    it(`renders a component using ${name}()`, () => {
      assert.equal(renderToString(h(Component, {})), '<p>n=7</p>');
    });
  }
});

describe('the hooks are usable on every server render path', () => {
  const Counter = () => {
    const [n] = useState(41);
    return h('p', {}, `n=${n() + 1}`);
  };

  it('renderToString', () => {
    assert.equal(renderToString(h(Counter, {})), '<p>n=42</p>');
  });

  it('renderToHydratableString', () => {
    // This path also injects data-hk keys, so assert on content rather than an
    // exact string.
    assert.match(renderToHydratableString(h(Counter, {})), /n=42/);
  });

  it('renderToStream', async () => {
    let html = '';
    for await (const chunk of renderToStream(h(Counter, {}), {})) html += chunk;
    assert.match(html, /n=42/);
  });
});

describe('context resolves through the tree on the server', () => {
  // useContext walks _parentCtx, so the provider's context has to stay on the
  // stack while its children render. Popping it as soon as the provider
  // returned would leave every consumer reading the default value: a silent
  // wrong render rather than a crash, which is worse.
  const Theme = createContext('default');

  const Consumer = () => h('span', {}, useContext(Theme));

  it('a consumer sees its provider value, not the default', () => {
    const html = renderToString(
      h(Theme.Provider, { value: 'dark' }, h('div', {}, h(Consumer, {}))),
    );
    assert.equal(html, '<div><span>dark</span></div>');
  });

  it('the nearest provider wins', () => {
    const html = renderToString(
      h(Theme.Provider, { value: 'dark' },
        h('div', {},
          h(Consumer, {}),
          h(Theme.Provider, { value: 'light' }, h(Consumer, {})))),
    );
    assert.equal(html, '<div><span>dark</span><span>light</span></div>');
  });

  it('falls back to the default outside any provider', () => {
    assert.equal(renderToString(h(Consumer, {})), '<span>default</span>');
  });

  it('sibling subtrees do not leak context into each other', () => {
    // If a frame were left on the stack after its subtree finished, the next
    // sibling would inherit it.
    const html = renderToString(
      h('div', {},
        h(Theme.Provider, { value: 'dark' }, h(Consumer, {})),
        h(Consumer, {})),
    );
    assert.equal(html, '<div><span>dark</span><span>default</span></div>');
  });

  it('streams context correctly too', async () => {
    let html = '';
    const tree = h(Theme.Provider, { value: 'dark' }, h('div', {}, h(Consumer, {})));
    for await (const chunk of renderToStream(tree, {})) html += chunk;
    assert.match(html, /<span>dark<\/span>/);
  });
});

describe('a server render leaves nothing running', () => {
  it('does not run useEffect bodies', async () => {
    // useEffect defers its body to a microtask that checks ctx.disposed. The
    // server never mounts, so the context is marked disposed on the way out and
    // the body must never fire. If it did, an SSR render would start intervals,
    // open subscriptions and fetch on the server, once per render, with no
    // unmount to ever clean them up.
    let ran = 0;
    const Component = () => {
      useEffect(() => { ran++; }, []);
      useEffect(() => { ran++; });
      return h('p', {}, 'x');
    };

    renderToString(h(Component, {}));
    await tick();
    await tick();

    assert.equal(ran, 0, 'no effect body may run during SSR');
  });

  it('does not run onMount callbacks', async () => {
    let mounted = 0;
    const Component = () => {
      onMount(() => { mounted++; });
      return h('p', {}, 'x');
    };

    renderToString(h(Component, {}));
    await tick();

    assert.equal(mounted, 0);
  });
});

describe('a throwing component does not corrupt the render that follows', () => {
  it('unwinds its context frame', () => {
    // The frame is popped in a finally. Without one, a component that threw
    // would leave its context on the stack forever and every later component in
    // the process would resolve its parent context to a dead frame.
    const Theme = createContext('default');
    const Boom = () => { throw new Error('boom'); };
    const Consumer = () => h('span', {}, useContext(Theme));

    assert.throws(() => renderToString(h(Theme.Provider, { value: 'dark' }, h(Boom, {}))));
    assert.equal(renderToString(h(Consumer, {})), '<span>default</span>',
      'the next render must not inherit the failed one\'s context');
  });
});
