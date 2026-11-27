// ERR_MISSING_SIGNAL_READ: in development, a signal or computed accessor
// converted to a string or a number (`Count: ${count}`, count + 1, count > 5)
// is reported with no devtools installed, and renders exactly what production
// renders: the function's source text. A bare accessor handed to a JSX child
// or attribute is the reactive binding protocol and is never reported. The
// production tier carries none of it.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { PRODUCTION } from '../../../scripts/build.js';

installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');

const { h, mount, signal, computed, useState, useMemo, Show, For, flushSync } = await import('what-framework');
const { memo } = await import('../src/reactive.js');
const { capture, clearDiagnostics } = await import('../src/diagnostics.js');

const source = (fn) => Function.prototype.toString.call(fn);
const app = () => document.getElementById('app');

function quietly(run) {
  const cap = capture({ quiet: true });
  try { run(); } finally { cap.stop(); }
  return cap.events;
}

beforeEach(() => {
  clearDiagnostics();
  app().innerHTML = '';
});

describe('a coerced signal reports ERR_MISSING_SIGNAL_READ', () => {
  it('in a template literal, rendering the source text production renders', () => {
    const count = signal(42, 'count');
    let text;
    const events = quietly(() => { text = `Total: ${count}`; });
    assert.equal(text, `Total: ${source(count)}`);
    assert.ok(!text.includes('42'), `development must not mask the bug: ${text}`);
    assert.equal(events.length, 1);
    const [ev] = events;
    assert.equal(ev.code, 'ERR_MISSING_SIGNAL_READ');
    assert.equal(ev.severity, 'warning');
    assert.deepEqual(ev.subject, { kind: 'signal', id: undefined, name: 'count' });
    assert.equal(ev.message, 'Signal "count" was used as a value without being called (in a template literal, `+`, arithmetic, a comparison or as a property key), so the function\'s source text stood in for its value.');
  });

  it('in a concatenation and as a property key', () => {
    const name = signal('Ada', 'name');
    const table = { [source(name)]: 'source' };
    let joined;
    let looked;
    const events = quietly(() => {
      joined = 'Hello ' + name;
      looked = table[/** @type {any} */ (name)];
    });
    assert.equal(joined, `Hello ${source(name)}`);
    assert.equal(looked, 'source');
    assert.equal(events.length, 1, 'one code on one subject folds into one event');
    assert.equal(events[0].count, 2);
  });

  it('in arithmetic and comparisons, with the results production gives', () => {
    const count = signal(10, 'count');
    const c = /** @type {any} */ (count);
    let sum, product, greater, loose;
    const events = quietly(() => {
      sum = c + 1;
      product = c * 2;
      greater = c > 5;
      loose = c == 10;
    });
    assert.equal(sum, `${source(count)}1`);
    assert.ok(Number.isNaN(product));
    assert.equal(greater, false);
    assert.equal(loose, false);
    assert.equal(events.length, 1);
    assert.equal(events[0].count, 4, 'every coercion is counted');
  });

  it('names an unnamed signal "(unnamed)"', () => {
    const anonymous = signal(1);
    const events = quietly(() => `${anonymous}`);
    assert.deepEqual(events[0].subject, { kind: 'signal', id: undefined, name: '(unnamed)' });
  });

  it('for a computed or memo accessor, named by its function', () => {
    const count = signal(2, 'count');
    const doubled = computed(function doubled() { return count() * 2; });
    const tripled = computed(() => count() * 3);
    const quadrupled = memo(() => count() * 4);
    let text;
    const events = quietly(() => { text = `${doubled}|${tripled}|${quadrupled}`; });
    assert.equal(text, `${source(doubled)}|${source(tripled)}|${source(quadrupled)}`);
    assert.deepEqual(events.map((e) => e.subject), [
      { kind: 'computed', id: undefined, name: 'doubled' },
      { kind: 'computed', id: undefined, name: '() => count() * 3' },
      { kind: 'computed', id: undefined, name: '() => count() * 4' },
    ]);
  });

  it('is located at the line that used it, with where the signal was created in data.createdAt', () => {
    const count = signal(1, 'count@src/state.js:3:7');
    let stack;
    const events = quietly(() => { stack = new Error().stack; return `${count}`; });
    const line = stack.split('\n')[1].match(/:(\d+):\d+\)?$/)[1];
    assert.match(events[0].loc, new RegExp(`signal-read-guard\\.test\\.js:${line}:\\d+$`), 'the use, not the creation');
    assert.equal(events[0].data.createdAt, 'src/state.js:3:7');
  });

  it('carries the id devtools gave the signal', () => {
    const count = signal(1, 'count');
    /** @type {any} */ (count)._devId = 7;
    const events = quietly(() => `${count}`);
    assert.equal(events[0].subject.id, 7);
  });
});

