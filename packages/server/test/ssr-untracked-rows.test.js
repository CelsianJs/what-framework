// A keyed list enters its rows (ssr-runtime.js RowEdge for compiled markup,
// what-core hydration-data.js _enterRow) only once keyed rows are tracked,
// which an app's first server action turns on for the whole process: a row's
// place is read by nothing but a useActionState key. Before that, a compiled
// list makes no edge, and compiled and h() lists render the same HTML in every
// renderer.
//
// This file defines a server action halfway through, so it runs apart from
// the files that render without one.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { ssr, ssrComponent, ssrFor, ssrList, ssrRow, ssrText } from '../src/ssr-runtime.js';
import { action, renderToHydratableString, renderToStream, renderToString } from '../src/index.js';
import { collect, keyShape } from './stream-helpers.js';

const ITEMS = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 1, name: 'c' }];
const Badge = (props) => ssr(['<b>', '</b>'], ssrText(props.name));
// <ul>{items.map(item => <li>{item.name}<Badge name={item.name} /></li>)}</ul>, keyed by id.
const list = () => ssrList(ITEMS, (item) => ssrRow(['<li>', '', '</li>'], ssrText(item.name), ssrComponent(Badge, { name: item.name }, [], 7)), true, (item) => item.id, 3);
const page = () => ssr(['<ul>', '</ul>'], () => list());
// <For each={[]} key={…} fallback={<p>none</p>}>, which takes its place with no rows.
const empty = () => ssrFor([], (item) => ssrText(item), (item) => item, ssr(['<p>none</p>']), 4)();
// The same list as h() writes it, whose vnodes carry their keys.
const Item = (props) => h('li', null, props.name, h(() => h('b', null, props.name), {}));
const hPage = () => h('ul', null, ITEMS.map((item) => h(Item, { key: item.id, name: item.name })));

const edges = (markup) => (markup.p || []).filter((part) => part !== null && typeof part === 'object' && typeof part.edge === 'function').length;

async function renders() {
  return {
    string: renderToString(h(() => page())),
    hydratable: keyShape(renderToHydratableString(h(() => page()))),
    stream: keyShape(await collect(renderToStream(h(() => page()), { onError: () => {} }))),
    empty: renderToString(h(() => empty())),
    hString: renderToString(hPage()),
    hHydratable: renderToHydratableString(hPage()),
    hStream: await collect(renderToStream(hPage(), { onError: () => {} })),
  };
}

describe('keyed rows on the server', () => {
  it('are entered only once a server action is defined, with the same HTML before and after', async () => {
    assert.equal(edges(list()), 0);
    assert.equal(edges(empty()), 0);
    const untracked = await renders();
    assert.equal(untracked.string, '<ul><li>a<b>a</b></li><li>b<b>b</b></li><li>c<b>c</b></li></ul>');
    assert.equal(untracked.empty, '<p>none</p>');

    action(async () => null, { id: 'untracked-rows/noop' });

    // The list's own edge, then two around each row that renders a component.
    assert.equal(edges(list()), 1 + 2 * ITEMS.length);
    assert.equal(edges(empty()), 1);
    assert.deepEqual(await renders(), untracked);
  });
});
