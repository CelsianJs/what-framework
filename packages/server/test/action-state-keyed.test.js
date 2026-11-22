// A table whose rows each render their own edit form, while a teammate
// changes the table between the render and the post:
//
//   <For each={records} key={(r) => r.id}>{(item) => <Row item={item} />}</For>
//   function Editor({ record }) {
//     const [state, save] = useActionState(rename, null);
//     return <Form action={save}>…</Form>;
//   }
//
// A form posted without JavaScript comes back to the useActionState its key
// names. Inside a keyed list that identity follows the row's key, as React's
// key path does, so a record added above and another deleted between the
// page and the post leave the result on the record that was posted, in every
// server renderer and in the hydration of the page that comes back. Before,
// the key was the owner path, which counts rows by position: the result,
// the raw title and the whole draft landed on the row that took the posted
// row's place.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { h, For, useActionState, useLoaderData, hydrate } = await import('what-core');
const { __resetHydrationData } = await import('what-core/internal');
const { Form, action, createRequestHandler } = await import('../src/index.js');
const { Island } = await import('../src/islands.js');

let records = [];
const initial = () => [
  { id: 'alpha-record-1', title: 'Alpha' },
  { id: 'bravo-record-2', title: 'Bravo' },
  { id: 'charlie-record-3', title: 'Charlie' },
];
beforeEach(() => {
  records = initial();
});

const rename = action(async (_previous, fields) => {
  const title = String(fields.title ?? '');
  if (title.trim().length < 3) return { error: 'Title needs three characters', fields: { title, notes: fields.notes } };
  const record = records.find((r) => r.id === fields.id);
  if (record) record.title = title;
  return { saved: true };
}, { id: 'records/rename' });

function Editor({ record }) {
  const [state, save] = useActionState(rename, null);
  return h(Form, { action: save, 'data-form': record.id },
    h('input', { type: 'hidden', name: 'id', value: record.id }),
    h('input', { name: 'title', defaultValue: () => state()?.fields?.title ?? record.title }),
    h('textarea', { name: 'notes', defaultValue: () => state()?.fields?.notes ?? '' }),
    () => (state()?.error ? h('p', { role: 'alert' }, state().error) : null),
    h('button', { type: 'submit' }, 'Save'));
}

function Row({ item }) {
  const record = item();
  return h('tr', { 'data-id': record.id }, h('th', null, record.title), h('td', null, h(Editor, { record })));
}

// The admin table: <For key>, an accessor per row.
function ForTable() {
  const { records } = useLoaderData();
  return h('table', null, h('tbody', null,
    h(For, { each: records, key: (r) => r.id, children: (item) => h(Row, { item }) })));
}

// The same table written as a `.map()` with a `key` over the loader data.
function MapTable() {
  const { records } = useLoaderData();
  return h('table', null, h('tbody', null,
    ...records.map((record) => h('tr', { key: record.id, 'data-id': record.id },
      h('th', null, record.title), h('td', null, h(Editor, { record }))))));
}

const loader = () => ({ records: records.map((r) => ({ ...r })) });
const origin = 'http://admin.test';

function handlerFor(component, page) {
  return createRequestHandler({ routes: [{ path: '/admin', component, loader, page }] });
}

