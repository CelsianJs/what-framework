// Keyed lists across every renderer and client pairing: the string and the
// stream renderer, each with h() and compiled markup on the server and h() and
// compiled code on the client (eight combinations). A server row is adopted
// only as the row of its own key, so what was typed into it stays with that
// key:
//   - a nested keyed list (`row.children.map`, `row.children?.map`) is a keyed
//     list on both sides, written with its keys;
//   - a key hydration cannot compare (NaN, an object, a boolean, null) makes
//     the server mark the list, and the client builds it and reports it,
//     instead of adopting rows by position;
//   - a compiled row's callback sees its client index;
//   - a keyed list inside a ternary or after `&&` is keyed on the server too.
// The page carries a digest of each key under a salt of its render, never the
// key itself: a key of the client is matched to a server row only by its own
// digest under that salt, so a different key never inherits a row, also one
// whose digest collided with the server key's under 0.15's first digest
// (unsalted, 32 bits) in every renderer, client and wrapper.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();
const { h, hydrate, Suspense } = await import('../src/index.js');
const { _$Island, _rowKeyDigest } = await import('../src/render.js');
const { renderToHydratableString, renderToStream } = await import('what-server');

const source = ({ indexed = false, optional = false } = {}) => `
  import { signal } from 'what-framework';
  export function make(initial) {
    const rows = signal(initial);
    return function View() {
      return <ul>{rows().map((row, index) =>
        <li key={row.id} data-name={row.label}>${indexed ? '{index}:' : ''}{row.label}<input />
          {row.children${optional ? '?.' : '.'}map(child => <div key={child} data-child={child}><input /></div>)}
        </li>)}</ul>;
    };
  }
`;
const compile = async (options) => [
  await loadCompiled(source(options), { pluginOptions: { generate: 'ssr' } }),
  await loadCompiled(source(options), { pluginOptions: { hydratable: true } }),
];
const [server, client] = await compile();
const [optionalServer, optionalClient] = await compile({ optional: true });

function hView(items) {
  return () => h('ul', null, () => items.map((row) =>
    h('li', { key: row.id, 'data-name': row.label },
      row.label, h('input'),
      () => row.children?.map((child) => h('div', { key: child, 'data-child': child }, h('input'))))));
}

// An unsalted row key digest: 32-bit FNV-1a of the key's type and value. Two
// keys it gives one digest, for the cases that force a collision across
// renders.
function unsaltedDigest(key) {
  const text = 's' + key;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(36);
}
const COLLIDING = ['row-1162789', 'row-1379192'];

const ALICE = { id: 'a', label: 'Alice', children: ['A', 'B'] };
const BOB = { id: 'b', label: 'Bob', children: ['C'] };

const wrap = {
  plain: (View) => h(View),
  suspense: (View) => h(Suspense, { fallback: 'loading' }, h(View)),
  island: (View) => h(_$Island, { component: View, mode: 'interaction' }),
};

async function serverHtml(render, tree) {
  if (render === 'string') return renderToHydratableString(tree);
  let html = '';
  for await (const chunk of renderToStream(tree, {})) html += chunk;
  return html;
}

// Server-renders `original`, types into Alice's row (and child A's, when there
// is one), hydrates `updated`, and hands `verify` what it needs.
async function check({ render, serverView, clientView, wrapper = 'plain', original, updated, verify }) {
  const html = await serverHtml(render, wrap[wrapper](serverView(original)));
  const host = document.createElement('div');
  host.innerHTML = html;
  const alice = host.querySelector('[data-name=Alice] input');
  const nested = host.querySelector('[data-child=A] input');
  const serverRows = [...host.querySelectorAll('li')];
  alice.value = 'draft for Alice';
  if (nested) nested.value = 'draft for child A';
  document.body.append(host);
  const reports = [];
  const stop = hydrate(wrap[wrapper](clientView(updated)), host, { onHydrationError: (r) => reports.push(r) });
  try {
    if (wrapper === 'island') alice.focus();
    assert.deepEqual([...host.querySelectorAll('li')].map((li) => li.dataset.name), updated.map((row) => row.label));
    verify({ host, alice, nested, reports, serverRows, html });
  } finally {
    stop();
    host.remove();
  }
}

const COMBINATIONS = [
  ['h', hView, hView],
  ['compiled', server.make, client.make],
  ['h to compiled', hView, client.make],
  ['compiled to h', server.make, hView],
];

