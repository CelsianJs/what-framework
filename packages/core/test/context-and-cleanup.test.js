// A context is its own provider (React 19, Solid 2): <Ctx value> and
// <Ctx.Provider value> are one component. Reading a context created without a
// default with no provider above reports ERR_CONTEXT_NOT_PROVIDED in
// development. onCleanup attaches to the component being rendered, or else to
// the reactive owner around the call.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');

const { h, mount, createContext, useContext, onCleanup, createRoot, signal, effect, flushSync } = await import('what-framework');
const { capture, clearDiagnostics } = await import('../src/diagnostics.js');

function quietly(run) {
  const cap = capture({ quiet: true });
  try { run(); } finally { cap.stop(); }
  return cap.events;
}

const app = () => document.getElementById('app');

describe('context as its own provider', () => {
  it('the context and its .Provider are the same component', () => {
    const Theme = createContext('light');
    assert.equal(Theme.Provider, Theme);
    assert.equal(typeof Theme, 'function');
  });

  it('<Ctx value> provides to its subtree, as <Ctx.Provider value> does', () => {
    const Theme = createContext('light');
    const Reader = () => h('span', {}, useContext(Theme));
    mount(h('div', {}, h(Theme, { value: 'dark' }, h(Reader)), h(Theme.Provider, { value: 'dim' }, h(Reader)), h(Reader)), app());
    assert.equal(app().textContent, 'darkdimlight');
  });

  it('works from compiled JSX', async () => {
    const { Page } = await loadCompiled(`
      import { createContext, useContext } from 'what-framework';
      const Theme = createContext('light');
      function Reader() { return <span>{useContext(Theme)}</span>; }
      export function Page() { return <div><Theme value="dark"><Reader /></Theme><Reader /></div>; }
    `);
    mount(h(Page), app());
    assert.equal(app().textContent, 'darklight');
  });
});

describe('ERR_CONTEXT_NOT_PROVIDED', () => {
  beforeEach(() => clearDiagnostics());

  it('is reported when a context with no default is read with no provider', () => {
    const User = createContext();
    User.displayName = 'User';
    let value = 'unset';
    const events = quietly(() => mount(h(() => { value = useContext(User); return null; }), app()));
    assert.equal(value, undefined);
    assert.deepEqual(events.map((e) => e.code), ['ERR_CONTEXT_NOT_PROVIDED']);
    assert.match(events[0].message, /^User was read with no provider/);
  });

  it('is not reported under a provider, or for a context with a default (even undefined)', () => {
    const User = createContext();
    const Optional = createContext(undefined);
    const events = quietly(() => mount(h(User, { value: 'ada' }, h(() => {
      useContext(User);
      useContext(Optional);
      return null;
    })), app()));
    assert.deepEqual(events, []);
  });
});

describe('onCleanup', () => {
  beforeEach(() => clearDiagnostics());

  it('in a component, runs when the component unmounts', () => {
    let ran = 0;
    const unmount = mount(h(() => { onCleanup(() => { ran++; }); return null; }), app());
    assert.equal(ran, 0);
    unmount();
    assert.equal(ran, 1);
  });

  it('outside a component, runs when the reactive owner is disposed', () => {
    let ran = 0;
    const dispose = createRoot((d) => { onCleanup(() => { ran++; }); return d; });
    assert.equal(ran, 0);
    dispose();
    assert.equal(ran, 1);
  });

  it('in an effect, runs before the effect runs again and when it is disposed', () => {
    const tick = signal(0);
    const log = [];
    const events = quietly(() => {
      const stop = effect(() => { const t = tick(); onCleanup(() => { log.push(t); }); });
      tick(1);
      flushSync();
      assert.deepEqual(log, [0]);
      stop();
    });
    assert.deepEqual(log, [0, 1]);
    assert.deepEqual(events, []);
  });

  it('with no owner at all, reports instead of throwing', () => {
    const events = quietly(() => { onCleanup(() => {}); });
    assert.deepEqual(events.map((e) => e.code), ['ERR_CLEANUP_WITHOUT_OWNER']);
  });
});
