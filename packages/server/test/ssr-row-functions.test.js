// A list's row functions (ssr-runtime.js ssrList's `rowFns`): the reactive
// attributes of a `.map()` row, each written once for the list as a function
// of the row's item. What this file holds is how they reach a row. The list
// calls its callback with them, before the item, and the row hands them to
// its template before its holes, with its item as the hole of each. Nothing
// else carries them: no call leaves anything behind for another list, another render or a
// callback that runs later, whatever throws and whenever a source that is not
// an array calls the callback.
//
// The calls below are what what-compiler writes (packages/compiler/test/
// ssr-row-attributes.test.js holds the compiled side).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { ssr, ssrComponent, ssrList, ssrRow, ssrTemplate, ssrText } from '../src/ssr-runtime.js';
import { renderToString, renderToHydratableString, renderToStream } from '../src/index.js';
import { collect, content } from './stream-helpers.js';

// <li class={…} title={…}>{name}</li>, both attributes the list's.
const ROW = ssrTemplate(['<li', '', '>', '</li>'], [['class', 'class', 0], ['plain', 'title', 1], null]);
const row = (fns, item) => ssrRow(ROW, fns, item, item, ssrText(item.name));
const fnsOf = (tag) => [(item) => tag + '/class-' + item.name, (item) => tag + '/title-' + item.name];
const li = (tag, name) => `<li class="${tag}/class-${name}" title="${tag}/title-${name}">${name}</li>`;

const A = [{ id: 1, name: 'a1' }, { id: 2, name: 'a2' }];
const B = [{ id: 1, name: 'b1' }, { id: 2, name: 'b2' }];

const RENDERERS = {
  string: (node) => renderToString(node),
  hydratable: (node) => content(renderToHydratableString(node)),
  stream: async (node) => content(await collect(renderToStream(node, { onError: () => {} }))),
};

async function everywhere(make, expected) {
  for (const [name, render] of Object.entries(RENDERERS)) assert.equal(await render(make()), expected, name);
}

describe('a list calls its row callback with its row functions', () => {
  it('before the item, its index and the list; a list with none calls it as map() does', async () => {
    const calls = [];
    const fns = fnsOf('A');
    await everywhere(() => ssrList(A, function (f, item, i, list) {
      calls.push([f === fns, item.name, i, list === A, arguments.length]);
      return row(f, item);
    }, false, null, undefined, fns), li('A', 'a1') + li('A', 'a2'));
    assert.deepEqual(calls.slice(0, 2), [[true, 'a1', 0, true, 4], [true, 'a2', 1, true, 4]]);

    const plain = [];
    ssrList(A, function (item, i, list) {
      plain.push([item.name, i, list === A, arguments.length]);
      return ssrText(item.name);
    }, false);
    assert.deepEqual(plain, [['a1', 0, true, 3], ['a2', 1, true, 3]]);
  });

  it('a keyed list, in a reactive child, with a component in the row', async () => {
    const Badge = (props) => h('b', null, props.n);
    const WITH = ssrTemplate(['<li', '>', '</li>'], [['class', 'class', 0], null]);
    const fns = fnsOf('K');
    await everywhere(
      () => ssr(['<ul>', '</ul>'], () => ssrList(A, (f, item) => ssrRow(WITH, f, item, ssrComponent(Badge, { n: item.id }, [])), true, (item) => item.id, 3, fns)),
      '<ul><li class="K/class-a1"><b>1</b></li><li class="K/class-a2"><b>2</b></li></ul>',
    );
  });

  it('a source that is not an array: every call its map() makes, with what it passes', async () => {
    const calls = [];
    const fns = fnsOf('S');
    const source = { map: (fn) => B.map((item, i) => fn(item, i, 'third', 'fourth')) };
    await everywhere(() => ssrList(source, function (f, item) {
      calls.push([f === fns, ...Array.prototype.slice.call(arguments, 1).map((v) => (typeof v === 'object' ? v.name : v))]);
      return row(f, item);
    }, false, null, undefined, fns), li('S', 'b1') + li('S', 'b2'));
    assert.deepEqual(calls.slice(0, 2), [[true, 'b1', 0, 'third', 'fourth'], [true, 'b2', 1, 'third', 'fourth']]);

    // With no row functions the source is handed the callback itself.
    let handed;
    const fn = (item) => ssrText(item.name);
    ssrList({ map(f) { handed = f; return []; } }, fn, false);
    assert.equal(handed, fn);
  });
});

