// What a child that is not a string, a number, a vnode or nothing renders as,
// on every path: the server (h() and compiled JSX), the client (h() and
// compiled JSX, mounted) and hydration (each authoring over its own server
// markup, with no mismatch). Every path must give the same markup.
//
// A Symbol renders nothing, as null and booleans do (React refuses one; its
// text would be the program's internals). Everything else renders as its
// text, as the error catalogue says of an object that is not a vnode
// (ERR_NO_VNODE_RENDERER): a Date as its local toString(), so a server and a
// browser in different time zones disagree; a Promise as "[object Promise]",
// since a child is not awaited (use() or createResource reads one).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();
const { h, mount, hydrate, signal, flushSync } = await import('../../core/src/index.js');
const { renderToString, renderToHydratableString } = await import('../src/index.js');

const source = `
export const Child = (v) => function C() { return <div>{v}</div>; };
export const Live = (read) => function C() { return <div>{read()}</div>; };
export const Rows = (rows) => function C() { return <ul>{rows().map((r) => <li key={r.id}>{r.label}</li>)}</ul>; };
`;
const client = await loadCompiled(source);
const hydratable = await loadCompiled(source, { pluginOptions: { hydratable: true } });
const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });

const date = new Date(0);
const ROWS = [
  ['a Symbol', () => Symbol('test'), ''],
  ['a Symbol in an array', () => ['a', Symbol('x'), 'b'], 'ab'],
  ['a BigInt', () => 10n, '10'],
  ['a function returning a function', () => () => () => 'x', 'x'],
  ['a plain object', () => ({ a: 1 }), '[object Object]'],
  ['NaN', () => NaN, 'NaN'],
  ['-0', () => -0, '0'],
  ['a Date', () => date, String(date), 'its local toString()'],
  ['a Promise', () => Promise.resolve('p'), '[object Promise]'],
  // eslint-disable-next-line no-sparse-arrays
  ['an array with holes', () => [1, , 3], '13'],
];

const strip = (html) => html.replace(/<!--[^>]*-->/g, '');
function inHost(fn) {
  const el = document.createElement('div');
  document.body.append(el);
  try { return fn(el); } finally { el.remove(); }
}
const mounted = (vnode) => inHost((el) => { const stop = mount(vnode, el); const out = strip(el.innerHTML); stop(); return out; });
const hydrated = (serverVnode, clientVnode) => inHost((el) => {
  el.innerHTML = renderToHydratableString(serverVnode);
  const mismatches = [];
  const stop = hydrate(clientVnode, el, { onHydrationError: (e) => mismatches.push(e.kind) });
  const out = strip(el.innerHTML);
  stop();
  assert.deepEqual(mismatches, [], 'no hydration mismatch');
  return out;
});

describe('odd children: every path renders the same', () => {
  for (const [title, make, text, shown = JSON.stringify(text)] of ROWS) {
    it(`${title} renders ${shown}`, () => {
      const want = `<div>${text}</div>`;
      assert.equal(renderToString(h('div', null, make())), want, 'server, h()');
      assert.equal(renderToString(h(server.Child(make()))), want, 'server, compiled');
      assert.equal(mounted(h('div', null, make())), want, 'client, h()');
      assert.equal(mounted(h(client.Child(make()))), want, 'client, compiled');
      assert.equal(hydrated(h('div', null, make()), h('div', null, make())), want, 'hydration, h()');
      assert.equal(hydrated(h(server.Child(make())), h(hydratable.Child(make()))), want, 'hydration, compiled');
    });
  }
});

describe('a Symbol renders nothing wherever it arrives', () => {
  it('as a component\'s whole output', () => {
    const Sym = () => Symbol('whole');
    assert.equal(renderToString(h('p', null, h(Sym))), '<p></p>');
    assert.equal(mounted(h('p', null, h(Sym))), '<p></p>');
  });

  it('from a signal that changes to and from it', () => {
    const v = signal('a');
    inHost((el) => {
      const stop = mount(h(client.Live(v)), el);
      assert.equal(strip(el.innerHTML), '<div>a</div>');
      v(Symbol('later'));
      flushSync();
      assert.equal(strip(el.innerHTML), '<div></div>');
      v('b');
      flushSync();
      assert.equal(strip(el.innerHTML), '<div>b</div>');
      stop();
    });
  });

  it('as a keyed row\'s field, on the server and in hydration', () => {
    const rows = () => [{ id: 1, label: 'one' }, { id: 2, label: Symbol('two') }];
    const want = '<ul><li>one</li><li></li></ul>';
    assert.equal(strip(renderToString(h(server.Rows(rows)))), want);
    assert.equal(mounted(h(client.Rows(rows))), want);
    assert.equal(hydrated(h(server.Rows(rows)), h(hydratable.Rows(rows))), want);
  });
});
