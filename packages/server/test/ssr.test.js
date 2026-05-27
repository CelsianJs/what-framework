/**
 * SSR tests for what-server: renderToString, renderToStream,
 * renderToHydratableString, text escaping, components, conditionals, lists.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import {
  renderToString,
  renderToStream,
  renderToHydratableString,
} from '../src/index.js';

// Helper: collect all chunks from an async iterator
async function collectStream(vnode) {
  const chunks = [];
  for await (const chunk of renderToStream(vnode)) {
    chunks.push(chunk);
  }
  return chunks.join('');
}

// =========================================================================
// renderToString — basic
// =========================================================================

describe('renderToString', () => {
  it('renders a simple element', () => {
    const html = renderToString(h('div', { class: 'box' }, 'Hello'));
    assert.equal(html, '<div class="box">Hello</div>');
  });

  it('renders nested elements', () => {
    const html = renderToString(
      h('div', null,
        h('h1', null, 'Title'),
        h('p', null, 'Body'),
      ),
    );
    assert.ok(html.includes('<h1>Title</h1>'));
    assert.ok(html.includes('<p>Body</p>'));
    assert.ok(html.startsWith('<div>'));
    assert.ok(html.endsWith('</div>'));
  });

  it('renders a component', () => {
    function Greeting(props) {
      return h('span', null, 'Hi ', props.name);
    }
    const html = renderToString(h(Greeting, { name: 'World' }));
    assert.ok(html.includes('Hi '));
    assert.ok(html.includes('World'));
  });

  it('renders nested components', () => {
    function Inner(props) {
      return h('em', null, props.text);
    }
    function Outer() {
      return h('div', null, h(Inner, { text: 'nested' }));
    }
    const html = renderToString(h(Outer, {}));
    assert.ok(html.includes('<em>nested</em>'));
    assert.ok(html.startsWith('<div>'));
  });

  it('escapes text content (XSS prevention)', () => {
    const html = renderToString(h('div', null, '<script>alert(1)</script>'));
    assert.ok(!html.includes('<script>'), 'should escape script tags');
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('escapes attribute values', () => {
    const html = renderToString(h('div', { title: '"><script>x</script>' }));
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&quot;'));
  });

  it('renders null/false/true children as empty', () => {
    assert.equal(renderToString(null), '');
    assert.equal(renderToString(false), '');
    assert.equal(renderToString(true), '');
  });

  it('renders arrays of children', () => {
    const items = ['A', 'B', 'C'];
    const html = renderToString(
      h('ul', null, ...items.map(t => h('li', null, t))),
    );
    assert.ok(html.includes('<li>A</li>'));
    assert.ok(html.includes('<li>B</li>'));
    assert.ok(html.includes('<li>C</li>'));
  });

  it('renders void elements without closing tag', () => {
    const html = renderToString(h('br', null));
    assert.equal(html, '<br>');
  });

  it('renders conditional (Show-like pattern)', () => {
    function Show(props) {
      return props.when ? props.children : null;
    }
    const htmlTrue = renderToString(h(Show, { when: true }, h('p', null, 'Visible')));
    assert.ok(htmlTrue.includes('<p>Visible</p>'));

    const htmlFalse = renderToString(h(Show, { when: false }, h('p', null, 'Hidden')));
    assert.equal(htmlFalse, '');
  });

  it('renders reactive function children by calling them', () => {
    const html = renderToString(h('span', null, () => 'dynamic'));
    assert.ok(html.includes('dynamic'));
  });

  it('handles style objects', () => {
    const html = renderToString(h('div', { style: { color: 'red', fontSize: '14px' } }));
    assert.ok(html.includes('style="'));
    assert.ok(html.includes('color:red'));
    assert.ok(html.includes('font-size:14px'));
  });

  it('skips event handlers', () => {
    const html = renderToString(h('button', { onClick: () => {} }, 'Click'));
    assert.ok(!html.includes('onClick'));
    assert.ok(!html.includes('onclick'));
    assert.ok(html.includes('Click'));
  });

  it('renders boolean attributes correctly', () => {
    const html = renderToString(h('input', { disabled: true, type: 'text' }));
    assert.ok(html.includes('disabled'));
    assert.ok(html.includes('type="text"'));
  });

  it('skips false/null attributes', () => {
    const html = renderToString(h('input', { disabled: false, hidden: null }));
    assert.ok(!html.includes('disabled'));
    assert.ok(!html.includes('hidden'));
  });
});

// =========================================================================
// renderToStream
// =========================================================================

describe('renderToStream', () => {
  it('streams a simple element', async () => {
    const html = await collectStream(h('div', null, 'Hello'));
    assert.ok(html.includes('<div>'));
    assert.ok(html.includes('Hello'));
    assert.ok(html.includes('</div>'));
  });

  it('streams nested components', async () => {
    function Child() {
      return h('span', null, 'child');
    }
    const html = await collectStream(h('div', null, h(Child, {})));
    assert.ok(html.includes('<span>child</span>'));
  });

  it('streams arrays', async () => {
    const html = await collectStream([
      h('p', null, 'A'),
      h('p', null, 'B'),
    ]);
    assert.ok(html.includes('<p>A</p>'));
    assert.ok(html.includes('<p>B</p>'));
  });

  it('streams null/false as empty', async () => {
    const chunks = [];
    for await (const chunk of renderToStream(null)) {
      chunks.push(chunk);
    }
    assert.equal(chunks.length, 0);
  });
});

// =========================================================================
// renderToHydratableString
// =========================================================================

describe('renderToHydratableString', () => {
  it('injects data-hk attribute on component root', () => {
    function MyComp() {
      return h('div', null, 'hydrated');
    }
    const html = renderToHydratableString(h(MyComp, {}));
    assert.ok(html.includes('data-hk='), `expected data-hk, got: ${html}`);
    assert.ok(html.includes('hydrated'));
  });

  it('wraps reactive children in comment markers', () => {
    const html = renderToHydratableString(h('div', null, () => 'reactive'));
    assert.ok(html.includes('<!--$-->'), 'should have $ marker');
    assert.ok(html.includes('<!--/$-->'), 'should have /$ marker');
    assert.ok(html.includes('reactive'));
  });

  it('wraps arrays in list markers', () => {
    const html = renderToHydratableString([h('p', null, 'A'), h('p', null, 'B')]);
    assert.ok(html.includes('<!--[]-->'));
    assert.ok(html.includes('<!--/[]-->'));
  });
});
