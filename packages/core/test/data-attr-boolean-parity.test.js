// Regression tests: a boolean `data-*` value must serialize the same way on all
// three paths, and must keep `false` as a real value rather than removing the
// attribute.
//
// `data-*` is enumerated exactly like `aria-*`: `data-open="false"` is a
// distinct state from an absent `data-open`, and `[data-open="false"]` is an
// ordinary CSS selector. Treating it as an HTML boolean attribute (present or
// removed) throws that distinction away.
//
// Bug (2026-08-28): the three paths disagreed. dom.js reached its generic
// boolean branch before its `data-` branch, so h() wrote `data-on=""` for true
// and removed the attribute for false. render.js stringified, giving
// "true"/"false". The SSR serializer emitted a bare `data-on` for true and
// nothing for false. A `[data-on="true"]` selector therefore matched or missed
// depending on which path built the DOM, and an SSR page disagreed with its own
// compiled client on hydration.
//
// The compiled path was chosen as correct: it is the one that matches React,
// and it is the one that keeps false addressable.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { h } = await import('../src/h.js');
const { createDOM } = await import('../src/dom.js');
const { setAttr } = await import('../src/render.js');
const { renderToString } = await import('../../server/src/index.js');

describe('boolean data-* parity across the three paths', () => {
  it('h() writes "true"/"false" rather than presence/absence', () => {
    const on = createDOM(h('div', { 'data-on': true }));
    assert.equal(on.getAttribute('data-on'), 'true');

    const off = createDOM(h('div', { 'data-on': false }));
    assert.equal(off.getAttribute('data-on'), 'false');
  });

  it('the compiled path agrees with h()', () => {
    const on = document.createElement('div');
    setAttr(on, 'data-on', true);
    assert.equal(on.getAttribute('data-on'), 'true');

    const off = document.createElement('div');
    setAttr(off, 'data-on', false);
    assert.equal(off.getAttribute('data-on'), 'false');
  });

  it('SSR agrees with both', () => {
    assert.match(renderToString(h('div', { 'data-on': true })), /data-on="true"/);
    assert.match(renderToString(h('div', { 'data-on': false })), /data-on="false"/);
  });

  it('a real HTML boolean attribute keeps presence semantics', () => {
    // The control. `disabled` is a genuine HTML boolean: present means
    // disabled, absent means enabled, and `disabled="false"` would be wrong.
    const on = createDOM(h('button', { disabled: true }));
    assert.equal(on.getAttribute('disabled'), '');

    const off = createDOM(h('button', { disabled: false }));
    assert.equal(off.hasAttribute('disabled'), false);
  });

  it('a non-boolean data-* value is untouched', () => {
    // The other control: only booleans were ever ambiguous here.
    const node = createDOM(h('div', { 'data-count': 0, 'data-name': 'x' }));
    assert.equal(node.getAttribute('data-count'), '0');
    assert.equal(node.getAttribute('data-name'), 'x');
  });

  it('a nullish data-* value still means no attribute', () => {
    const node = createDOM(h('div', { 'data-on': null, 'data-off': undefined }));
    assert.equal(node.hasAttribute('data-on'), false);
    assert.equal(node.hasAttribute('data-off'), false);
  });
});