describe('reads that are not coercions do not report', () => {
  it('calling, peeking, comparing identity, typeof, and an explicit source read', () => {
    const count = signal(3, 'count');
    const doubled = computed(() => count() * 2);
    const events = quietly(() => {
      assert.equal(`${count()} ${doubled()}`, '3 6');
      assert.equal(count() + 1, 4);
      assert.equal(count.peek(), 3);
      assert.equal(count === count, true);
      assert.equal(typeof count, 'function');
      assert.ok(source(count).startsWith('function'));
    });
    assert.deepEqual(events, []);
  });

  it('a toString the app assigns on one signal still wins, in both tiers', () => {
    const count = signal(3, 'count');
    count.toString = () => 'custom';
    const events = quietly(() => assert.equal(`${count}`, 'custom'));
    assert.deepEqual(events, []);
  });
});

describe('in a mounted component', () => {
  it('h(): a useState accessor in a template literal reports, and the page shows the production text', () => {
    let accessor;
    function Counter() {
      const [count] = useState(5);
      accessor = count;
      return h('p', {}, `Count: ${count}`);
    }
    const events = quietly(() => mount(h(Counter), app()));
    assert.equal(app().textContent, `Count: ${source(accessor)}`);
    assert.deepEqual(events.map((e) => [e.code, e.subject.kind]), [['ERR_MISSING_SIGNAL_READ', 'signal']]);
  });

  it('h(): the report names the component that used a signal created outside it', () => {
    const shared = signal(1, 'shared@src/store.js:1:14');
    function Badge() {
      return h('p', {}, `n: ${shared}`);
    }
    const events = quietly(() => mount(h(Badge), app()));
    assert.deepEqual(events.map((e) => [e.code, e.owner.at(-1), e.data.createdAt]), [['ERR_MISSING_SIGNAL_READ', '<Badge>', 'src/store.js:1:14']]);
    assert.notEqual(events[0].loc, 'src/store.js:1:14', 'never located where the signal was created');
  });

  it('h(): a bare accessor as a child or an attribute is a live binding, not a coercion', () => {
    let set;
    function Counter() {
      const [count, setCount] = useState(5);
      const label = useMemo(() => `n${count()}`);
      set = setCount;
      return h('div', {},
        h('p', { title: count, 'data-n': count, 'aria-label': label, class: label, id: 'p' }, count),
        h('a', { href: label, id: 'a' }, label),
        h('input', { value: count, id: 'i' }),
        h(Show, { when: count }, h('span', {}, () => `Count: ${count()}`)),
        h('ul', {}, h(For, { each: () => [count()] }, (n) => h('li', {}, n))),
      );
    }
    const events = quietly(() => {
      mount(h(Counter), app());
      set(6);
      flushSync();
    });
    assert.deepEqual(events, []);
    const p = document.getElementById('p');
    assert.equal(p.textContent, '6');
    assert.equal(p.getAttribute('title'), '6');
    assert.equal(p.getAttribute('data-n'), '6');
    assert.equal(p.getAttribute('aria-label'), 'n6');
    assert.equal(p.className, 'n6');
    assert.equal(document.getElementById('a').getAttribute('href'), 'n6');
    assert.equal(/** @type {HTMLInputElement} */ (document.getElementById('i')).value, '6');
    assert.equal(app().querySelector('span').textContent, 'Count: 6');
    assert.equal(app().querySelector('li').textContent, '6');
  });

  it('compiled JSX: a template literal on useState and useMemo accessors reports and renders the production text', async () => {
    const { Counter, seen } = await loadCompiled(`
      import { useState, useMemo } from 'what-framework';
      export const seen = {};
      export function Counter() {
        const [count] = useState(5);
        const total = useMemo(function total() { return count() * 2; });
        seen.count = count;
        seen.total = total;
        return <p id="out">{\`Count: \${count} Total: \${total}\`}</p>;
      }
    `);
    const events = quietly(() => mount(h(Counter), app()));
    assert.equal(document.getElementById('out').textContent, `Count: ${source(seen.count)} Total: ${source(seen.total)}`);
    assert.deepEqual(events.map((e) => [e.code, e.subject.kind, e.subject.name]), [
      ['ERR_MISSING_SIGNAL_READ', 'signal', '(unnamed)'],
      ['ERR_MISSING_SIGNAL_READ', 'computed', 'total'],
    ]);
  });

  it('compiled JSX: bare accessors as children and attributes, and correct reads, do not report', async () => {
    const { Counter, seen } = await loadCompiled(`
      import { useState, useMemo, Show } from 'what-framework';
      export const seen = {};
      export function Counter() {
        const [count, setCount] = useState(5);
        const label = useMemo(() => 'n' + count());
        seen.set = setCount;
        return (
          <div>
            <p id="p" title={count} data-n={count} class={label}>{count}</p>
            <a id="a" href={label}>{label}</a>
            <input id="i" value={count} />
            <Show when={count}><span id="s">Count: {count()} {\`(\${count()})\`}</span></Show>
          </div>
        );
      }
    `);
    const events = quietly(() => {
      mount(h(Counter), app());
      seen.set(6);
      flushSync();
    });
    assert.deepEqual(events, []);
    const p = document.getElementById('p');
    assert.equal(p.textContent, '6');
    assert.equal(p.getAttribute('title'), '6');
    assert.equal(p.getAttribute('data-n'), '6');
    assert.equal(p.className, 'n6');
    assert.equal(document.getElementById('a').getAttribute('href'), 'n6');
    assert.equal(/** @type {HTMLInputElement} */ (document.getElementById('i')).value, '6');
    assert.equal(document.getElementById('s').textContent, 'Count: 6 (6)');
  });
});

