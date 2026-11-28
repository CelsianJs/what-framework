// A compiled keyed list must survive SSR and hydration.
//
// `.map()` with a `key` prop, and `<For>`, lower to a mapArray INSERTER: a
// function taking (parent, marker), not a thunk returning a value. Hydration had
// no branch for it, so the generic reactive-child branch called it with no
// arguments, `parent.insertBefore` threw on undefined, and the exception escaped
// hydrate(). Not one list: the WHOLE PAGE stopped hydrating and stayed inert.
//
// The shape is the ordinary one for a compiled app. The server renders through
// runtime `h()` (plain arrays), the client bundle is compiled (mapArray
// inserters), and they meet at hydration. Nothing in the unit suite covered it
// because the compiled path is tested by mounting, never by hydrating, and the
// SSR tests never see compiled output.
//
// The server side had its own version of the same hole: renderToString hit the
// same bad call, swallowed the error, and emitted an EMPTY container. A compiled
// app's server HTML had no list rows in it at all.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');

const { signal, flushSync } = await import('../src/reactive.js');
const { h } = await import('../src/h.js');
const { hydrate, mapArray, insert, _rowKeyDigest } = await import('../src/render.js');
// The keys comment `html` carries for `keys`: each key's digest under the
// render's salt, which the comment writes first.
const keysComment = (html, ...keys) => {
  const salt = /<!--k:([^:>]+):/.exec(html)?.[1];
  return `<!--k:${salt}:${keys.map((key) => _rowKeyDigest(key, salt)).join('')}-->`;
};
const { renderToString, renderToHydratableString, renderToStream } = await import('what-server');

const root = () => document.getElementById('root');
const rows = () => [...root().querySelectorAll('li')].map((li) => li.textContent);

const ITEMS = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }, { id: 3, t: 'c' }];

/** What the compiler emits for a row: real DOM, built directly, no vnode. */
const compiledRow = (accessor) => {
  const li = document.createElement('li');
  insert(li, () => accessor().t);
  return li;
};

/** What the server renders: runtime h() over a plain array. */
const serverTree = (items) => h('ul', {}, () => items.map((it) => h('li', {}, it.t)));

/** What the compiled client hydrates with. */
const clientTree = (items) => h('ul', {}, mapArray(items, compiledRow, { key: (x) => x.id }));

describe('a compiled keyed list hydrates against server HTML', () => {
  it('does not throw, which would leave the whole page inert', () => {
    root().innerHTML = renderToString(serverTree(ITEMS));
    const items = signal(ITEMS);

    assert.doesNotThrow(() => {
      hydrate(clientTree(items), root());
      flushSync();
    });
  });

  it('renders every row exactly once', () => {
    root().innerHTML = renderToString(serverTree(ITEMS));
    const items = signal(ITEMS);
    hydrate(clientTree(items), root());
    flushSync();

    // The list builds its own rows and the server's are removed as unclaimed,
    // so the assertion is on the result, not on node identity. Reusing them
    // needs list boundary markers in the server HTML (tracked for 0.13.0).
    assert.deepEqual(rows(), ['a', 'b', 'c'], 'no duplicated or dropped rows');
  });

  it('stays keyed and reactive afterwards', () => {
    root().innerHTML = renderToString(serverTree(ITEMS));
    const items = signal(ITEMS);
    hydrate(clientTree(items), root());
    flushSync();

    items([{ id: 3, t: 'c' }, { id: 1, t: 'A' }, { id: 4, t: 'd' }]);
    flushSync();
    assert.deepEqual(rows(), ['c', 'A', 'd'], 'reorder, update and insert all apply');

    items([]);
    flushSync();
    assert.deepEqual(rows(), [], 'and it can clear');
  });

  it('leaves the surrounding markup alone', () => {
    root().innerHTML = renderToString(
      h('div', {}, h('h2', { 'data-title': '' }, 'Orders'), serverTree(ITEMS)),
    );
    const title = root().querySelector('[data-title]');
    const items = signal(ITEMS);

    hydrate(h('div', {}, h('h2', { 'data-title': '' }, 'Orders'), clientTree(items)), root());
    flushSync();

    assert.equal(root().querySelector('[data-title]'), title, 'the heading is reused, not rebuilt');
    assert.deepEqual(rows(), ['a', 'b', 'c']);
  });
});

