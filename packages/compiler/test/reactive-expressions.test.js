// Expressions the compiler makes reactive like any other that reads a signal:
// optional chains (a()?.b, a()?.[k], f?.()), a call handed a function it may
// run (isPending(() => x()), a formatter given a getter), a computed member
// key (row[key()]), and <For each={expr}>. Each compiled form updates as the
// h() spelling of the same program does, and the server target marks the
// same holes reactive, so hydration agrees. mapArray, the runtime list behind
// <For>, takes an array as well as an accessor.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');
const W = await import('../../core/src/index.js');
const R = await import('../../core/src/render.js');

const SOURCE = `
  import { signal, isPending, For, mount } from 'what-framework';
  export const user = signal(null);
  export const key = signal('name');
  export const list = signal([1, 2]);
  export const handler = signal(null);
  export const fmt = (get) => '[' + get() + ']';
  export const chain = () => <p>{user()?.name}</p>;
  export const computedKey = () => <p>{user()?.[key()]}</p>;
  export const optionalCall = () => <p>{handler()?.()}</p>;
  export const callback = () => <p>{fmt(() => user()?.name)}</p>;
  export const pending = (v) => <p>{String(isPending(() => v()))}</p>;
  export const forCall = () => <ul><For each={list().filter((n) => n > 0)}>{(n) => <li>{n}</li>}</For></ul>;
  export const forArray = () => <ul><For each={[3, 4]}>{(n) => <li>{n}</li>}</For></ul>;
  export const forFallback = () => <ul><For each={list().filter((n) => n > 0)} fallback={<li>none</li>}>{(n) => <li>{n}</li>}</For></ul>;
  export { mount };
`;

const client = await loadCompiled(SOURCE);

function render(node) {
  const host = document.createElement('div');
  const stop = W.mount(node, host);
  return { host, stop };
}

describe('compiled output: these expressions are wrapped', () => {
  for (const [jsx, out] of [
    ['<p>{user()?.name}</p>', '() => user()?.name'],
    ['<p>{user()?.[k]}</p>', "() => user()?.[k]"],
    ['<p>{f?.()}</p>', '() => f?.()'],
    ['<p>{fmt(() => user())}</p>', '() => fmt(() => user())'],
    ['<p>{row[key()]}</p>', '() => row[key()]'],
    ['<ul><For each={list()}>{(n) => <li>{n}</li>}</For></ul>', '_$mapArray(() => list(),'],
  ]) {
    it(jsx, () => {
      const code = compileJSX(`const a = ${jsx};`);
      assert.ok(code.includes(out), code);
    });
  }

  it('a call with plain arguments, and a callback that reads nothing reactive, stay static', () => {
    const code = compileJSX('const a = <p>{fmt(a, b)}{fmt(() => 1)}</p>;');
    assert.ok(!code.includes('() => fmt('), code);
  });

  it('a plain name or a member is handed to <For> as it is', () => {
    assert.ok(compileJSX('const a = <ul><For each={rows}>{(n) => <li>{n}</li>}</For></ul>;').includes('_$mapArray(rows,'));
    assert.ok(compileJSX('const a = <ul><For each={props.rows}>{(n) => <li>{n}</li>}</For></ul>;').includes('_$mapArray(props.rows,'));
  });

  it('the server target marks the same holes reactive', () => {
    const code = compileJSX('const a = <p>{user()?.name}{fmt(() => user())}</p>;', { pluginOptions: { generate: 'ssr' } });
    assert.ok(code.includes('() => user()?.name') && code.includes('() => fmt(() => user())'), code);
  });
});

describe('compiled and h() update alike', () => {
  const { h, signal, flushSync, isPending, computed, settled } = W;

  it('an optional chain, a computed key and an optional call', () => {
    client.user(null);
    client.key('name');
    client.handler(null);
    const compiled = [render(client.chain()), render(client.computedKey()), render(client.optionalCall())];
    const hTree = [
      render(h('p', null, () => client.user()?.name)),
      render(h('p', null, () => client.user()?.[client.key()])),
      render(h('p', null, () => client.handler()?.())),
    ];
    const texts = () => [compiled.map((r) => r.host.textContent), hTree.map((r) => r.host.textContent)];
    assert.deepEqual(texts(), [['', '', ''], ['', '', '']]);
    client.user({ name: 'Ada', role: 'admin' });
    client.handler(() => () => 'called');
    flushSync();
    assert.deepEqual(texts(), [['Ada', 'Ada', 'called'], ['Ada', 'Ada', 'called']]);
    client.key('role');
    flushSync();
    assert.deepEqual(texts(), [['Ada', 'admin', 'called'], ['Ada', 'admin', 'called']]);
    for (const r of [...compiled, ...hTree]) r.stop();
  });

  it('a call handed a function that reads a signal', () => {
    client.user({ name: 'Ada' });
    const compiled = render(client.callback());
    const hTree = render(h('p', null, () => client.fmt(() => client.user()?.name)));
    client.user({ name: 'Bo' });
    flushSync();
    assert.deepEqual([compiled.host.textContent, hTree.host.textContent], ['[Bo]', '[Bo]']);
    compiled.stop();
    hTree.stop();
  });

  it('isPending(() => value()) as a child shows the refetch', async () => {
    const id = signal(1);
    const flights = [];
    const value = computed(async () => { id(); return new Promise((resolve) => flights.push(resolve)); });
    const compiled = render(client.pending(value));
    const hTree = render(h('p', null, () => String(isPending(() => value()))));
    flights.shift()('first');
    await settled();
    id(2);
    flushSync();
    assert.deepEqual([compiled.host.textContent, hTree.host.textContent], ['true', 'true']);
    flights.shift()('second');
    await settled();
    assert.deepEqual([compiled.host.textContent, hTree.host.textContent], ['false', 'false']);
    compiled.stop();
    hTree.stop();
  });

  it('<For each={expr}> follows the expression, with or without a fallback; an array is a fixed list', () => {
    client.list([1, 2]);
    const forCall = render(client.forCall());
    const forFallback = render(client.forFallback());
    const forArray = render(client.forArray());
    const hTree = render(h('ul', null, h(W.For, { each: () => client.list().filter((n) => n > 0) }, (n) => h('li', null, n))));
    const hArray = render(h('ul', null, h(W.For, { each: [3, 4] }, (n) => h('li', null, n))));
    assert.deepEqual([forCall, forFallback, forArray, hTree, hArray].map((r) => r.host.textContent), ['12', '12', '34', '12', '34']);
    client.list([-1]);
    flushSync();
    assert.deepEqual([forCall, forFallback, hTree].map((r) => r.host.textContent), ['', 'none', '']);
    client.list([5]);
    flushSync();
    assert.deepEqual([forCall, forFallback, hTree].map((r) => r.host.textContent), ['5', '5', '5']);
    for (const r of [forCall, forFallback, forArray, hTree, hArray]) r.stop();
  });

  it('mapArray takes an array as a list that never changes', () => {
    const host = document.createElement('div');
    const stop = W.mount(h('ul', null, R.mapArray(['a', 'b'], (s) => h('li', null, s))), host);
    assert.equal(host.textContent, 'ab');
    stop();
  });
});