describe('the runtime reads the accessors it is handed', () => {
  it('Skeleton keeps a signal class reactive instead of coercing it', async () => {
    const { Skeleton } = await import('../src/skeleton.js');
    const tone = signal('dark', 'tone');
    const events = quietly(() => {
      mount(h(Skeleton, { class: tone, variant: 'pulse' }), app());
      tone('light');
      flushSync();
    });
    assert.deepEqual(events, []);
    assert.equal(app().firstElementChild.className, 'what-skeleton what-skeleton-pulse  light');
    assert.equal(Skeleton({ class: 'card' }).props.class, 'what-skeleton   card', 'a string class is joined as before');
  });

  it('a duplicate key that is a signal is reported by its value, read without subscribing the list', async () => {
    const { mapArray, insert } = await import('../src/render.js');
    const shared = signal('a', 'shared');
    const items = signal([{ key: shared }, { key: shared }]);
    let reads = 0;
    const source = () => { reads++; return items(); };
    const events = quietly(() => {
      insert(document.createElement('ul'), mapArray(source, () => document.createElement('li'), { key: (item) => item.key, raw: true }));
      mount(h('ul', {}, () => [h('li', { key: shared }), h('li', { key: shared })]), app());
    });
    assert.deepEqual(events.map((e) => [e.code, e.data.key]), [['ERR_DUPLICATE_KEY', '"a"']]);
    assert.equal(events[0].count, 2, 'the mapArray list and the vnode list');
    const before = reads;
    shared('b');
    flushSync();
    assert.equal(reads, before, 'reading the key subscribed the list to it');
  });
});

describe('the production tier carries no guard', () => {
  const reactiveURL = new URL('../src/reactive.js', import.meta.url).href;
  const diagnosticsURL = new URL('../src/diagnostics.js', import.meta.url).href;

  it('unbuilt with __WHAT_DEV__ = false: no override, the same text, nothing reported', () => {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
      globalThis.__WHAT_DEV__ = false;
      const { signal, computed, __DEV__ } = await import(${JSON.stringify(reactiveURL)});
      const { getDiagnostics } = await import(${JSON.stringify(diagnosticsURL)});
      const count = signal(3, 'count');
      const doubled = computed(() => count() * 2);
      const source = (fn) => Function.prototype.toString.call(fn);
      process.stdout.write(JSON.stringify({
        dev: __DEV__,
        own: [count, doubled].map((fn) => Object.hasOwn(Object.getPrototypeOf(fn), 'toString')),
        same: \`\${count}\` === source(count) && count + 1 === source(count) + '1' && \`\${doubled}\` === source(doubled),
        reported: getDiagnostics().events.length,
      }));
    `], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), { dev: false, own: [false, false], same: true, reported: 0 });
  });

  it('a production bundle (scripts/build.js config) has none of its code', async () => {
    const out = await esbuild({
      stdin: {
        contents: `
          import { signal, computed, h, mount } from 'what-framework';
          const count = signal(0, 'count');
          const doubled = computed(() => count() * 2);
          mount(h('p', {}, \`\${count} \${doubled}\`), document.body);
        `,
        resolveDir: fileURLToPath(new URL('../../..', import.meta.url)),
        loader: 'js',
      },
      bundle: true, minify: true, format: 'esm', write: false, logLevel: 'silent',
      ...PRODUCTION,
    });
    const code = out.outputFiles[0].text;
    for (const text of ['ERR_MISSING_SIGNAL_READ', 'Function.prototype.toString', '(unnamed)']) {
      assert.ok(!code.includes(text), `production bundle contains ${text}`);
    }
  });
});
