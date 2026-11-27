import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { installDOM, flushMicrotasks } from '../../test-utils/dom.js';
import { loadCompiled } from '../../test-utils/load-compiled.js';

assert.equal(process.env.NODE_ENV, 'production');
for (const entry of ['what-framework', 'what-framework/render']) {
  assert.match(import.meta.resolve(entry), /\/dist\/[^/]+\.min\.js$/);
}
const { document, cleanup } = installDOM();
after(cleanup);

const { h, mount, hydrate, signal, flushSync } = await import('what-framework');

const views = await loadCompiled(`
  export function Guard({ count }) {
    return <section>{count() > 0 && <b>{count()}</b>}</section>;
  }
  export function Tone({ active }) {
    return <p class={active() ? 'ready' : 'pending'}>status</p>;
  }
  export function Style({ active }) {
    return <p style={{ color: active() ? 'red' : 'blue' }}>status</p>;
  }
  export function Choice({ selected }) {
    return <select value={selected()}>
      <option value="a">A</option><option value="b">B</option>
    </select>;
  }
  export function Counter({ count }) {
    return <button onClick={() => count(n => n + 1)}>{count()}</button>;
  }
  export function List({ items }) {
    return <main>{items().map(id => <Row key={id} id={id} />)}</main>;
  }
  function Row({ id }) {
    return <><b>{id}</b><i>{id}</i></>;
  }
`, { production: true });

// Every module loads before the first test is registered: node:test before
// Node 23 runs the file's after() hooks once the tests registered so far end,
// so a test registered after a top-level await ran with the DOM removed.
const hydrating = await loadCompiled(`
  export function Card({ title, count }) {
    return <article><h2>{title}</h2><button onClick={() => count(n => n + 1)}>{count()}</button></article>;
  }
`, { production: true, pluginOptions: { hydratable: true } });

function render(t, View, props) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmount = mount(h(View, props), host);
  t.after(() => { unmount(); host.remove(); });
  return host.firstElementChild;
}

test('production guard preserves the mounted branch on truthy changes and removes it on flip', t => {
  const count = signal(1);
  const section = render(t, views.Guard, { count });
  const branch = section.querySelector('b');
  count(2);
  flushSync();
  assert.strictEqual(section.querySelector('b'), branch);
  assert.equal(branch.textContent, '2');
  count(0);
  flushSync();
  assert.equal(section.querySelector('b'), null);
});

test('production class binding follows a signal', t => {
  const active = signal(false);
  const status = render(t, views.Tone, { active });
  assert.equal(status.className, 'pending');
  active(true);
  flushSync();
  assert.equal(status.className, 'ready');
});

test('production style binding follows a signal', t => {
  const active = signal(false);
  const status = render(t, views.Style, { active });
  assert.equal(status.style.color, 'blue');
  active(true);
  flushSync();
  assert.equal(status.style.color, 'red');
});

test('production select binding changes the selected option', t => {
  const selected = signal('a');
  const select = render(t, views.Choice, { selected });
  assert.equal(select.value, 'a');
  selected('b');
  flushSync();
  assert.equal(select.selectedOptions[0].textContent, 'B');
});

test('production event binding triggers the expected reactive DOM update', async t => {
  const count = signal(0);
  const button = render(t, views.Counter, { count });
  button.click();
  assert.equal(count(), 1);
  await flushMicrotasks();
  assert.equal(button.textContent, '1');
});

test('production keyed fragment rows retain both elements when moved', t => {
  const items = signal(['a', 'b']);
  const list = render(t, views.List, { items });
  const [a1, a2, b1, b2] = list.querySelectorAll('b,i');
  assert.equal(list.textContent, 'aabb');
  items(['b', 'a']);
  flushSync();
  assert.equal(list.textContent, 'bbaa');
  const moved = [...list.querySelectorAll('b,i')];
  [b1, b2, a1, a2].forEach((node, index) => assert.strictEqual(moved[index], node));
});

function serverMarkup(t, html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  t.after(() => host.remove());
  return host;
}

