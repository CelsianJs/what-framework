// Where plain-field rows meet the query cache and async values:
// a compiled keyed list whose rows write `{t.title}` as a plain field
// (_$field, and _$hfield in hydratable output) gets its items from a query(),
// server-rendered and streamed, and is reordered by a useOptimistic overlay
// whose action fails, so the overlay rolls back. Every step keeps the rows'
// elements and their field text nodes: the overlay moves rows, the rollback
// moves them back, and a refetch that renames an item writes its field in
// place.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');

const { hydrate, mount, startTransition, h, settled } = await import('what-framework');
const { __resetHydrationData } = await import('../src/hydration-data.js');
const { applyStreamedBoundaries } = await import('../src/index.js');
const server = await import('../../server/src/index.js');
const { collect } = await import('../../server/test/stream-helpers.js');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const source = (key) => `
  import { useOptimistic, Suspense } from 'what-framework';
  import { query } from 'what-framework/data';
  export const remote = { lists: [], calls: 0 };
  export const api = {};
  const fetchTodos = async () => { remote.calls++; await null; return remote.lists.at(-1); };
  export function List() {
    const todos = query(${JSON.stringify(key)}, fetchTodos);
    const [shown, reorder] = useOptimistic(todos, (list, order) => order.map((id) => list.find((t) => t.id === id)));
    api.reorder = reorder;
    api.todos = todos;
    return <Suspense fallback={<p>loading</p>}><ul>{shown().map((t) => <li key={t.id}><b>{t.title}</b></li>)}</ul></Suspense>;
  }
`;

const rowsOf = (app) => [...app.querySelectorAll('li')];
const textOf = (app) => rowsOf(app).map((li) => li.textContent).join(',');

async function check(app, mod) {
  const rows = rowsOf(app);
  const fields = rows.map((li) => li.querySelector('b').firstChild);
  const byTitle = new Map(rows.map((li) => [li.textContent, li]));

  // The overlay reorders at once; the action then fails, and the transition
  // commits without it.
  let fail;
  const failing = new Promise((_, reject) => { fail = reject; });
  const done = startTransition(async () => {
    mod.api.reorder([3, 1, 2]);
    await failing;
  });
  await tick();
  assert.equal(textOf(app), 'c,a,b', 'the overlay shows at once');
  assert.deepEqual(rowsOf(app), [byTitle.get('c'), byTitle.get('a'), byTitle.get('b')], 'rows move; none is built again');
  fail(new Error('offline'));
  await done.catch(() => {});
  await tick();
  assert.equal(textOf(app), 'a,b,c', 'rolled back');
  assert.deepEqual(rowsOf(app), rows);
  assert.deepEqual(rowsOf(app).map((li) => li.querySelector('b').firstChild), fields, 'the field text nodes are the same');

  // A refetch that renames an item and reorders writes the field in place.
  mod.remote.lists.push([{ id: 2, title: 'B' }, { id: 1, title: 'a' }, { id: 3, title: 'c' }]);
  await import('what-framework').then(({ refresh }) => refresh(mod.api.todos));
  await settled();
  assert.equal(textOf(app), 'B,a,c');
  assert.equal(rowsOf(app)[0], rows[1]);
  assert.equal(rowsOf(app)[0].querySelector('b').firstChild, fields[1], 'renamed in place');
}

const first = [{ id: 1, title: 'a' }, { id: 2, title: 'b' }, { id: 3, title: 'c' }];

describe('compiled plain-field rows from a query, reordered by an overlay that rolls back', () => {
  it('on the compiled client', async () => {
    const mod = await loadCompiled(source('rows:client'));
    mod.remote.lists.push(first);
    const app = document.getElementById('app');
    app.textContent = '';
    const stop = mount(h(mod.List, {}), app);
    await settled();
    assert.equal(textOf(app), 'a,b,c');
    assert.equal(app.querySelector('b').childNodes.length, 1, 'a plain field: one text node, no markers');
    try {
      await check(app, mod);
    } finally {
      stop();
    }
  });

  it('server-rendered, streamed and hydrated (_$hfield)', async () => {
    const key = 'rows:hydrated';
    const serverMod = await loadCompiled(source(key), { pluginOptions: { generate: 'ssr' } });
    const client = await loadCompiled(source(key), { pluginOptions: { hydratable: true } });
    serverMod.remote.lists.push(first);
    client.remote.lists.push(first);
    const html = await collect(server.renderToStream(h(serverMod.List, {})));
    assert.equal(serverMod.remote.calls, 1);
    const app = document.getElementById('app');
    app.innerHTML = html;
    __resetHydrationData();
    applyStreamedBoundaries();
    const reports = [];
    const before = rowsOf(app);
    const stop = hydrate(h(client.List, {}), app, { onHydrationError: (r) => reports.push(r) });
    await settled();
    try {
      assert.deepEqual(reports, []);
      assert.equal(client.remote.calls, 0, 'the client adopted the streamed list');
      assert.deepEqual(rowsOf(app), before, 'the server\'s rows are kept');
      assert.equal(textOf(app), 'a,b,c');
      await check(app, client);
    } finally {
      stop();
    }
  });
});