function post(handle, body) {
  return handle(new Request(`${origin}/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' },
    body: new URLSearchParams(body).toString(),
  }));
}

// Each form of a page: its record, its key, its alerts, its title and notes.
function forms(html) {
  return [...html.matchAll(/<form[^>]*data-form="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)].map(([, id, inner]) => ({
    id,
    key: (/name="_actionKey" value="([^"]*)"/.exec(inner) || [])[1],
    alerts: [...inner.matchAll(/role="alert">([^<]*)</g)].map((m) => m[1]),
    title: (/<input name="title" value="([^"]*)"/.exec(inner) || [])[1],
    notes: (/<textarea name="notes">\n?([^<]*)<\/textarea>/.exec(inner) || [])[1],
  }));
}

async function pageOf(handle) {
  return forms(await (await handle(new Request(`${origin}/admin`))).text());
}

// A teammate adds a record above and deletes the last one between the page
// and the post, so the posted row moves down, then the form of `id` (as the
// page showed it) posts a title too short to save, with a draft.
async function concurrentInvalidRename(handle, id) {
  const shown = await pageOf(handle);
  const form = shown.find((f) => f.id === id);
  records.unshift({ id: 'aardvark-record-0', title: 'Aardvark' });
  records.splice(records.findIndex((r) => r.id === 'charlie-record-3'), 1);
  const notes = 'A draft paragraph. '.repeat(480);
  const res = await post(handle, { _action: 'records/rename', _state: 'null', _actionKey: form.key, id, title: 'x', notes });
  assert.equal(res.status, 200);
  const html = await res.text();
  return { shown, back: forms(html), notes, html };
}

const RENDERERS = [
  ['the stream', { mode: 'server' }],
  ['the buffered render', { mode: 'server', stream: false }],
];

describe('a no-JS post from a keyed row, after the list changed', () => {
  for (const [renderer, page] of RENDERERS) {
    for (const [shape, component] of [['<For key>', ForTable], ['.map() with a key', MapTable]]) {
      it(`comes back to the posted record's row: ${shape}, ${renderer}`, async () => {
        const handle = handlerFor(component, page);
        const { shown, back, notes } = await concurrentInvalidRename(handle, 'bravo-record-2');
        assert.deepEqual(shown.map((f) => f.id), ['alpha-record-1', 'bravo-record-2', 'charlie-record-3']);
        assert.deepEqual(back.map((f) => f.id), ['aardvark-record-0', 'alpha-record-1', 'bravo-record-2']);
        assert.deepEqual(back.map((f) => f.alerts), [[], [], ['Title needs three characters']]);
        assert.deepEqual(back.map((f) => f.title), ['Aardvark', 'Alpha', 'x']);
        assert.deepEqual(back.map((f) => f.notes.length), [0, 0, notes.length]);
        // The page that came back is posted from in turn, after the row moved up.
        records.splice(0, 1);
        const again = forms(await (await post(handle, { _action: 'records/rename', _state: 'null', _actionKey: back[2].key, id: 'bravo-record-2', title: 'y' })).text());
        assert.deepEqual(again.map((f) => [f.id, f.alerts.length]), [['alpha-record-1', 0], ['bravo-record-2', 1]]);
      });
    }
  }

  it('carries no record key in the page: each key is a digest under the render\'s salt', async () => {
    const handle = handlerFor(ForTable, { mode: 'server' });
    const first = await pageOf(handle);
    const second = await pageOf(handle);
    for (const form of first) {
      assert.doesNotMatch(form.key, /record/, form.key);
      assert.match(form.key, /^[0-9A-Za-z_.]{11}\//);
    }
    assert.notEqual(first[0].key, second[0].key, 'another render, another salt');
    assert.equal(new Set(first.map((f) => f.key)).size, 3);
  });

  it('keeps two lists of the same records apart, and a row nested in another', async () => {
    function Pinned({ records, pinned }) {
      return h('section', null,
        h('ul', { class: 'pinned' }, h(For, { each: records.filter((r) => pinned.includes(r.id)), key: (r) => r.id,
          children: (item) => h('li', null, h(Editor, { record: item() })) })),
        h('ul', { class: 'all' }, h(For, { each: records, key: (r) => r.id,
          children: (item) => h('li', null, h(Editor, { record: item() }),
            h('ol', null, ...['a', 'b'].map((part) => h('li', { key: part }, h(Editor, { record: { id: `${item().id}/${part}`, title: part } }))))) })));
    }
    let pinned = ['charlie-record-3'];
    const handle = handlerFor(() => h(Pinned, { records: useLoaderData().records, pinned }), { mode: 'server' });
    const shown = await pageOf(handle);
    assert.equal(shown.length, 10);
    const all = shown.filter((f) => f.id === 'bravo-record-2')[0];
    const nested = shown.find((f) => f.id === 'bravo-record-2/b');
    pinned = ['bravo-record-2', 'charlie-record-3'];
    records.unshift({ id: 'aardvark-record-0', title: 'Aardvark' });
    const back = forms(await (await post(handle, { _action: 'records/rename', _state: 'null', _actionKey: all.key, id: all.id, title: 'x' })).text());
    // Pinned: bravo, charlie. All: aardvark, alpha, bravo, charlie, each with two nested forms.
    const alerted = back.map((f, i) => [i, f.id, f.alerts.length]).filter(([, , n]) => n > 0);
    assert.deepEqual(alerted, [[2 + 2 * 3, 'bravo-record-2', 1]], 'the All list\'s row, not the pinned one');
    const nestedBack = forms(await (await post(handle, { _action: 'records/rename', _state: 'null', _actionKey: nested.key, id: nested.id, title: 'x' })).text());
    assert.deepEqual(nestedBack.filter((f) => f.alerts.length > 0).map((f) => f.id), ['bravo-record-2/b']);
  });

  it('counts a row whose key is not a string or a number by position', async () => {
    function ObjectKeys() {
      const { records } = useLoaderData();
      return h('ul', null, ...records.map((record) => h('li', { key: { id: record.id } }, h(Editor, { record }))));
    }
    const handle = handlerFor(ObjectKeys, { mode: 'server' });
    const shown = await pageOf(handle);
    assert.ok(shown.every((f) => /^[0-9A-Za-z]+:0$/.test(f.key)), shown.map((f) => f.key).join());
    const back = forms(await (await post(handle, { _action: 'records/rename', _state: 'null', _actionKey: shown[1].key, id: shown[1].id, title: 'x' })).text());
    assert.deepEqual(back.map((f) => f.alerts.length), [0, 1, 0]);
  });

  it('comes back to the posted row in compiled JSX, buffered and streamed', async () => {
    const source = `
      import { useActionState, useLoaderData } from 'what-framework';
      import { Form } from 'what-framework/server';
      import { rename } from ${JSON.stringify(import.meta.resolve('./fixtures/keyed-rename.js'))};
      function Editor({ record }) {
        const [state, save] = useActionState(rename, null);
        return <Form action={save} data-form={record.id}>
          <input type="hidden" name="id" value={record.id} />
          <input name="title" defaultValue={state()?.fields?.title ?? record.title} />
          {state()?.error ? <p role="alert">{state().error}</p> : null}
        </Form>;
      }
      export function Table() {
        const data = useLoaderData();
        return <table><tbody>{data.records.map((record) => <tr key={record.id}><td><Editor record={record} /></td></tr>)}</tbody></table>;
      }`;
    const { Table } = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
    const { setRecords } = await import('./fixtures/keyed-rename.js');
    for (const [, page] of RENDERERS) {
      records = initial();
      setRecords(records);
      const handle = handlerFor(Table, page);
      const shown = await pageOf(handle);
      records.unshift({ id: 'aardvark-record-0', title: 'Aardvark' });
      records.pop();
      const back = forms(await (await post(handle, { _action: 'records/compiled-rename', _state: 'null', _actionKey: shown[1].key, id: 'bravo-record-2', title: 'x' })).text());
      assert.deepEqual(back.map((f) => [f.id, f.alerts.length]), [['aardvark-record-0', 0], ['alpha-record-1', 0], ['bravo-record-2', 1]]);
    }
    assert.ok(compileJSX(source, { pluginOptions: { generate: 'ssr' } }).includes('_$ssrList'), 'the server target renders the rows with ssrList');
  });
});