test('production hydrate adopts matching server markup and returns its unmount', t => {
  const host = serverMarkup(t, '<article><h2>Hi</h2><button><!--$-->1<!--/$--></button></article>');
  const button = host.querySelector('button');
  const count = signal(1);
  const reports = [];
  const unmount = hydrate(h(hydrating.Card, { title: 'Hi', count }), host, { onHydrationError: (info) => reports.push(info) });
  assert.deepEqual(reports, []);
  assert.strictEqual(host.querySelector('button'), button);
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  flushSync();
  assert.equal(button.textContent, '2');
  unmount();
  assert.equal(host.childNodes.length, 0);
});

test('production hydrate reports a mismatch to onHydrationError, silently, and renders the client\'s part', t => {
  const host = serverMarkup(t, '<article><h3>Hi</h3><button><!--$-->1<!--/$--></button></article>');
  const reports = [];
  const printed = [];
  const { warn, error } = console;
  console.warn = (...args) => printed.push(args);
  console.error = (...args) => printed.push(args);
  let unmount;
  try {
    unmount = hydrate(h(hydrating.Card, { title: 'Hi', count: signal(1) }), host, { onHydrationError: (info) => reports.push(info) });
  } finally {
    console.warn = warn;
    console.error = error;
  }
  t.after(() => unmount());
  assert.deepEqual(reports.map((r) => [r.kind, r.expected, r.found, r.recovery]), [['tag', '<h2>', '<h3>', 'client-render']]);
  assert.deepEqual(printed, [], 'production prints nothing');
  assert.equal(host.querySelector('h3'), null);
  assert.equal(host.querySelector('h2').textContent, 'Hi');
});

// A keyless async value or resource is adopted by its owner path. A minified
// client renames every component, so in production the name the server
// recorded for that path (`owners`) is not compared: the bundle below
// hydrates with no request sent.
const STORE = `
  import { h, hydrate, computed, createResource, Suspense } from 'what-framework';
  export function makeApp(api) {
    function Products() {
      const products = computed(({ signal }) => api('products', signal));
      return h('ul', { id: 'products' }, () => products().map((p) => h('li', { key: p }, p)));
    }
    function Profile() {
      const [user] = createResource(() => api('user'));
      return h('p', { id: 'user' }, () => user());
    }
    return function App() {
      return h('main', null, h(Suspense, { fallback: h('i', { id: 'fb' }, 'loading') }, h(Products, {}), h(Profile, {})));
    };
  }
  export function start(host, api) {
    return hydrate(h(makeApp(api), {}), host);
  }
`;

test('a minified production client adopts keyless values and resources with no request', async (t) => {
  const { build } = await import('esbuild');
  const { renderDocument } = await import('what-server');
  const repo = new URL('../../', import.meta.url).pathname;
  const bundled = await build({
    stdin: { contents: STORE, resolveDir: repo, loader: 'js' },
    bundle: true,
    minify: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    conditions: ['production'],
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const code = bundled.outputFiles[0].text;
  assert.doesNotMatch(code, /Products|Profile/, 'precondition: the bundle renamed the components');
  const client = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  // The server renders the same source, unminified, as a server build would.
  const source = STORE.replace(`'what-framework'`, JSON.stringify(import.meta.resolve('what-framework')));
  const app = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

  const sent = [];
  const api = (name, signal) => {
    if (signal && signal.aborted) return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    sent.push(name);
    return Promise.resolve(name === 'products' ? ['pear', 'fig'] : 'Ada');
  };
  const html = await renderDocument({ default: app.makeApp(api) });
  assert.deepEqual(sent.sort(), ['products', 'user']);
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  const host = serverMarkup(t, body);
  const rows = [...host.querySelectorAll('li')];
  sent.length = 0;
  const unmount = client.start(host, api);
  t.after(() => unmount());
  await flushMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(sent, [], 'nothing was fetched again');
  assert.equal(host.querySelector('#fb'), null);
  assert.equal(host.querySelector('#user').textContent, 'Ada');
  assert.ok([...host.querySelectorAll('li')].every((li, i) => li === rows[i]), 'the server\'s rows are adopted');
});