describe('a template that declares a row\'s reactive attribute takes the row functions before its holes', () => {
  it('ssrRow in a list and outside one, ssr and ssrForeign, with attributes of every kind around it', async () => {
    const { ssrForeign } = await import('../src/ssr-runtime.js');
    // <a href={plain} class={row's} title={reactive} data-n={row's}>{text}</a>
    const MIXED = ssrTemplate(['<a', '', '', '', '>', '</a>'], [['url', 'href'], ['class', 'class', 1], ['plain', 'title'], ['enum', 'data-n', 0], null]);
    const fns = [(item) => 'n-' + item.id, (item) => 'c-' + item.name];
    const filled = (fill, item) => fill(MIXED, fns, '/' + item.name, item, () => 't-' + item.name, item, ssrText(item.name));
    const a = (item) => `<a href="/${item.name}" class="c-${item.name}" title="t-${item.name}" data-n="n-${item.id}">${item.name}</a>`;
    await everywhere(() => ssrList(A, (f, item) => filled(ssrRow, item), false, null, undefined, fns), a(A[0]) + a(A[1]));
    for (const fill of [ssr, ssrForeign, ssrRow]) await everywhere(() => filled(fill, B[1]), a(B[1]));

    // A template that declares none is filled from its first argument, as
    // ever, next to one that does.
    const PLAIN = ssrTemplate(['<i', '>', '</i>'], [['class', 'class'], null]);
    await everywhere(() => ssrList(A, (f, item) => ssr(['', '', ''], ssr(PLAIN, () => 'p-' + item.id, ssrText(item.id)), filled(ssr, item)), false, null, undefined, fns),
      `<i class="p-1">1</i>${a(A[0])}<i class="p-2">2</i>${a(A[1])}`);
  });
});

describe('a row is given its own list\'s functions, whenever its callback runs', () => {
  it('a list inside a row: the outer row\'s attributes after it are the outer list\'s', async () => {
    const OUTER = ssrTemplate(['<section', '>', '<b', '>end</b></section>'], [['class', 'class', 0], null, ['plain', 'title', 1]]);
    const make = (inner) => ssrList(A, (f, group) => ssrRow(OUTER, f, group,
      ssrList(inner, (g, item) => row(g, item), false, null, undefined, fnsOf('in-' + group.name)),
      group), false, null, undefined, fnsOf('out'));
    const section = (name, rows) => `<section class="out/class-${name}">${rows.map((r) => li('in-' + name, r.name)).join('')}<b title="out/title-${name}">end</b></section>`;
    await everywhere(() => make(B), section('a1', B) + section('a2', B));
    await everywhere(() => make([]), section('a1', []) + section('a2', []));
  });

  it('a key function that throws leaves nothing for the list rendered next', async () => {
    const lazy = (rows) => ({
      map(fn) {
        const out = { length: rows.length };
        rows.forEach((item, i) => Object.defineProperty(out, i, { get: () => fn(item, i) }));
        return out;
      },
    });
    for (const [name, render] of Object.entries(RENDERERS)) {
      assert.throws(() => ssrList([A[0], null], (f, item) => row(f, item), true, (item) => item.id, 1, fnsOf('SESSION-OF-A')), TypeError);
      assert.equal(await render(ssrList(lazy(B), (f, item) => row(f, item), false, null, undefined, fnsOf('B'))), li('B', 'b1') + li('B', 'b2'), name);
      // A callback that throws, too.
      assert.throws(() => ssrList(A, () => { throw new RangeError('row'); }, false, null, undefined, fnsOf('SESSION-OF-A')), RangeError);
      assert.equal(await render(ssrList(lazy(B), (f, item) => row(f, item), false, null, undefined, fnsOf('B'))), li('B', 'b1') + li('B', 'b2'), name);
    }
  });

  it('a callback its source calls later, after other lists were rendered', async () => {
    // The source keeps the callback: its rows are made when they are placed.
    const later = (rows) => ({ map: (fn) => rows.map((item, i) => () => fn(item, i)) });
    for (const [name, render] of Object.entries(RENDERERS)) {
      const first = ssrList(later(A), (f, item) => row(f, item), false, null, undefined, fnsOf('first'));
      const second = ssrList(later(B), (f, item) => row(f, item), false, null, undefined, fnsOf('second'));
      const third = ssrList(B, (f, item) => row(f, item), false, null, undefined, fnsOf('third'));
      const html = await render(ssr(['<div>', '<hr>', '<hr>', '</div>'], second, first, third));
      assert.equal(html, `<div>${li('second', 'b1')}${li('second', 'b2')}<hr>${li('first', 'a1')}${li('first', 'a2')}<hr>${li('third', 'b1')}${li('third', 'b2')}</div>`, name);
    }

    // And one called by hand, long after its list returned.
    let kept;
    ssrList({ map(fn) { kept = fn; return []; } }, (f, item) => row(f, item), false, null, undefined, fnsOf('kept'));
    ssrList(A, (f, item) => row(f, item), false, null, undefined, fnsOf('other'));
    assert.equal(renderToString(kept(B[0], 0)), li('kept', 'b1'));
  });
});

