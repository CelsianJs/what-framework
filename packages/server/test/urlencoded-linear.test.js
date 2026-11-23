// An urlencoded body is parsed in time linear in its length, on every Node
// version, and exactly as URLSearchParams parses it. On Node 24.22.3
// URLSearchParams is quadratic in the pairs that have no `=`: one anonymous
// 1 MB POST of `a&a&…` to the action endpoint or to any page held the event
// loop for about five seconds before the CSRF check ran. Every form body and
// query string the server reads goes through fields.js urlEncodedPairs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { urlEncodedPairs } from '../src/fields.js';
import { parseActionBody, parseRequestBody } from '../src/action-handler.js';

const URLENCODED = 'application/x-www-form-urlencoded';

// A small deterministic generator, so a failure names its seed.
function random(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

// The WHATWG application/x-www-form-urlencoded parser, step by step on the
// input's UTF-8 bytes (with URLSearchParams' leading `?` dropped), each part
// decoded by the Encoding Standard's UTF-8 decoder (utf8Decode): the
// reference on every Node. Node 20's and 22's own URLSearchParams decode some
// escapes wrongly (NUL characters for bytes that are not UTF-8, U+FFFD for an
// incomplete escape after a decoded one), and every version tested decodes a
// character written as itself next to escapes wrongly (U+D7FF as U+FFFD, an
// emoji as NUL), so URLSearchParams is a second reference from Node 24 on, for
// ASCII input. TextDecoder is no reference either: by default it drops a
// leading U+FEFF.
function reference(input) {
  const bytes = new TextEncoder().encode(String(input).replace(/^\?/, ''));
  const decode = (part) => {
    const out = [];
    for (let i = 0; i < part.length; i++) {
      const b = part[i] === 0x2b ? 0x20 : part[i];
      const hex = String.fromCharCode(part[i + 1] ?? 0, part[i + 2] ?? 0);
      if (b === 0x25 && /^[0-9A-Fa-f]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16));
        i += 2;
      } else {
        out.push(b);
      }
    }
    return utf8Decode(out);
  };
  const pairs = [];
  let from = 0;
  for (let i = 0; i <= bytes.length; i++) {
    if (i < bytes.length && bytes[i] !== 0x26) continue;
    const seq = bytes.subarray(from, i);
    from = i + 1;
    if (seq.length === 0) continue;
    const eq = seq.indexOf(0x3d);
    pairs.push(eq === -1 ? [decode(seq), ''] : [decode(seq.subarray(0, eq)), decode(seq.subarray(eq + 1))]);
  }
  return pairs;
}
// The Encoding Standard's UTF-8 decoder, byte by byte: U+FFFD for each
// maximal subpart of an ill-formed sequence, and no byte order mark dropped.
function utf8Decode(bytes) {
  let text = '';
  let needed = 0;
  let seen = 0;
  let point = 0;
  let lower = 0x80;
  let upper = 0xbf;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (needed === 0) {
      if (byte <= 0x7f) {
        text += String.fromCharCode(byte);
      } else if (byte >= 0xc2 && byte <= 0xdf) {
        needed = 1;
        point = byte & 0x1f;
      } else if (byte >= 0xe0 && byte <= 0xef) {
        if (byte === 0xe0) lower = 0xa0;
        if (byte === 0xed) upper = 0x9f;
        needed = 2;
        point = byte & 0xf;
      } else if (byte >= 0xf0 && byte <= 0xf4) {
        if (byte === 0xf0) lower = 0x90;
        if (byte === 0xf4) upper = 0x8f;
        needed = 3;
        point = byte & 0x7;
      } else {
        text += '�';
      }
      continue;
    }
    if (byte < lower || byte > upper) {
      needed = seen = point = 0;
      lower = 0x80;
      upper = 0xbf;
      text += '�';
      i--;
      continue;
    }
    lower = 0x80;
    upper = 0xbf;
    point = (point << 6) | (byte & 0x3f);
    if (++seen === needed) {
      text += String.fromCodePoint(point);
      needed = seen = point = 0;
    }
  }
  return needed === 0 ? text : text + '�';
}
const nodeMatchesStandard = Number(process.versions.node.split('.')[0]) >= 24;