describe('the page a keyed row\'s post comes back with, hydrated', () => {
  for (const [shape, component] of [['<For key>', ForTable], ['.map() with a key', MapTable]]) {
    it(`starts each form from its own state, on the posted record's row: ${shape}`, async () => {
      const handle = handlerFor(component, { mode: 'server', stream: false });
      const { back, html } = await concurrentInvalidRename(handle, 'bravo-record-2');
      assert.deepEqual(back.map((f) => f.alerts.length), [0, 0, 1]);
      const env = installDOM();
      try {
        __resetHydrationData();
        document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
        const keys = [...document.querySelectorAll('[name=_actionKey]')].map((el) => el.value);
        const titles = [...document.querySelectorAll('[name=title]')];
        const problems = [];
        const stop = hydrate(h(component, { loaderData: loader() }), document.body, { onHydrationError: (info) => problems.push(info.kind) });
        assert.deepEqual(problems, []);
        assert.deepEqual([...document.querySelectorAll('[name=title]')], titles, 'every field adopted');
        assert.deepEqual(titles.map((el) => el.value), ['Aardvark', 'Alpha', 'x']);
        assert.deepEqual([...document.querySelectorAll('[role=alert]')].map((el) => el.closest('form').dataset.form), ['bravo-record-2']);
        assert.deepEqual([...document.querySelectorAll('[name=_actionKey]')].map((el) => el.value), keys, 'the client computes the server\'s keys');
        stop();
      } finally {
        env.cleanup();
      }
    });
  }
});

