// Regressions for two a11y correctness defects found in the 2026-08-09 parity
// audit. Both are cases where the server and the client disagreed about the same
// value, so SSR emitted something correct and the client silently replaced it.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!doctype html><html><body><div id="app"></div></body></html>');

const { h, mount, signal } = await import('../src/index.js');
const { useId, useIds } = await import('../src/a11y.js');
const { renderToString } = await import('../../server/src/index.js');

const flush = () => new Promise((r) => setTimeout(r, 5));

describe('aria-* and role serialize as enumerated strings, not HTML booleans', () => {
  beforeEach(() => { document.getElementById('app').innerHTML = ''; });

  // The client hit a generic `typeof value === 'boolean'` branch before its aria
  // branch, so `true` became `aria-checked=""` (not a valid enumerated value)
  // and `false` removed the attribute entirely, which means "unsupported" rather
  // than "unchecked" to assistive technology.
  it('renders true as "true" on the client', () => {
    mount(h('div', { 'aria-checked': true, role: 'switch' }, 'x'), '#app');
    const el = document.querySelector('[role=switch]');
    assert.equal(el.getAttribute('aria-checked'), 'true');
  });

  it('renders false as "false" on the client, rather than removing the attribute', () => {
    mount(h('div', { 'aria-checked': false, role: 'switch' }, 'x'), '#app');
    const el = document.querySelector('[role=switch]');
    assert.equal(el.getAttribute('aria-checked'), 'false');
  });

  it('keeps the enumerated form across a reactive update', async () => {
    const expanded = signal(true, 'expanded');
    mount(h('button', { 'aria-expanded': () => expanded() }, 'x'), '#app');
    const el = document.querySelector('button');
    assert.equal(el.getAttribute('aria-expanded'), 'true');
    expanded(false);
    await flush();
    assert.equal(el.getAttribute('aria-expanded'), 'false', 'must not be removed on update');
  });

  it('server and client agree on both booleans', () => {
    const props = { 'aria-expanded': true, 'aria-checked': false, role: 'switch' };
    const html = renderToString(h('button', props, 'x'));
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /aria-checked="false"/);

    mount(h('button', props, 'x'), '#app');
    const el = document.querySelector('#app button');
    assert.equal(el.getAttribute('aria-expanded'), 'true');
    assert.equal(el.getAttribute('aria-checked'), 'false');
  });

  // Only aria-*/role changed. Real HTML boolean attributes must keep HTML
  // boolean semantics, where the attribute is present-and-empty or absent.
  it('leaves genuine HTML boolean attributes alone', () => {
    mount(h('input', { disabled: true, required: false }), '#app');
    const el = document.querySelector('input');
    assert.equal(el.getAttribute('disabled'), '');
    assert.equal(el.getAttribute('required'), null);
  });
});

describe('useId is stable per render, not per process', () => {
  // A bare module-global counter drifts between the SSR pass and hydration and
  // lets concurrent requests interleave into each other's sequence, which breaks
  // exactly the relationships useId exists to create.
  function Field({ label }) {
    const id = useId('fld');
    return h('div', {}, h('label', { for: id() }, label), h('input', { id: id() }));
  }
  const Page = () => h('form', {}, h(Field, { label: 'A' }), h(Field, { label: 'B' }));

  it('produces the same ids on every server render', () => {
    const runs = [0, 1, 2].map(() => renderToString(h(Page, {})).match(/fld-\d+/g).join(' '));
    assert.equal(runs[0], runs[1]);
    assert.equal(runs[1], runs[2]);
  });

  it('still pairs each label with its own input', () => {
    const html = renderToString(h(Page, {}));
    const ids = html.match(/fld-\d+/g);
    assert.equal(ids.length, 4);
    assert.equal(ids[0], ids[1], 'label for and input id must match');
    assert.equal(ids[2], ids[3]);
    assert.notEqual(ids[0], ids[2], 'two fields must not share an id');
  });

  it('useIds allocates distinct ids from the same render-scoped counter', () => {
    const html = renderToString(h(() => {
      const [a, b] = useIds(2, 'grp');
      return h('div', { 'aria-labelledby': `${a} ${b}` });
    }, {}));
    assert.match(html, /aria-labelledby="grp-1 grp-2"/);
  });
});