describe('a keyed list renders its rows on every server path', () => {
  // renderToString swallowed the bad call and emitted an empty container, so a
  // compiled app served HTML with no rows in it: nothing for a crawler, nothing
  // painted before the bundle arrived.
  const tree = () => h('ul', {}, mapArray(signal(ITEMS), (it) => h('li', {}, () => it().t), { key: (x) => x.id }));

  it('renderToString', () => {
    assert.equal(renderToString(tree()), '<ul><li>a</li><li>b</li><li>c</li></ul>');
  });

  it('renderToHydratableString', () => {
    const html = renderToHydratableString(tree());
    assert.match(html, /<li>/, 'the rows are present');
    assert.equal((html.match(/<li>/g) || []).length, 3);
  });

  it('renderToStream', async () => {
    let html = '';
    for await (const chunk of renderToStream(tree(), {})) html += chunk;
    assert.equal((html.match(/<li>/g) || []).length, 3);
  });

  it('hands the mapFn the same item shape the client does', () => {
    // Keyed non-raw mode passes a signal ACCESSOR; every other mode passes the
    // raw item. Getting this wrong on the server produces HTML that differs
    // from the client's on every row.
    const keyed = h('ul', {}, mapArray(signal(ITEMS), (acc) => h('li', {}, () => acc().t), { key: (x) => x.id }));
    assert.equal(renderToString(keyed), '<ul><li>a</li><li>b</li><li>c</li></ul>');

    const raw = h('ul', {}, mapArray(signal(ITEMS), (item) => h('li', {}, item.t)));
    assert.equal(renderToString(raw), '<ul><li>a</li><li>b</li><li>c</li></ul>');
  });

  it('does not take the page down when a row throws', () => {
    // SSR is fail-soft here by design: one bad row must not blank the response.
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const bad = h('ul', {}, mapArray(signal(ITEMS), () => { throw new Error('row exploded'); }, { key: (x) => x.id }));
      assert.equal(renderToString(h('div', {}, bad, h('p', {}, 'after'))), '<div><ul></ul><p>after</p></div>');
    } finally {
      console.warn = originalWarn;
    }
  });
});

// The server writes a digest of each keyed row's key after the list's opening
// marker (<!--k:…-->), so hydrate() takes each server row as the row of its
// key, and the page carries no key itself.
// Server and client data that differ are a mismatch, reported; but a server
// row, and what the user typed into it before hydration, never becomes the
// row of another key.
const SOURCE = `
    import { signal } from 'what-framework';
    export function make(initial) {
      const rows = signal(initial);
      function View() {
        return <ul>{rows().map(row => <li key={row.id} data-row={row.id}>{row.label}<input /></li>)}</ul>;
      }
      return View;
    }
  `;
const server = await loadCompiled(SOURCE, { pluginOptions: { generate: 'ssr' } });
const client = await loadCompiled(SOURCE, { pluginOptions: { hydratable: true } });