describe('a row\'s reactive attribute in markup', () => {
  // The parts a markup defers that are the edges of a keyed list or row.
  const edges = (markup) => (markup.p || []).filter((part) => part !== null && typeof part === 'object' && typeof part.edge === 'function').length;

  it('a keyed row that defers only reactive attributes gets no row frame', () => {
    const fns = fnsOf('K');
    const only = ssrList(A, (f, item) => row(f, item), true, (item) => item.id, 1, fns);
    // The list's own edge, where it takes its place, and none for its rows.
    assert.equal(edges(only), 1);
    assert.equal(renderToString(only), li('K', 'a1') + li('K', 'a2'));

    // Nor does a row whose reactive attribute is a thunk of its own (one the
    // compiler could not hoist), alone or beside the list's.
    const THUNK = ssrTemplate(['<li', '>', '</li>'], [['class', 'class'], null]);
    const own = ssrList(A, (item) => ssrRow(THUNK, () => 'own-' + item.name, ssrText(item.name)), true, (item) => item.id, 1);
    assert.equal(edges(own), 1);
    assert.equal(renderToString(own), '<li class="own-a1">a1</li><li class="own-a2">a2</li>');
    const BOTH = ssrTemplate(['<li', '', '>', '</li>'], [['class', 'class', 0], ['plain', 'title'], null]);
    const both = ssrList(A, (f, item) => ssrRow(BOTH, f, item, () => 'own-' + item.name, ssrText(item.name)), true, (item) => item.id, 1, fns);
    assert.equal(edges(both), 1);
    assert.equal(renderToString(both), '<li class="K/class-a1" title="own-a1">a1</li><li class="K/class-a2" title="own-a2">a2</li>');

    // A row that defers what can render a component is between two edges.
    const WITH = ssrTemplate(['<li', '>', '</li>'], [['class', 'class', 0], null]);
    const Badge = (props) => h('b', null, props.n);
    for (const child of [(item) => ssrComponent(Badge, { n: item.id }, []), (item) => () => item.name]) {
      const framed = ssrList(A, (f, item) => ssrRow(WITH, f, item, child(item)), true, (item) => item.id, 1, fns);
      assert.equal(edges(framed), 1 + 2 * A.length);
    }

    // An unkeyed list has no edges at all, and a row of finished HTML no frame.
    assert.equal(edges(ssrList(A, (f, item) => row(f, item), true, null, undefined, fns)), 0);
    assert.equal(edges(ssrList(A, (item) => ssrRow(['<li>', '</li>'], ssrText(item.name)), true, (item) => item.id, 1)), 1);
  });

  it('keeps its function and its item when its markup goes into another, and as a part of its own', async () => {
    const fns = fnsOf('M');
    // A row made outside a list (its source is no array) is markup, which a
    // template takes in.
    const made = () => ssrRow(ROW, fns, B[0], B[0], ssrText(B[0].name));
    await everywhere(() => ssr(['<ul>', '</ul>'], made()), `<ul>${li('M', 'b1')}</ul>`);
    // Beside a reactive attribute of the ordinary kind, which has no item.
    const PLAIN = ssrTemplate(['<li', '>x</li>'], [['class', 'class']]);
    await everywhere(() => ssr(['<ul>', '', '', '</ul>'], ssr(PLAIN, () => 'one'), made(), ssr(PLAIN, () => 'two')),
      `<ul><li class="one">x</li>${li('M', 'b1')}<li class="two">x</li></ul>`);

    // parts(): each attribute on its own, and no item among the parts.
    const parts = ssrList(A, (f, item) => row(f, item), false, null, undefined, fns).parts();
    assert.ok(!parts.some((part) => A.includes(part)), 'an item is read as a part');
    assert.equal(parts.map((part) => (typeof part === 'string' ? part : part.parts())).join(''), li('M', 'a1') + li('M', 'a2'));
  });

  it('a function that throws or returns a function drops its attribute, and the item is never markup', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const hostile = [{ id: 1, name: '<img src=x onerror=alert(1)>' }];
      const fns = [() => { throw new Error('no class'); }, () => () => 'a function'];
      await everywhere(() => ssrList(hostile, (f, item) => row(f, item), false, null, undefined, fns), '<li>&lt;img src=x onerror=alert(1)&gt;</li>');
      await everywhere(() => ssrList(hostile, (f, item) => row(f, item), false, null, undefined, [(item) => item.name, (item) => item]),
        '<li class="&lt;img src=x onerror=alert(1)&gt;" title="[object Object]">&lt;img src=x onerror=alert(1)&gt;</li>');
    } finally {
      console.warn = warn;
    }
  });
});