for (const render of ['string', 'stream']) {
  for (const [variant, serverView, clientView] of COMBINATIONS) {
    describe(`${render} renderer, ${variant}`, () => {
      const run = (options) => check({ render, serverView, clientView, ...options });

      it('a nested keyed list keeps each draft with its key through a reorder', () => run({
        original: [ALICE, BOB],
        updated: [BOB, { ...ALICE, children: ['B', 'A'] }],
        verify: ({ host, alice, nested }) => {
          assert.equal(host.querySelector('[data-name=Alice] input'), alice);
          assert.deepEqual([...host.querySelectorAll('[data-name=Alice] [data-child]')].map((el) => el.dataset.child), ['B', 'A']);
          assert.equal(host.querySelector('[data-child=A] input'), nested);
          assert.equal(nested.value, 'draft for child A');
        },
      }));

      // For h(), a null key is no key: the list is not keyed on an h() client.
      const odd = [['NaN', Number.NaN], ['an object', { id: 1 }], ['a boolean', true]];
      if (clientView !== hView) odd.push(['null', null]);
      for (const [name, oddKey] of odd) {
        it(`a list with ${name} for a key is built by the client and reported, never adopted by position`, () => run({
          original: [{ ...ALICE, id: oddKey, children: [] }, { ...BOB, id: 2, children: [] }],
          updated: [{ ...BOB, id: 2, children: [] }, { ...ALICE, id: oddKey, children: [] }],
          verify: ({ host, reports, serverRows, html }) => {
            assert.ok(html.includes('<!--k!-->'), 'the server marks the list');
            assert.equal(host.querySelector('[data-name=Bob] input').value, '');
            assert.equal(host.querySelector('[data-name=Alice] input').value, '');
            assert.ok([...host.querySelectorAll('li')].every((li) => !serverRows.includes(li)), 'every row was built by the client');
            const key = reports.filter((r) => r.kind === 'key');
            assert.deepEqual(key.map((r) => [r.found, r.recovery]), [['keys it cannot compare', 'client-render']]);
          },
        }));
      }

      it('the page carries a digest of each key, not the key', () => run({
        original: [{ ...ALICE, id: 'alice@corp.test' }, { ...BOB, id: 'bob@corp.test' }],
        updated: [{ ...BOB, id: 'bob@corp.test' }, { ...ALICE, id: 'alice@corp.test' }],
        verify: ({ host, alice, reports, html }) => {
          assert.ok(!html.includes('corp.test'), html);
          const salt = /<!--k:([^:>]+):/.exec(html)[1];
          assert.ok(html.includes(`<!--k:${salt}:${_rowKeyDigest('alice@corp.test', salt)}${_rowKeyDigest('bob@corp.test', salt)}-->`), html);
          assert.equal(host.querySelector('[data-name=Alice] input'), alice);
          assert.deepEqual(reports.filter((r) => r.kind === 'key').map((r) => [r.expected, r.found, r.recovery]),
            [['bob@corp.test,alice@corp.test', 'alice@corp.test,bob@corp.test', 'move']]);
        },
      }));

      for (const wrapper of ['plain', 'suspense', 'island']) {
        it(`${wrapper}: a different key never inherits the server row, one that collided under 0.15's first digest included`, () => {
          assert.equal(unsaltedDigest(COLLIDING[0]), unsaltedDigest(COLLIDING[1]));
          return run({
            wrapper,
            original: [{ ...ALICE, id: COLLIDING[0], children: [] }],
            updated: [{ ...ALICE, label: 'Alice', id: COLLIDING[1], children: [] }],
            verify: ({ host, alice, reports, html }) => {
              const salt = /<!--k:([^:>]+):/.exec(html)[1];
              assert.notEqual(_rowKeyDigest(COLLIDING[0], salt), _rowKeyDigest(COLLIDING[1], salt));
              assert.equal(host.querySelector('[data-name=Alice] input').value, '', 'the new key inherited the old row\'s draft');
              assert.ok(!host.contains(alice));
              assert.deepEqual(reports.filter((r) => r.kind === 'key').map((r) => r.recovery), ['client-render']);
            },
          });
        });
      }

      for (const wrapper of ['suspense', 'island']) {
        it(`a reorder under ${wrapper === 'suspense' ? '<Suspense>' : 'an island'} moves the server rows`, () => run({
          wrapper,
          original: [ALICE, BOB],
          updated: [BOB, ALICE],
          verify: ({ host, alice }) => assert.equal(host.querySelector('[data-name=Alice] input'), alice),
        }));
      }
    });
  }
}

