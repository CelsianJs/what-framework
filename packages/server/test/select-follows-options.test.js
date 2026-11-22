// A select follows its option set, on every client path:
//   - one a value controls selects again whenever its options' values change,
//     the text of an option with no `value` included (its value): before, a
//     text change under an option went unnoticed;
//   - an emptied keyed <For> of options, hydrated, leaves none selected:
//     before, its rows went before the select heard of it;
//   - one with only a default keeps showing it while the user leaves it alone,
//     a late streamed option adopted included: before, hydration took the
//     server's mark off the arrived option and the select showed the first;
//   - a streamed scalar value marks one option, also across a boundary that
//     resolves late: before, the boundary decided on a copy of the select's
//     scope and both it and a later option were marked.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();
const { h, hydrate, mount, signal, flushSync, For, Suspense, createResource, applyStreamedBoundaries } = await import('what-core');
const { renderToHydratableString, renderToStream } = await import('../src/index.js');

function root(html = '') {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.append(el);
  return el;
}

const source = `
  export function Implicit({ on }) {
    return <select value="b"><option value="a">a</option><option>{on() ? 'b' : 'x'}</option></select>;
  }
`;
const client = await loadCompiled(source);
const hydratable = await loadCompiled(source, { pluginOptions: { hydratable: true } });
const ssr = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });

describe('a controlled select follows an option whose text is its value', () => {
  const hView = (on) => h('select', { value: 'b' }, h('option', { value: 'a' }, 'a'), h('option', null, () => (on() ? 'b' : 'x')));
  const cases = {
    'h() mount': (on) => mount(hView(on), root()),
    'h() hydrate': (on) => {
      const host = root(renderToHydratableString(hView(signal(false))));
      return hydrate(hView(on), host);
    },
    'compiled mount': (on) => mount(h(client.Implicit, { on }), root()),
    'compiled hydrate': (on) => {
      const host = root(renderToHydratableString(h(ssr.Implicit, { on: signal(false) })));
      return hydrate(h(hydratable.Implicit, { on }), host);
    },
  };
  for (const [name, start] of Object.entries(cases)) {
    it(name, async () => {
      const on = signal(false);
      const before = document.body.children.length;
      const stop = start(on);
      const host = document.body.children[before];
      const select = host.querySelector('select');
      try {
        await Promise.resolve();
        assert.equal(select.value, '', 'no option is b yet');
        on(true);
        flushSync();
        assert.equal(select.value, 'b', 'the option whose text became b');
        on(false);
        flushSync();
        assert.equal(select.value, '');
      } finally {
        stop();
        host.remove();
      }
    });
  }
});

describe('a controlled select over a hydrated keyed <For>', () => {
  it('selects none once the list empties', async () => {
    const on = signal(false);
    const option = (x) => h('option', { value: x }, x);
    const view = (o) => h('select', { value: 'b' }, option('a'), h(For, { each: () => (o() ? ['b'] : []), key: (x) => x }, option));
    const host = root(renderToHydratableString(view(signal(false))));
    const stop = hydrate(view(on), host);
    try {
      await Promise.resolve();
      const select = host.querySelector('select');
      assert.equal(select.value, '');
      on(true);
      flushSync();
      assert.equal(select.value, 'b');
      on(false);
      flushSync();
      assert.equal(select.value, '');
    } finally {
      stop();
      host.remove();
    }
  });
});

// The streamed page of `select`, with its late boundary's chunks held back.
async function streamed(page, api) {
  let resolve;
  const ready = new Promise((done) => { resolve = done; });
  const stream = renderToStream(page(() => ready), { noScripts: true, loaderData: { page: 1 } });
  const chunks = [];
  const collect = (async () => { for await (const chunk of stream) chunks.push(chunk); })();
  await stream.shellReady;
  while (!chunks.length) await new Promise((done) => setTimeout(done, 1));
  return { shell: chunks[0], rest: async () => { resolve(api); await collect; return chunks.slice(1).join(''); } };
}

describe('a select streamed with a late option', () => {
  const option = (value, id) => h('option', { value, id }, value);
  const page = (key, duplicate) => (api) => {
    function Options() {
      const [data] = createResource(api);
      return () => option(data(), 'arrived');
    }
    return h('select', { [key]: 'b' }, option('a', 'first'), h(Suspense, { fallback: option('wait', 'wait') }, h(Options)), duplicate ? option('b', 'other') : null);
  };

  it('an uncontrolled default keeps the arrived option the server marked', async () => {
    const { shell, rest } = await streamed(page('defaultValue', false), 'b');
    const host = root(shell);
    const stop = hydrate(page('defaultValue', false)(async () => 'client'), host);
    try {
      host.insertAdjacentHTML('beforeend', await rest());
      applyStreamedBoundaries();
      flushSync();
      const select = host.querySelector('select');
      assert.equal(select.selectedOptions[0]?.id, 'arrived');
      assert.deepEqual([...select.options].filter((o) => o.defaultSelected).map((o) => o.id), ['arrived']);
    } finally {
      stop();
      host.remove();
    }
  });

  it('an uncontrolled default leaves what the user chose', async () => {
    const { shell, rest } = await streamed(page('defaultValue', false), 'b');
    const host = root(shell);
    const stop = hydrate(page('defaultValue', false)(async () => 'client'), host);
    try {
      const select = host.querySelector('select');
      select.querySelector('#first').selected = true;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      host.insertAdjacentHTML('beforeend', await rest());
      applyStreamedBoundaries();
      flushSync();
      assert.equal(select.selectedOptions[0]?.id, 'first');
    } finally {
      stop();
      host.remove();
    }
  });

  it('a scalar value marks one option across the late boundary', async () => {
    const { shell, rest } = await streamed(page('value', true), 'b');
    const html = shell + (await rest());
    assert.equal((html.match(/ selected/g) || []).length, 1, html);
  });
});