describe('hydration never adopts a server row as the row of another key', () => {
  const ALICE_BOB = [{ id: 'a', label: 'Alice' }, { id: 'b', label: 'Bob' }];
  const typed = () => [...root().querySelectorAll('li')].map((li) => [li.dataset.row, li.textContent, li.querySelector('input').value]);

  it('the same rows in another order: each server row is adopted by its key, moved, and reported', () => {
    root().innerHTML = renderToHydratableString(h(server.make(ALICE_BOB)));
    assert.ok(root().innerHTML.includes(keysComment(root().innerHTML, 'a', 'b')), 'the server writes the keys\' digests');
    const alice = root().querySelector('[data-row=a] input');
    alice.value = 'draft for Alice';
    const reports = [];
    const stop = hydrate(h(client.make(ALICE_BOB.toReversed())), root(), { onHydrationError: (r) => reports.push(r) });
    assert.deepEqual(typed(), [['b', 'Bob', ''], ['a', 'Alice', 'draft for Alice']]);
    assert.equal(root().querySelector('[data-row=a] input'), alice, 'the server node stays with its key');
    assert.deepEqual(reports.map((r) => [r.kind, r.expected, r.found, r.recovery]), [['key', 'b,a', 'a,b', 'move']]);
    assert.ok(!root().innerHTML.includes('<!--k'), 'the keys are not left in the page');
    stop();
  });

  it('a server row whose key the client does not render: no server row is taken, the client builds the list', () => {
    root().innerHTML = renderToHydratableString(h(server.make([{ id: 'a', label: 'Alice' }, { id: 'c', label: 'Cy' }])));
    const serverRows = [...root().querySelectorAll('li')];
    serverRows[0].querySelector('input').value = 'draft for Alice';
    const reports = [];
    const stop = hydrate(h(client.make([{ id: 'c', label: 'Cy' }, { id: 'b', label: 'Bob' }])), root(), { onHydrationError: (r) => reports.push(r) });
    assert.deepEqual(typed(), [['c', 'Cy', ''], ['b', 'Bob', '']]);
    assert.ok([...root().querySelectorAll('li')].every((li) => !serverRows.includes(li)), 'every row was built by the client');
    assert.deepEqual(reports.map((r) => [r.kind, r.recovery]), [['key', 'client-render']]);
    stop();
  });

  it('the same keys in the same order adopt in place and report nothing', () => {
    root().innerHTML = renderToHydratableString(h(server.make(ALICE_BOB)));
    const nodes = [...root().querySelectorAll('li')];
    const reports = [];
    const stop = hydrate(h(client.make(ALICE_BOB)), root(), { onHydrationError: (r) => reports.push(r) });
    assert.deepEqual([...root().querySelectorAll('li')], nodes);
    assert.deepEqual(reports, []);
    stop();
  });

  it('h() keyed rows of a reactive child, from the string and the stream renderers', async () => {
    const tree = (items) => h('ul', {}, () => items.map((it) => h('li', { key: it.id }, it.label, h('input', {}))));
    for (const render of [renderToHydratableString, async (vnode) => { let html = ''; for await (const chunk of renderToStream(vnode, {})) html += chunk; return html; }]) {
      const html = await render(tree(ALICE_BOB));
      assert.ok(html.includes(keysComment(html, 'a', 'b')), html);
      root().innerHTML = html.includes('<ul>') ? html.slice(html.indexOf('<ul>'), html.indexOf('</ul>') + 5) : html;
      const alice = root().querySelectorAll('input')[0];
      alice.value = 'draft for Alice';
      const reports = [];
      const stop = hydrate(tree(ALICE_BOB.toReversed()), root(), { onHydrationError: (r) => reports.push(r) });
      assert.deepEqual([...root().querySelectorAll('li')].map((li) => [li.textContent, li.querySelector('input').value]), [['Bob', ''], ['Alice', 'draft for Alice']]);
      assert.equal(root().querySelectorAll('input')[1], alice);
      assert.deepEqual(reports.map((r) => [r.kind, r.recovery]), [['key', 'move']]);
      stop();
    }
  });

  it('a compiled keyed list rendered by the runtime renderer writes its keys too', () => {
    const html = renderToHydratableString(h('ul', {}, mapArray(ITEMS, (it) => h('li', {}, () => it().t), { key: (x) => x.id })));
    assert.ok(html.includes(keysComment(html, 1, 2, 3)), html);
    root().innerHTML = html;
    const reports = [];
    const stop = hydrate(clientTree([ITEMS[2], ITEMS[1], ITEMS[0]]), root(), { onHydrationError: (r) => reports.push(r) });
    assert.deepEqual(rows(), ['c', 'b', 'a']);
    assert.deepEqual([reports[0].kind, reports[0].recovery], ['key', 'move']);
    stop();
  });
});
