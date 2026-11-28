// The hydration key is placed by a linear scan (security review #6), and the
// string renderers' output is byte for byte what the previous release wrote.
//
// injectHydrationKey matched /^((?:<!--.*?-->)*)<([a-zA-Z][a-zA-Z0-9-]*)/,
// which backtracks over a run of comment markers with no element after it in
// exponential time. A list whose rows all render nothing makes exactly that
// run, from data: 10 rows took 21 ms, 14 rows 56 s.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as core from 'what-core';
import { renderToHydratableString, renderToString } from '../src/index.js';
import { randomTree } from './fixtures/random-tree.js';
import { keyShape } from './stream-helpers.js';

const { h } = core;

describe('the hydration key scan', () => {
  it('a component whose rows all render nothing renders in linear time', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: i, visible: false }));
    function List() {
      return rows.map((row) => () => (row.visible ? h('li', null, row.id) : null));
    }
    const started = performance.now();
    const html = renderToHydratableString(h('ul', null, h(List, {})));
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 500, `60 empty rows took ${elapsed.toFixed(0)} ms`);
    assert.doesNotMatch(html, /data-hk/);
  });

  it('keys a component whose output opens with an element, with its owner path', () => {
    function Shown() { return h('p', null, 'x'); }
    function Hidden() { return [() => null, () => null, h('p', null, 'x')]; }
    assert.equal(renderToHydratableString(h('div', null, h(Shown, {}), h(Shown, {}))), '<div><p data-hk="0">x</p><p data-hk="1">x</p></div>');
    // Output that opens with a marker settles the key without placing it.
    assert.equal(renderToHydratableString(h(Hidden, {})), '<!--[]--><!--$--><!--/$--><!--$--><!--/$--><p>x</p><!--/[]-->');
  });
});

// The hashes are of renderToString output as the previous release wrote it,
// and of renderToHydratableString output in the current hydration protocol
// (compiled.js), which changed when keys became owner paths and boundaries
// got markers. A <textarea> changed in both in 0.15: its content is text only
// (no element, no marker) and a newline follows its start tag, which the
// parser drops (what-core markup-rules.js). Also in 0.15, a keyed list writes
// its rows' keys after its opening marker (compiled.js rowKeys, hashed here
// by their shape, since each render salts them), and a
// component given one child gets the child itself, as on the client, so a
// component that returns its children writes no array markers around one; a
// style object's declaration the client's CSSOM would drop (a name that is not
// a property) is not written; a form field shows its value or default in its
// one content attribute (what-server's _field: a bare `checked`, a
// <textarea>'s value as its text, a `checked` of '' not checked); and
// `contenteditable` is enumerated, so true and false are written out
// (what-core markup-rules.js isEnumeratedAttr).
describe('string output is unchanged', () => {
  it('renderToString matches the previous release, renderToHydratableString the protocol, on 300 seeded random trees', () => {
    const expected = JSON.parse(readFileSync(new URL('./fixtures/string-render-hashes.json', import.meta.url), 'utf8'));
    const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
    const warn = console.warn;
    console.warn = () => {};
    const mismatches = [];
    try {
      for (const [seed, [plain, hydratable]] of Object.entries(expected)) {
        if (sha(renderToString(randomTree(core, Number(seed)))) !== plain) mismatches.push(`renderToString seed ${seed}`);
        if (sha(keyShape(renderToHydratableString(randomTree(core, Number(seed))))) !== hydratable) mismatches.push(`renderToHydratableString seed ${seed}`);
      }
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(mismatches, []);
  });
});
