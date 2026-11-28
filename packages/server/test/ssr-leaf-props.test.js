// A component compiled JSX calls with no children and its props written as an
// object literal with no spread (ssr-runtime.js ssrLeaf; what-compiler's
// ssr-target.test.js holds the compiled side). That object is the call's own,
// so every renderer hands it to the component as it is on its first render,
// and a copy of it on any later render of the same vnode. The HTML is the
// HTML of the same call through ssrComponent.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { use } from 'what-core';
import { ssr, ssrComponent, ssrLeaf, ssrTemplate, ssrText } from '../src/ssr-runtime.js';
import { renderToString, renderToHydratableString, renderToStream, renderToStringAsync } from '../src/index.js';
import { collect, content } from './stream-helpers.js';

const RENDERERS = {
  string: (node) => renderToString(node),
  hydratable: (node) => content(renderToHydratableString(node)),
  stream: async (node) => content(await collect(renderToStream(node, { onError: () => {} }))),
};

const ITEM = ssrTemplate(['<b', '>', '</b>'], [['plain', 'title'], null]);

function recorder() {
  const seen = [];
  function Item(props) {
    seen.push(props);
    return ssr(ITEM, props.title, ssrText(props.label));
  }
  return { Item, seen };
}

describe('ssrLeaf', () => {
  it('hands the props object to the component itself, in every renderer', async () => {
    for (const [name, render] of Object.entries(RENDERERS)) {
      const { Item, seen } = recorder();
      const props = { title: 't', label: 'x' };
      const html = await render(ssrLeaf(Item, props, 3));
      assert.equal(seen.length, 1, name);
      assert.equal(seen[0], props, name);
      assert.equal(html, await render(ssrComponent(Item, { title: 't', label: 'x' }, [], 3)), name);
    }
  });

  it('hands a later render of the same vnode a copy of the props', async () => {
    const { Item, seen } = recorder();
    const props = { title: 't', label: 'x' };
    const vnode = ssrLeaf(Item, props, 3);
    const first = renderToString(vnode);
    const second = renderToString(vnode);
    assert.equal(first, second);
    assert.equal(seen[0], props);
    assert.notEqual(seen[1], props);
    assert.deepEqual(seen[1], props);
  });

  it('gives a call with no props an object of its own', () => {
    const seen = [];
    const Empty = (props) => {
      seen.push(props);
      return '';
    };
    renderToString(ssr(['<i>', '', '</i>'], ssrLeaf(Empty, null, 1), ssrLeaf(Empty, null, 2)));
    assert.equal(seen.length, 2);
    assert.deepEqual(seen[0], {});
    assert.notEqual(seen[0], seen[1]);
  });

  it('places its markup in a template as ssrComponent does, plain and hydratable', () => {
    const { Item } = recorder();
    const leaf = () => ssr(['<p>', '</p>'], ssrLeaf(Item, { title: 'a', label: '<y>' }, 7));
    const component = () => ssr(['<p>', '</p>'], ssrComponent(Item, { title: 'a', label: '<y>' }, [], 7));
    assert.equal(renderToString(leaf()), '<p><b title="a">&lt;y&gt;</b></p>');
    assert.equal(renderToString(leaf()), renderToString(component()));
    assert.equal(renderToHydratableString(leaf()), renderToHydratableString(component()));
  });

  it('renders a tag name held in a binding as ssrComponent does, its children prop included', () => {
    const leaf = renderToString(ssrLeaf('a', { href: '/x', children: 'go' }, 2));
    assert.equal(leaf, '<a href="/x">go</a>');
    assert.equal(leaf, renderToString(ssrComponent('a', { href: '/x', children: 'go' }, [], 2)));
  });

  it('retries a component that suspended with its props as the first attempt left them', async () => {
    const data = Promise.resolve('done');
    const seen = [];
    function Waits(props) {
      seen.push(props);
      return ssr(['<i>', '</i>'], ssrText(use(data) + props.n));
    }
    const props = { n: 1 };
    const { body } = await renderToStringAsync(ssr(['<p>', '</p>'], ssrLeaf(Waits, props, 4)));
    assert.match(body, /<i[^>]*>done1<\/i>/);
    assert.equal(seen[0], props);
  });
});