describe('an island in a keyed row', () => {
  it('hydrates into the server\'s keys: its root starts from the row the server wrote', async () => {
    function Islands() {
      const { records } = useLoaderData();
      return h('ul', null, h(For, { each: records, key: (r) => r.id,
        children: (item) => h('li', null, h(Island, { name: 'row-editor', props: { record: item() } }, h(Editor, { record: item() }))) }));
    }
    const handle = handlerFor(Islands, { mode: 'server', stream: false });
    const { back, html } = await concurrentInvalidRename(handle, 'bravo-record-2');
    assert.deepEqual(back.map((f) => [f.id, f.alerts.length]), [['aardvark-record-0', 0], ['alpha-record-1', 0], ['bravo-record-2', 1]]);
    const rows = [...html.matchAll(/data-what-row="([^"]*)"/g)].map((m) => m[1]);
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => !/record/.test(row)), 'digests, no key');
    const env = installDOM();
    try {
      __resetHydrationData();
      document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
      const host = document.querySelectorAll('[data-island]')[2];
      const key = host.querySelector('[name=_actionKey]').value;
      const problems = [];
      const stop = hydrate(h(Editor, { record: { id: 'bravo-record-2', title: 'Bravo' } }), host, { onHydrationError: (info) => problems.push(info.kind) });
      assert.deepEqual(problems, []);
      assert.equal(host.querySelector('[name=_actionKey]').value, key);
      assert.equal(host.querySelector('[role=alert]').textContent, 'Title needs three characters');
      assert.equal(host.querySelector('[name=title]').value, 'x');
      stop();
    } finally {
      env.cleanup();
    }
  });
});