const PIECES = ['a', 'b', 'Z', '0', '9', '=', '&', '&&', '+', '%', '%2', '%25', '%41', '%C3%A9', '%F0%9F%98%80', '%ZZ', '%e9', '%c3', '%ff', '%F0%9F%98', '?', ' ', '\u00e9', '\u{1F600}', '\u00a0', '\ud7ff', '\ue000', '==', 'a=b', '%3D', '%26', '%2B', '%EF%BB%BF', '%ef%bb', '\ufeff', '%EF%BB%BF%EF%BB%BF'];

describe('urlencoded parsing', () => {
  it('gives what the standard and URLSearchParams give, over edge cases and 20,000 random strings', () => {
    const edges = ['', '?', '?a', '??a=1', '&', '&&&', '=', '==', 'a', 'a=', '=a', 'a==b', 'a=b=c', '+', '%', '%%', '%2', '%zz', '%c3%a9', '%c3', '%ff', 'a+b=c+d', 'a&a&a', '%3D=%26', '\u00e9=\u{1F600}', 'x=1&x=2&x=3'];
    const next = random(10);
    const cases = [...edges];
    for (let i = 0; i < 20000; i++) {
      let s = '';
      const n = Math.floor(next() * 12);
      for (let j = 0; j < n; j++) s += PIECES[Math.floor(next() * PIECES.length)];
      cases.push(s);
    }
    for (const input of cases) {
      const pairs = urlEncodedPairs(input);
      assert.deepEqual(pairs, reference(input), JSON.stringify(input));
      if (nodeMatchesStandard && [...input].every((c) => c.charCodeAt(0) < 128)) assert.deepEqual(pairs, [...new URLSearchParams(input)], JSON.stringify(input));
    }
  });

  it('keeps a U+FEFF that begins a name or a value, as every WHATWG reader does', () => {
    assert.deepEqual(urlEncodedPairs('%EF%BB%BF_action=bom/run&role=%EF%BB%BFadmin'), [['﻿_action', 'bom/run'], ['role', '﻿admin']]);
    assert.deepEqual(urlEncodedPairs('﻿a%41=﻿%42'), [['﻿aA', '﻿B']]);
    assert.deepEqual(urlEncodedPairs('%EF%BB%BF_action=bom/run'), [...new URLSearchParams('%EF%BB%BF_action=bom/run')]);
  });

  it('keeps a U+FEFF that begins a request body, as Request#formData() does; a JSON body drops it, as Request#json() does', async () => {
    const bytes = new TextEncoder().encode('\ufeff_action=bom/run&role=user');
    const platform = Object.fromEntries(await new Request('http://app.test/', { method: 'POST', headers: { 'content-type': URLENCODED }, body: bytes }).formData());
    const fields = await parseRequestBody(bytes, URLENCODED);
    assert.deepEqual({ ...fields }, platform);
    assert.ok(!Object.hasOwn(fields, '_action'), 'no action is named');
    assert.deepEqual(await parseRequestBody(new TextEncoder().encode('\ufeff{"args":[1]}'), 'application/json'), { args: [1] });
  });

  it('decodes bytes that are not UTF-8 as the standard says: U+FFFD for each bad sequence', () => {
    assert.deepEqual(urlEncodedPairs(' =%ff%ZZ %25?9'), [[' ', '�%ZZ %?9']]);
    assert.deepEqual(urlEncodedPairs('%c3=%e9&a=%F0%9F%98'), [['�', '�'], ['a', '�']]);
    assert.deepEqual(urlEncodedPairs('k=%F0%9F%98%800%\ud7ffa'), [['k', '\u{1F600}0%\ud7ffa']]);
    assert.deepEqual(urlEncodedPairs('k=%C3%A9%c3'), [['k', 'é�']]);
  });

  it('parses 1 MB of key-only pairs in well under a second', () => {
    const body = 'a&'.repeat(512 * 1024);
    const started = performance.now();
    const fields = parseActionBody(body, URLENCODED);
    const elapsed = performance.now() - started;
    assert.equal(fields.a.length, 512 * 1024);
    assert.ok(elapsed < 1000, `took ${Math.round(elapsed)} ms`);
  });

  it('parses 1 MB of pairs with values and escapes in well under a second', () => {
    const body = 'k%C3%A9=v+%26+w&'.repeat(64 * 1024);
    const started = performance.now();
    const fields = parseActionBody(body, URLENCODED);
    assert.ok(performance.now() - started < 1000);
    assert.equal(fields['ké'].length, 64 * 1024);
    assert.equal(fields['ké'][0], 'v & w');
  });
});
