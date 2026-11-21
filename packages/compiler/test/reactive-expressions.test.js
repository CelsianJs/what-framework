// Expressions the compiler makes reactive like any other that reads a signal:
// optional chains (a()?.b, a()?.[k], f?.()), a call handed a function it may
// run (isPending(() => x()), a formatter given a getter, whatever the
// function's body evaluates), a call of a function or object method this
// module declares whose body reads, a call of a function the compiler cannot
// see, a computed member key (row[key()]), and <For each={expr}>, including
// an expression that picks one of two accessors. Each compiled form updates
// as the h() spelling of the same program does, and the server target marks
// the same holes reactive, so hydration agrees. mapArray, the runtime list
// behind <For>, takes an array as well as an accessor.

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
  export const alternate = signal(false);
  const primary = signal(['one', 'two']);
  const secondary = signal(['three']);
  export const forPick = () => <ul><For each={alternate() ? secondary : primary}>{(s) => <li>{s}</li>}</For></ul>;
  export const forPickFallback = () => <ul><For each={alternate() ? secondary : primary} fallback={<li>none</li>}>{(s) => <li>{s}</li>}</For></ul>;
  export const forPickProp = ({ rows, others }) => <ul><For each={alternate() ? others : rows}>{(s) => <li>{s}</li>}</For></ul>;
  export const label = signal('first');
  const model = { label: (prefix) => prefix + label(), plain: (prefix) => prefix + '!' };
  export const optionalMethod = () => <p>{model.label?.('tag:')}</p>;
  export const method = () => <p>{model.label('tag:')}</p>;
  export const later = () => <p>{tagged('tag:')}</p>;
  function tagged(prefix) { return prefix + label(); }
  export const blockCallback = () => <p>{fmt(() => { const text = label(); return text; })}</p>;
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
    const code = compileJSX("import { fmt } from 'fmt-lib'; const n = 2; const a = <p>{fmt(1, n)}{fmt(() => 1)}</p>;");
    assert.ok(!code.includes('() => fmt('), code);
  });

  it('a call reaching a value nobody proved static, or a global the platform does not define, is wrapped', () => {
    const code = compileJSX("import { fmt } from 'fmt-lib'; function Row(item) { return <p>{fmt(item, 1)}{other(1)}</p>; }");
    assert.ok(code.includes('() => fmt(item, 1)') && code.includes('() => other(1)'), code);
  });

  it('a callback that reads anywhere in its block body', () => {
    for (const body of [
      'const text = label(); return text;',
      'label();',
      'let text; text = label(); return text;',
      'try { return label(); } catch { return ""; }',
      'switch (label()) { default: return 1; }',
      'for (const part of label()) return part;',
      'if (label()) return 1;',
    ]) {
      const code = compileJSX(`import { fmt } from 'fmt-lib'; const label = signal(''); const a = <p>{fmt(() => { ${body} })}</p>;`);
      assert.ok(code.includes('() => fmt('), `${body}\n${code}`);
    }
    const nested = compileJSX('import { fmt } from "fmt-lib"; const label = signal(""); const a = <p>{fmt(() => { const later = () => label(); return 1; })}</p>;');
    assert.ok(!nested.includes('() => fmt('), nested);
  });

  it('a call of a local function or object method is as reactive as its body, wherever it is declared', () => {
    const reads = `
      const label = signal('');
      function before(p) { return p + label(); }
      const model = { label: (p) => p + label(), method(p) { return label(); }, alias: before };
      const a = <p>{before('x')}{after('x')}{model.label('x')}{model.label?.('x')}{model.method('x')}{model.alias('x')}</p>;
      function after(p) { return p + label(); }
    `;
    const code = compileJSX(reads);
    for (const call of ["before('x')", "after('x')", "model.label('x')", "model.label?.('x')", "model.method('x')", "model.alias('x')"]) {
      assert.ok(code.includes(`() => ${call}`), `${call}\n${code}`);
    }
    const plain = compileJSX(`
      function shout(p) { return p.toUpperCase() + '!'; }
      const model = { plain: (p) => p + '!' };
      const a = <p>{shout('x')}{model.plain('x')}{count(3)}</p>;
      function count(n) { return n > 0 ? count(n - 1) : 0; }
    `);
    for (const call of ["shout('x')", "model.plain('x')", 'count(3)']) assert.ok(!plain.includes(`() => ${call}`), `${call}\n${plain}`);
  });

  it('a call of a function the compiler cannot see is wrapped; built-ins, globals and package utilities applied to proven values are not', () => {
    const code = compileJSX(`
      import { format } from 'date-fns';
      const name = 'Ada';
      const day = new Date(0);
      function Row(props, render, row) {
        const formatter = makeFormatter();
        return <p>{props.format('x')}{render('x')}{formatter('x')}{alert('x')}{row.padStart(3)}{JSON.stringify(row)}{name.padStart(3)}{format(day, 'P')}{JSON.stringify({ id: 1 })}{Math.max(2, 3)}</p>;
      }
    `);
    for (const call of ["props.format('x')", "render('x')", "formatter('x')", "alert('x')", 'row.padStart(3)', 'JSON.stringify(row)']) {
      assert.ok(code.includes(`() => ${call}`), `${call}\n${code}`);
    }
    for (const call of ['name.padStart(3)', "format(day, 'P')", 'JSON.stringify({', 'Math.max(2, 3)']) {
      assert.ok(!code.includes(`() => ${call}`), `${call}\n${code}`);
    }
  });

  it('a <For> expression that picks an accessor reads the one it picks', () => {
    const code = compileJSX('const on = signal(false); const a = signal([]); const b = signal([]); const x = <ul><For each={on() ? b : a}>{(n) => <li>{n}</li>}</For></ul>;');
    assert.ok(code.includes('_$mapArray(() => on() ? b() : a(),'), code);
    const props = compileJSX('const X = ({ rows }) => <ul><For each={rows ?? none()}>{(n) => <li>{n}</li>}</For></ul>;');
    assert.ok(props.includes('typeof rows === "function" ? rows() : rows'), props);
  });

  it('a plain name or a member is handed to <For> as it is', () => {
    assert.ok(compileJSX('const a = <ul><For each={rows}>{(n) => <li>{n}</li>}</For></ul>;').includes('_$mapArray(rows,'));
    assert.ok(compileJSX('const a = <ul><For each={props.rows}>{(n) => <li>{n}</li>}</For></ul>;').includes('_$mapArray(props.rows,'));
  });

  it('the server target marks the same holes reactive', () => {
    const code = compileJSX('const a = <p>{user()?.name}{fmt(() => user())}</p>;', { pluginOptions: { generate: 'ssr' } });
    assert.ok(code.includes('() => user()?.name') && code.includes('() => fmt(() => user())'), code);
    const local = compileJSX("const label = signal(''); const model = { label: (p) => p + label() }; const a = <p>{model.label?.('x')}{fmt(() => { const t = label(); return t; })}</p>;", { pluginOptions: { generate: 'ssr' } });
    assert.ok(local.includes("() => model.label?.('x')") && local.includes('() => fmt(() => {'), local);
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

  it('a local method, a function declared after the JSX and a block callback follow the signal they read', () => {
    client.label('first');
    const compiled = [client.optionalMethod, client.method, client.later, client.blockCallback].map((View) => render(View()));
    const hTree = render(h('p', null, () => 'tag:' + client.label()));
    const texts = () => [...compiled, hTree].map((r) => r.host.textContent);
    assert.deepEqual(texts(), ['tag:first', 'tag:first', 'tag:first', '[first]', 'tag:first']);
    client.label('second');
    flushSync();
    assert.deepEqual(texts(), ['tag:second', 'tag:second', 'tag:second', '[second]', 'tag:second']);
    for (const r of [...compiled, hTree]) r.stop();
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

  it('<For> over an expression that picks one of two accessors renders the one it picks', () => {
    client.alternate(false);
    const rows = signal(['r']);
    const compiled = [render(client.forPick()), render(client.forPickFallback()), render(client.forPickProp({ rows, others: ['o1', 'o2'] }))];
    const texts = () => compiled.map((r) => r.host.textContent);
    assert.deepEqual(texts(), ['onetwo', 'onetwo', 'r']);
    client.alternate(true);
    flushSync();
    assert.deepEqual(texts(), ['three', 'three', 'o1o2']);
    client.alternate(false);
    rows(['r', 's']);
    flushSync();
    assert.deepEqual(texts(), ['onetwo', 'onetwo', 'rs']);
    for (const r of compiled) r.stop();
  });

  it('mapArray takes an array as a list that never changes', () => {
    const host = document.createElement('div');
    const stop = W.mount(h('ul', null, R.mapArray(['a', 'b'], (s) => h('li', null, s))), host);
    assert.equal(host.textContent, 'ab');
    stop();
  });
});