// A keyed list's place is where it is written: the slots from the component's
// output (or the row around it) down to it, and the number what-compiler gives
// a list it lowers. Before, a list took the next number among the component's
// lists when its first row was entered, so a list before the posted one that
// was empty in one of the two renders (a Pinned list the record joins, a
// section shown while it has rows) gave the posted list another number, and
// the result went to no form, or to the same record's form in the other list.
describe('a keyed list before the posted one, empty in one of the two renders', () => {
  let pinned = [];
  const pinnedLoader = () => ({ records: records.map((r) => ({ ...r })), pinned: records.filter((r) => pinned.includes(r.id)).map((r) => ({ ...r, id: `pinned/${r.id}` })) });
  const row = (record) => h('li', { key: record.id.replace('pinned/', '') }, h(Editor, { record }));
  const SHAPES = [
    ['.map() lists, an array child each', () => {
      const data = useLoaderData();
      return h('main', null, h('ul', null, data.pinned.map(row)), h('ul', null, data.records.map(row)));
    }],
    ['<For key> lists', () => {
      const data = useLoaderData();
      const list = (each) => h('ul', null, h(For, { each, key: (r) => r.id.replace('pinned/', ''), children: (item) => h('li', null, h(Editor, { record: item() })) }));
      return h('main', null, list(data.pinned), list(data.records));
    }],
    ['a section shown while it has rows, then rows spread into a list', () => {
      const data = useLoaderData();
      return h('main', null, data.pinned.length > 0 ? h('ul', null, ...data.pinned.map(row)) : h('p', null, 'Nothing pinned'), h('ul', null, ...data.records.map(row)));
    }],
  ];
  const CHANGES = [['fills', [], ['bravo-record-2']], ['empties', ['bravo-record-2'], []]];

  for (const [renderer, page] of RENDERERS) {
    for (const [shape, component] of SHAPES) {
      for (const [change, before, after] of CHANGES) {
        it(`the result comes back to the posted list's row when the earlier list ${change}: ${shape}, ${renderer}`, async () => {
          pinned = before;
          const handle = createRequestHandler({ routes: [{ path: '/admin', component, loader: pinnedLoader, page }] });
          const shown = await pageOf(handle);
          const form = shown.find((f) => f.id === 'bravo-record-2');
          pinned = after;
          const back = forms(await (await post(handle, { _action: 'records/rename', _state: 'null', _actionKey: form.key, id: form.id, title: 'x' })).text());
          assert.deepEqual(back.filter((f) => f.alerts.length > 0).map((f) => f.id), ['bravo-record-2']);
        });
      }
    }
  }

  it('the page that comes back hydrates into the server\'s keys, the earlier list filled', async () => {
    const [, component] = SHAPES[0];
    pinned = [];
    const handle = createRequestHandler({ routes: [{ path: '/admin', component, loader: pinnedLoader, page: { mode: 'server', stream: false } }] });
    const form = (await pageOf(handle)).find((f) => f.id === 'bravo-record-2');
    pinned = ['bravo-record-2'];
    const html = await (await post(handle, { _action: 'records/rename', _state: 'null', _actionKey: form.key, id: form.id, title: 'x' })).text();
    const env = installDOM();
    try {
      __resetHydrationData();
      document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
      const keys = [...document.querySelectorAll('[name=_actionKey]')].map((el) => el.value);
      const problems = [];
      const stop = hydrate(h(component, { loaderData: pinnedLoader() }), document.body, { onHydrationError: (info) => problems.push(info.kind) });
      assert.deepEqual(problems, []);
      assert.deepEqual([...document.querySelectorAll('[name=_actionKey]')].map((el) => el.value), keys);
      assert.deepEqual([...document.querySelectorAll('[role=alert]')].map((el) => el.closest('form').dataset.form), ['bravo-record-2']);
      stop();
    } finally {
      env.cleanup();
    }
  });

  it('in compiled JSX: two .map() lists, two <For key> lists and a section shown while it has rows, hydrated into the server\'s keys', async () => {
    const editor = `
      function Editor({ record }) {
        const [state, save] = useActionState(rename, null);
        return <Form action={save} data-form={record.id}>
          <input type="hidden" name="id" value={record.id} />
          <input name="title" defaultValue={state()?.fields?.title ?? record.title} />
          {state()?.error ? <p role="alert">{state().error}</p> : null}
        </Form>;
      }`;
    const imports = (at) => `
      import { For, useActionState, useLoaderData } from 'what-framework';
      import { Form } from ${JSON.stringify(at('../src/index.js'))};
      import { rename } from ${JSON.stringify(at('./fixtures/keyed-rename.js'))};`;
    const pages = {
      maps: `export function Page() { const d = useLoaderData(); return <main><ul>{d.pinned.map((r) => <li key={r.key}><Editor record={r} /></li>)}</ul><ul>{d.records.map((r) => <li key={r.key}><Editor record={r} /></li>)}</ul></main>; }`,
      fors: `export function Page() { const d = useLoaderData(); return <main><ul><For each={d.pinned} key={(r) => r.key}>{(r) => <li><Editor record={r()} /></li>}</For></ul><ul><For each={d.records} key={(r) => r.key}>{(r) => <li><Editor record={r()} /></li>}</For></ul></main>; }`,
      section: `export function Page() { const d = useLoaderData(); return <main>{d.pinned.length > 0 && <ul>{d.pinned.map((r) => <li key={r.key}><Editor record={r} /></li>)}</ul>}<ul>{d.records.map((r) => <li key={r.key}><Editor record={r} /></li>)}</ul></main>; }`,
    };
    const { setRecords } = await import('./fixtures/keyed-rename.js');
    const keyedLoader = () => ({ records: records.map((r) => ({ ...r, key: r.id })), pinned: records.filter((r) => pinned.includes(r.id)).map((r) => ({ ...r, id: `pinned/${r.id}`, key: r.id })) });
    for (const [shape, body] of Object.entries(pages)) {
      const server = await loadCompiled(imports((p) => import.meta.resolve(p)) + editor + body, { pluginOptions: { generate: 'ssr' } });
      const client = await loadCompiled(imports((p) => import.meta.resolve(p)) + editor + body, { pluginOptions: { hydratable: true } });
      for (const [renderer, page] of RENDERERS) {
        for (const [, before, after] of CHANGES) {
          records = initial();
          setRecords(records);
          pinned = before;
          const handle = createRequestHandler({ routes: [{ path: '/admin', component: server.Page, loader: keyedLoader, page }] });
          const form = (await pageOf(handle)).find((f) => f.id === 'bravo-record-2');
          pinned = after;
          const html = await (await post(handle, { _action: 'records/compiled-rename', _state: 'null', _actionKey: form.key, id: form.id, title: 'x' })).text();
          assert.deepEqual(forms(html).filter((f) => f.alerts.length > 0).map((f) => f.id), ['bravo-record-2'], `${shape}, ${renderer}, ${JSON.stringify(after)}`);
          if (page.stream === false) {
            const env = installDOM();
            try {
              __resetHydrationData();
              document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
              const keys = [...document.querySelectorAll('[name=_actionKey]')].map((el) => el.value);
              const problems = [];
              const stop = hydrate(h(client.Page, { loaderData: keyedLoader() }), document.body, { onHydrationError: (info) => problems.push(info.kind) });
              assert.deepEqual(problems, [], shape);
              assert.deepEqual([...document.querySelectorAll('[name=_actionKey]')].map((el) => el.value), keys, `${shape}: the client computes the server's keys`);
              stop();
            } finally {
              env.cleanup();
            }
          }
        }
      }
    }
  });
});
