// <Suspense> on async values (docs/ASYNC.md): the fallback stands until the
// content has first shown, then never again.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { withResolvers } from '../../../test-utils/with-resolvers.js';

let env;
let W;
before(async () => {
  env = installDOM();
  W = await import('../src/index.js');
});
after(() => env.cleanup());

const drain = () => new Promise((resolve) => setImmediate(resolve));

function deferreds() {
  const map = new Map();
  const get = (name) => {
    if (!map.has(name)) map.set(name, withResolvers());
    return map.get(name);
  };
  return { fetch: (name) => get(name).promise, answer: (name, value = name) => get(name).resolve(value), started: () => [...map.keys()] };
}

describe('<Suspense> on async values', () => {
  it('shows the fallback until every binding under it has its value, then reveals all at once', async () => {
    const { computed, h, mount, Suspense } = W;
    const api = deferreds();
    const host = document.createElement('div');
    function Profile() {
      const user = computed(() => api.fetch('user'));
      const posts = computed(() => api.fetch('posts'));
      return h('section', null, h('h1', null, () => user()), h('ul', null, () => posts()));
    }
    const stop = mount(h(Suspense, { fallback: h('p', null, 'loading') }, h(Profile)), host);
    assert.equal(host.textContent, 'loading');
    api.answer('user', 'Ada');
    await drain();
    assert.equal(host.textContent, 'loading', 'one of two values is not a reveal');
    api.answer('posts', 'p1');
    await drain();
    assert.equal(host.textContent, 'Adap1');
    stop();
  });

  it('after the reveal a refresh keeps the children mounted, and their DOM state', async () => {
    const { computed, refresh, h, mount, Suspense } = W;
    let n = 0;
    const flights = [];
    const users = computed(() => new Promise((resolve) => flights.push(resolve)).then((v) => v + ':' + n++));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const stop = mount(h(Suspense, { fallback: h('p', null, 'loading') },
      h('input', { id: 'q' }),
      h('span', null, () => users())), host);
    flights[0]('a');
    await drain();
    const input = host.querySelector('#q');
    input.value = 'typed';
    input.focus();
    const refreshed = refresh(users);
    await drain();
    assert.equal(host.querySelector('p'), null, 'no fallback on a refresh');
    assert.equal(host.querySelector('span').textContent, 'a:0', 'the old value stays while the new one is fetched');
    flights[1]('b');
    await refreshed;
    await drain();
    assert.equal(host.querySelector('span').textContent, 'b:1');
    assert.equal(host.querySelector('#q'), input);
    assert.equal(input.value, 'typed');
    assert.equal(document.activeElement, input);
    stop();
    host.remove();
  });

  it('catches waiting bindings in rows created later; a revealed boundary does not show its fallback again', async () => {
    const { signal, computed, h, mount, Suspense, For } = W;
    const api = deferreds();
    const ids = signal([1]);
    function Row(props) {
      const name = computed(() => api.fetch('row' + props.id));
      return h('li', null, () => name());
    }
    const host = document.createElement('div');
    const stop = mount(h(Suspense, { fallback: h('p', null, 'loading') },
      h('ul', null, h(For, { each: ids }, (id) => h(Row, { id })))), host);
    assert.equal(host.textContent, 'loading');
    api.answer('row1', 'one');
    await drain();
    assert.equal(host.textContent, 'one');
    ids([1, 2]);
    await drain();
    assert.equal(host.textContent, 'one', 'the new row shows nothing yet, and the fallback stays away');
    api.answer('row2', 'two');
    await drain();
    assert.equal(host.textContent, 'onetwo');
    stop();
  });

  it('after the reveal, a component that suspends on a chunk brings the fallback back, with the children kept mounted', async () => {
    const { signal, h, mount, Suspense, lazy, onMount } = W;
    const chunk = withResolvers();
    const Settings = lazy(() => chunk.promise);
    const open = signal(false);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const stop = mount(h(Suspense, { fallback: h('p', null, 'loading') },
      h('input', null),
      () => (open() ? h(Settings) : null)), host);
    const input = host.querySelector('input');
    input.value = 'kept';
    open(true);
    await drain();
    assert.equal(host.textContent, 'loading', 'the fallback shows while the chunk loads');
    assert.equal(host.querySelector('input'), null);
    let attached = null;
    chunk.resolve({
      default: function SettingsPanel() {
        onMount(() => { attached = document.body.contains(host.querySelector('h2')); });
        return h('h2', null, 'settings');
      },
    });
    await drain();
    await drain();
    assert.equal(host.querySelector('input'), input, 'the children were kept mounted');
    assert.equal(input.value, 'kept', 'with their DOM state');
    assert.equal(host.querySelector('h2').textContent, 'settings');
    assert.equal(attached, true, 'onMount ran once the content showed again, on attached DOM');
    stop();
    host.remove();
  });

  it('nested boundaries reveal on their own; the outer does not wait for the inner', async () => {
    const { computed, h, mount, Suspense } = W;
    const api = deferreds();
    const outer = computed(() => api.fetch('outer'));
    const inner = computed(() => api.fetch('inner'));
    const host = document.createElement('div');
    const stop = mount(h(Suspense, { fallback: 'outer…' },
      h('h1', null, () => outer()),
      h(Suspense, { fallback: 'inner…' }, h('p', null, () => inner()))), host);
    assert.equal(host.textContent, 'outer…');
    api.answer('outer', 'O');
    await drain();
    assert.equal(host.textContent, 'Oinner…');
    api.answer('inner', 'I');
    await drain();
    assert.equal(host.textContent, 'OI');
    stop();
  });

  it('onMount and useEffect under it first run when its content first shows, on attached DOM', async () => {
    const { computed, h, mount, Suspense, onMount, useEffect } = W;
    const api = deferreds();
    const log = [];
    function Card() {
      const data = computed(() => api.fetch('card'));
      let el;
      onMount(() => log.push('onMount ' + el.isConnected));
      useEffect(() => { log.push('useEffect ' + el.isConnected); }, []);
      return h('article', { ref: (node) => { el = node; } }, () => data());
    }
    function Outside() {
      onMount(() => log.push('outside'));
      return h('nav', null, 'nav');
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const stop = mount(h('main', null, h(Outside), h(Suspense, { fallback: 'wait' }, h(Card))), host);
    await drain();
    assert.deepEqual(log, ['outside'], 'a component under a boundary that has not revealed waits');
    api.answer('card', 'content');
    await drain();
    assert.deepEqual(log, ['outside', 'onMount true', 'useEffect true']);
    stop();
    host.remove();
  });

  it('a boundary disposed before it reveals never runs the effects that waited for it', async () => {
    const { signal, computed, h, mount, Suspense, onMount } = W;
    const api = deferreds();
    const show = signal(true);
    const log = [];
    function Card() {
      const data = computed(() => api.fetch('never'));
      onMount(() => log.push('mounted'));
      return h('p', null, () => data());
    }
    const host = document.createElement('div');
    const stop = mount(h('div', null, () => (show() ? h(Suspense, { fallback: 'wait' }, h(Card)) : 'gone')), host);
    show(false);
    await drain();
    assert.equal(host.textContent, 'gone');
    api.answer('never');
    await drain();
    assert.deepEqual(log, []);
    stop();
  });

  it('a component that suspends with no boundary renders once its promise settles, and says so in development', async () => {
    const { h, mount, lazy, getDiagnostics, clearDiagnostics } = W;
    clearDiagnostics();
    const chunk = withResolvers();
    const Settings = lazy(() => chunk.promise);
    const host = document.createElement('div');
    const stop = mount(h('div', null, h(Settings)), host);
    assert.equal(host.textContent, '');
    assert.ok(getDiagnostics().events.some((d) => d.code === 'ERR_ASYNC_WITHOUT_SUSPENSE' && /Lazy|Settings/.test(d.message)));
    chunk.resolve({ default: () => h('p', null, 'settings') });
    await drain();
    assert.equal(host.textContent, 'settings');
    stop();
  });
});
