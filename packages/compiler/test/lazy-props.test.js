// What the compiler hands a component lazily (render.js _$slots) and where
// hydratable output builds JSX in place:
// - a prop whose value renders JSX it builds is a slot: JSX, a condition with
//   JSX in a branch, an array literal holding some, a .map() whose callback
//   returns some;
// - JSX a callback returns is where the call is (`.map((l) => <li />)`): in
//   place in a hole, built off the walk (_$outside) in a variable;
// - a function an attribute passes (a <For> key, an event handler) takes an
//   item or an event, not props: its reads are never placing reads.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileJSX } from '../../../test-utils/compile.js';

const dom = (source) => compileJSX(source);
const hydratable = (source) => compileJSX(source, { pluginOptions: { hydratable: true } });

describe('JSX props compiled as slots', () => {
  for (const [shape, value] of [
    ['a .map() whose callback returns JSX', `items.map((l) => <li>{l}</li>)`],
    ['a .map() with a block callback', `items.map((l) => { const t = l.toUpperCase(); return <li>{t}</li>; })`],
    ['a .flatMap()', `items.flatMap((l) => [<dt>{l}</dt>, <dd>{l}</dd>])`],
    ['an array literal holding JSX', `[<b>x</b>, 'text']`],
  ]) {
    it(`${shape} is a slot`, () => {
      const out = dom(`function Menu({ items }) { return <ul>{items}</ul>; } export function Page({ items }) { return <Menu items={${value}} />; }`);
      assert.match(out, /_\$slots\(\{\}, \{\s*items: \(\) =>/);
    });
  }

  it('a .map() whose callback returns no JSX, and data, stay plain props', () => {
    const out = dom(`function Menu({ items }) { return <ul>{items.length}</ul>; } export function Page({ rows }) { return <Menu items={rows.map((r) => r.id)} />; }`);
    assert.doesNotMatch(out, /_\$slots/);
  });
});

describe('JSX a callback returns, in hydratable output', () => {
  it('in a variable it is built off the walk', () => {
    const out = hydratable(`export function Page() { const rows = ['a', 'b'].map((k) => <input name={k} />); return <form>{rows}</form>; }`);
    assert.match(out, /\.map\(k => _\$outside\(/);
  });

  it('in a hole, or in a slot, it claims in place', () => {
    for (const source of [
      `export function Page() { return <form>{['a', 'b'].map((k) => <input name={k} />)}</form>; }`,
      `function R({ rows }) { return <form>{rows}</form>; } export function Page() { return <R rows={['a', 'b'].map((k) => <input name={k} />)} />; }`,
      `export function Page(props) { return <ul>{props.items.map((i) => <li>{i}</li>)}</ul>; }`,
    ]) {
      const out = hydratable(source);
      assert.doesNotMatch(out, /_\$outside/, source);
      assert.match(out, /_\$claim\(/, source);
    }
  });

  it('a region, a children factory and a row are still in place', () => {
    const out = hydratable(`import { signal } from 'what-framework';
      const on = signal(true);
      function Box({ children }) { return <div>{children}</div>; }
      export function Page() { return <main>{() => on() ? <b>on</b> : null}<Box>{[1, 2].map((n) => <i>{n}</i>)}</Box></main>; }`);
    assert.doesNotMatch(out, /_\$outside/);
  });
});

describe('a function an attribute passes', () => {
  it('a <For> key and an event handler read their parameter as it is', () => {
    const out = dom(`import { For, signal } from 'what-framework';
      const rows = signal([{ id: 1, label: 'a' }]);
      export function T() { return <ul><For each={rows} key={(r) => r.id}>{(r) => <li>{r().label}</li>}</For><button onClick={(e) => e.detail}>x</button></ul>; }`);
    assert.doesNotMatch(out, /_\$place\(r\b/);
    assert.doesNotMatch(out, /_\$place\(e\b/);
    assert.match(out, /key: r => r\.id/);
  });

  it('a render prop reads its parameter as it is', () => {
    const out = dom(`function List(props) { return <ul>{props.render({ label: 'x' })}</ul>; }
      export function Page() { return <List render={(item) => item.label} />; }`);
    assert.doesNotMatch(out, /_\$place\(item\b/);
  });
});
