import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { document, cleanup } = installDOM();
after(cleanup);

const { flushSync, Fragment, h, mount, onCleanup, signal } = await import('what-framework');
const { mapArray } = await import('what-framework/render');
const { hydrate } = await import('what-core/render');
const { createDOM } = await import('../../core/src/dom.js');
const { renderToHydratableString } = await import('what-server');

const { List } = await loadCompiled(`
  export function List({ items, Row }) {
    return <For each={items} key={item => item.id}>{item => <Row item={item} />}</For>;
  }
`);

const records = (...ids) => ids.map(id => ({ id, label: id }));

const stages = [
  { items: records('a', 'b', 'c'), cleaned: [] },
  { items: records('a', 'd', 'b', 'c'), cleaned: [] },
  { items: records('a', 'd', 'c'), cleaned: ['b'] },
  { items: records('d', 'a', 'c'), cleaned: [] },
  { items: records('c', 'a', 'd'), cleaned: [] },
  { items: [{ id: 'c', label: 'updated' }, ...records('e', 'd')], cleaned: ['a'] },
  { items: [], cleaned: ['c', 'e', 'd'] },
  { items: records('b'), cleaned: [] },
  { items: [], cleaned: ['b'] },
];

for (const entry of ['compiled', 'h()', 'hydrated']) {
  test(entry + ' preserves multi-node keyed rows and delivers cleanup writes once', t => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    t.after(() => {
      mount(null, host)();
      host.remove();
    });

    const items = signal(stages[0].items);
    const cleaned = signal([]);
    const clicks = [];

    function Row({ item }) {
      const { id } = item();
      onCleanup(() => cleaned(previous => [...previous, id]));
      return h(Fragment, {},
        h('button', { 'data-row': id, onclick: () => clicks.push(id) }, () => item().label),
        h('small', { 'data-row': id }, id),
      );
    }

    const serverRows = () => items().flatMap(({ id, label }) => [
      h('button', { 'data-row': id }, label),
      h('small', { 'data-row': id }, id),
    ]);
    const compiledRows = () => List({ items, Row: ({ item }) => h(Row, { item }) });
    const keyedRuntimeRows = () => mapArray(items, item => createDOM(h(Row, { item })), {
      key: item => item.id,
    });
    const body = rows => h('section', {}, h('output', {}, () => cleaned().length), h('main', {}, rows));
    if (entry === 'hydrated') {
      host.innerHTML = renderToHydratableString(body(serverRows));
      const serverOutput = host.querySelector('output');
      hydrate(body(compiledRows()), host);
      assert.strictEqual(host.querySelector('output'), serverOutput);
    } else {
      mount(body(entry === 'compiled' ? compiledRows() : keyedRuntimeRows()), host);
    }

    const output = host.querySelector('output');
    let previous = new Map();
    const expectedCleanup = [];
    for (const { items: next, cleaned: removed } of stages) {
      items(next);
      flushSync();

      const visible = [...host.querySelectorAll('[data-row]')];
      const expected = next.flatMap(({ id, label }) => [
        ['BUTTON', id, label],
        ['SMALL', id, id],
      ]);
      assert.deepEqual(visible.map(node => [node.tagName, node.dataset.row, node.textContent]), expected);
      const current = new Map();
      for (const node of visible) {
        const key = node.tagName + node.dataset.row;
        if (previous.has(key)) assert.strictEqual(node, previous.get(key), key);
        current.set(key, node);
      }
      for (const id of removed) assert.equal(previous.get('BUTTON' + id).isConnected, false);
      previous = current;

      expectedCleanup.push(...removed);
      assert.deepEqual([...cleaned()].sort(), [...expectedCleanup].sort());
      assert.strictEqual(host.querySelector('output'), output);
      assert.equal(output.textContent, String(expectedCleanup.length));

      clicks.length = 0;
      for (const button of host.querySelectorAll('button')) button.click();
      assert.deepEqual(clicks, next.map(({ id }) => id));
    }
  });
}
