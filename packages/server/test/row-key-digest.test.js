// A keyed list's keys comment (compiled.js rowKeys) holds a digest of each
// row's key, and hydrate() compares it with what-core's _rowKeyDigest of the
// client's key: a row whose digests differ is not adopted. what-server
// computes the digests of a list with its own loop (the words every key of a
// list shares are hashed once, the digits go into one buffer), so the two
// must agree on every key, and a plain render must compute none.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _rowKeyDigest } from 'what-core/internal';
import { rowKeys } from '../src/compiled.js';
import { renderToString, renderToHydratableString, renderToStream } from '../src/index.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { collect } from './stream-helpers.js';

// Deterministic PRNG so a failure reproduces.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function read(comment) {
  const found = /^<!--k:([0-9A-Za-z_.]{11}):([0-9A-Za-z_.]*)-->$/.exec(comment);
  assert.ok(found, `not a keys comment: ${comment.slice(0, 60)}`);
  return { salt: found[1], digests: found[2].match(/.{11}/g) || [] };
}

function assertSameAsCore(keys) {
  const { salt, digests } = read(rowKeys(keys));
  assert.equal(digests.length, keys.length);
  for (let i = 0; i < keys.length; i++) {
    assert.equal(digests[i], _rowKeyDigest(keys[i], salt), `key ${JSON.stringify(keys[i])} under salt ${salt}`);
  }
}

describe('rowKeys writes what-core\'s digest of every key', () => {
  it('for the keys lists have: ids, uuids, slugs', () => {
    const keys = [];
    for (let i = 0; i < 2000; i++) keys.push(i);
    for (let i = 0; i < 200; i++) keys.push(`item-${i}`, `0b6e5c1e-${i.toString(16).padStart(4, '0')}-4c1d-9d7e-2f3a4b5c6d7e`);
    assertSameAsCore(keys);
  });

  it('for strings of every length and parity, in and out of the BMP', () => {
    const keys = [''];
    let text = '';
    for (let i = 0; i < 70; i++) {
      text += String.fromCharCode(33 + (i * 7) % 90);
      keys.push(text, text + 'é', text + '\u{1f600}', '\ud83d' + text, text + '￿\u0000');
    }
    assertSameAsCore(keys);
  });

  it('for numbers in every spelling String() gives them', () => {
    assertSameAsCore([
      0, -0, 1, -1, 9, 10, 99, 100, 0.5, -0.5, 1 / 3, 1e21, 1e-7, -1e-7, 123456789012345680000, 2 ** 31, 2 ** 32, -(2 ** 31),
      2 ** 53, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, Number.MAX_VALUE, Number.MIN_VALUE, Number.EPSILON, 1.7976931348623157e308,
    ]);
  });

  it('for random keys', () => {
    const rand = prng(0xd16e57);
    const keys = [];
    for (let i = 0; i < 20000; i++) {
      const kind = rand();
      if (kind < 0.3) keys.push(Math.floor(rand() * 1e7));
      else if (kind < 0.4) keys.push((rand() - 0.5) * 10 ** Math.floor(rand() * 30));
      else {
        let text = '';
        const length = Math.floor(rand() * 40);
        for (let j = 0; j < length; j++) text += String.fromCharCode(rand() < 0.8 ? 32 + Math.floor(rand() * 95) : Math.floor(rand() * 65536));
        keys.push(text);
      }
    }
    assertSameAsCore(keys);
  });

  it('keeps a string and the number it spells apart, as what-core does', () => {
    const { salt, digests } = read(rowKeys(['7', 7]));
    assert.notEqual(digests[0], digests[1]);
    assert.equal(digests[0], _rowKeyDigest('7', salt));
    assert.equal(digests[1], _rowKeyDigest(7, salt));
  });

  it('writes an empty list\'s comment, and <!--k!--> for a key hydrate() cannot compare', () => {
    assert.match(rowKeys([]), /^<!--k:[0-9A-Za-z_.]{11}:-->$/);
    for (const key of [NaN, Infinity, -Infinity, null, undefined, true, {}, [], 1n, Symbol('s'), () => 1]) {
      assert.equal(rowKeys([1, key, 'a']), '<!--k!-->', String(key));
      assert.equal(_rowKeyDigest(key, 'AAAAAAAAAAA'), null, String(key));
    }
  });
});

describe('a compiled keyed list\'s keys', () => {
  it('are written by the hydratable renderers under the render\'s salt, and not computed by a plain render', async () => {
    const mod = await loadCompiled(`
      export function List(props) {
        return <ul>{props.items().map((item) => <li key={item.id} class={props.on() === item.id ? 'on' : ''}>{item.name}</li>)}</ul>;
      }
    `, { pluginOptions: { generate: 'ssr' } });
    const { h } = await import('what-framework');
    const items = [{ id: 'a', name: 'A' }, { id: 7, name: 'B' }, { id: 'a', name: 'C' }];
    const tree = () => h(mod.List, { items: () => items, on: () => 7 });

    // rowKeys turns a list's digests into text with one TextDecoder call.
    const decode = TextDecoder.prototype.decode;
    let decoded = 0;
    TextDecoder.prototype.decode = function (...args) {
      decoded++;
      return decode.apply(this, args);
    };
    const rowsHtml = '<li class="">A</li><li class="on">B</li><li class="">C</li>';
    try {
      assert.equal(renderToString(tree()), `<ul>${rowsHtml}</ul>`);
      assert.equal(decoded, 0, 'a plain render computed digests');
      renderToHydratableString(tree());
      assert.equal(decoded, 1);
    } finally {
      TextDecoder.prototype.decode = decode;
    }

    for (const html of [renderToHydratableString(tree()), await collect(renderToStream(tree()))]) {
      const comment = /<!--k:[^>]*-->/.exec(html);
      assert.ok(comment, html);
      const { salt, digests } = read(comment[0]);
      assert.deepEqual(digests, items.map((item) => _rowKeyDigest(item.id, salt)));
      assert.equal(digests[0], digests[2], 'two rows of one key have one digest');
      assert.ok(html.includes(`<!--[]-->${comment[0]}${rowsHtml}<!--/[]-->`), html);
    }
  });
});