describe('compiled keyed lists, hydrated', () => {
  it('a nested `?.map` is keyed on both sides', async () => {
    for (const render of ['string', 'stream']) {
      await check({
        render, serverView: optionalServer.make, clientView: optionalClient.make,
        original: [ALICE, { ...BOB, children: null }],
        updated: [{ ...BOB, children: null }, { ...ALICE, children: ['B', 'A'] }],
        verify: ({ host, nested }) => {
          const fields = [...host.querySelectorAll('[data-child]')].map((el) => [el.dataset.child, el.querySelector('input').value]);
          assert.deepEqual(fields, [['B', ''], ['A', 'draft for child A']]);
          assert.equal(host.querySelector('[data-child=A] input'), nested);
        },
      });
    }
  });

  it('a moved row\'s callback is given its client index, which takes exactly the index\'s text', async () => {
    const [indexedServer, indexedClient] = await compile({ indexed: true });
    for (const render of ['string', 'stream']) {
      await check({
        render, serverView: indexedServer.make, clientView: indexedClient.make,
        original: [ALICE, BOB],
        updated: [BOB, ALICE],
        verify: ({ host, alice, reports }) => {
          assert.deepEqual([...host.querySelectorAll('li')].map((li) => li.textContent.trim()), ['0:Bob', '1:Alice']);
          assert.equal(host.querySelector('[data-name=Alice] input'), alice, 'the index took the label\'s text with it');
          assert.equal(alice.value, 'draft for Alice');
          assert.deepEqual(reports.map((r) => [r.kind, r.recovery]), [['key', 'move'], ['text', 'client-render'], ['text', 'client-render']]);
        },
      });
    }
  });

  it('an island reports a nested list it rebuilds to the hydrate() that ran it', async () => {
    for (const render of ['string', 'stream']) {
      await check({
        render, wrapper: 'island', serverView: server.make, clientView: client.make,
        original: [{ ...ALICE, children: [{ id: 1 }] }],
        updated: [{ ...ALICE, children: [{ id: 2 }] }],
        verify: ({ reports, html }) => {
          assert.ok(html.includes('<!--k!-->'), html);
          assert.deepEqual(reports.filter((r) => r.kind === 'key').map((r) => r.recovery), ['client-render']);
        },
      });
    }
  });

  it('a keyed list inside a ternary or after && is keyed on the server too', async () => {
    for (const form of ['show() ? rows().map((row) => ROW) : null', 'show() && rows().map((row) => ROW)']) {
      const code = `
        import { signal } from 'what-framework';
        export function make(initial) {
          const rows = signal(initial);
          const show = signal(true);
          return function View() { return <ul>{${form.replace('ROW', '<li key={row.id} data-name={row.label}><input /></li>')}}</ul>; };
        }`;
      const ternaryServer = await loadCompiled(code, { pluginOptions: { generate: 'ssr' } });
      const ternaryClient = await loadCompiled(code, { pluginOptions: { hydratable: true } });
      await check({
        render: 'string', serverView: ternaryServer.make, clientView: ternaryClient.make,
        original: [ALICE, BOB],
        updated: [BOB, ALICE],
        verify: ({ host, alice, reports }) => {
          assert.equal(host.querySelector('[data-name=Alice] input'), alice, form);
          assert.equal(host.querySelector('[data-name=Bob] input').value, '', form);
          assert.deepEqual(reports.map((r) => [r.kind, r.recovery]), [['key', 'move']], form);
        },
      });
    }
  });
});

describe('row key digests', () => {
  it('are salted by each render, so no digest exists before its page does', async () => {
    const pages = await Promise.all([0, 1].map(() => serverHtml('string', h(server.make([ALICE, BOB])))));
    const [a, b] = pages.map((html) => /<!--k:([^:>]+):([^>]*)-->/.exec(html));
    assert.notEqual(a[1], b[1], 'each render has its own salt');
    assert.notEqual(a[2], b[2], 'so the same keys have other digests');
    assert.equal(a[2], _rowKeyDigest('a', a[1]) + _rowKeyDigest('b', a[1]));
  });

  it('a page read under another salt adopts no row', async () => {
    const html = await serverHtml('string', h(server.make([ALICE, BOB])));
    const salt = /<!--k:([^:>]+):/.exec(html)[1];
    const other = salt === 'AAAAAAAAAAA' ? 'BBBBBBBBBBB' : 'AAAAAAAAAAA';
    const host = document.createElement('div');
    host.innerHTML = html.replace(salt, other);
    const alice = host.querySelector('[data-name=Alice] input');
    const reports = [];
    const stop = hydrate(h(client.make([ALICE, BOB])), host, { onHydrationError: (r) => reports.push(r) });
    assert.ok(!host.contains(alice));
    assert.deepEqual(reports.filter((r) => r.kind === 'key').map((r) => r.recovery), ['client-render']);
    stop();
  });

  it('are the same for a number and its string only by type, and -0 is 0', () => {
    const salt = 'Q7_x.0aZ9mK';
    assert.notEqual(_rowKeyDigest(1, salt), _rowKeyDigest('1', salt));
    assert.equal(_rowKeyDigest(-0, salt), _rowKeyDigest(0, salt));
    assert.match(_rowKeyDigest('\ud800<!--', salt), /^[0-9A-Za-z_.]{11}$/);
    for (const key of [Number.NaN, Infinity, null, undefined, true, {}, Symbol('k')]) assert.equal(_rowKeyDigest(key, salt), null);
  });
});
