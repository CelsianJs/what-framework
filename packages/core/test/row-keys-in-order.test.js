// hydrate() adopts a keyed list's server rows in the client's order when the
// keys comment holds, in order, each client key's digest (_rowKeyDigest) and no
// two of them are equal. _rowKeysInOrder answers that for the whole list
// without a string per digest; whenever it says no, hydrate() compares digest
// by digest as before. It must never say yes where that comparison would not
// adopt the rows in order.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

await installDOM();
const { _rowKeyDigest, _rowKeysInOrder, _rowKeySalt } = await import('../src/render.js');

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

const written = (keys, salt) => keys.map((key) => _rowKeyDigest(key, salt)).join('');

function randomKey(rand) {
  const kind = Math.floor(rand() * 4);
  if (kind === 0) return Math.floor(rand() * 1e6);
  if (kind === 1) return (rand() - 0.5) * 1e9;
  const length = Math.floor(rand() * 9);
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(kind === 2 ? 32 + Math.floor(rand() * 95) : Math.floor(rand() * 0xffff));
  return s;
}

describe('_rowKeysInOrder', () => {
  it('says yes for the digests of distinct keys in their order, of every type and length', () => {
    const rand = prng(7);
    for (let round = 0; round < 200; round++) {
      const salt = _rowKeySalt();
      const keys = [...new Set(Array.from({ length: Math.floor(rand() * 40) }, () => randomKey(rand)))];
      assert.equal(_rowKeysInOrder(keys, salt, written(keys, salt)), true, `keys ${JSON.stringify(keys)} salt ${salt}`);
    }
  });

  it('says no when any digit of any digest differs', () => {
    const salt = _rowKeySalt();
    const keys = Array.from({ length: 30 }, (_, i) => (i % 2 ? `row-${i}` : i));
    const text = written(keys, salt);
    for (let at = 0; at < text.length; at++) {
      const other = text[at] === 'A' ? 'B' : 'A';
      assert.equal(_rowKeysInOrder(keys, salt, text.slice(0, at) + other + text.slice(at + 1)), false, `digit ${at}`);
    }
  });

  it('says no for another order, another salt, a missing or extra digest', () => {
    const salt = _rowKeySalt();
    const keys = [1, 2, 3, 'a', 'b'];
    const text = written(keys, salt);
    assert.equal(_rowKeysInOrder([...keys].reverse(), salt, text), false);
    assert.equal(_rowKeysInOrder(keys, _rowKeySalt(), text), false);
    assert.equal(_rowKeysInOrder(keys.slice(1), salt, text), false);
    assert.equal(_rowKeysInOrder(keys, salt, text + text.slice(0, 11)), false);
    assert.equal(_rowKeysInOrder(keys, salt.slice(1), text), false);
  });

  it('leaves a key it cannot digest, and a key written twice, to the full comparison', () => {
    const salt = _rowKeySalt();
    assert.equal(_rowKeysInOrder([1, 1], salt, written([1, 1], salt)), false);
    assert.equal(_rowKeysInOrder(['x', NaN], salt, _rowKeyDigest('x', salt) + 'A'.repeat(11)), false);
    assert.equal(_rowKeysInOrder([{}], salt, 'A'.repeat(11)), false);
  });

  it('tells a number key from the string of it, as the digests do', () => {
    const salt = _rowKeySalt();
    assert.equal(_rowKeysInOrder([1], salt, _rowKeyDigest('1', salt)), false);
    assert.equal(_rowKeysInOrder(['1'], salt, _rowKeyDigest('1', salt)), true);
  });
});
