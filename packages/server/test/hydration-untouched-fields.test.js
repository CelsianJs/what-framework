// Hydration and the fields a page shows before it runs. A field the user
// changed keeps what they left in it; one they did not is left as the markup
// shows it; and no input or change event is dispatched for either, as
// released React (react-dom 19.3) does. A value the browser restored on a
// history navigation looks like an edit, so a replayed event ran handlers on
// Back. "Changed" is what the browser's own reset says differs: a range's
// midpoint, a color's #000000, a select whose first group is disabled, a
// radio group with two checked attributes are untouched. Before, those read
// as changed: hydration wrote their value back, which made them dirty, so a
// later default no longer moved them, and their handlers ran on load.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const env = installDOM();
const { h, hydrate, signal, flushSync } = await import('what-core');
const { renderToHydratableString } = await import('../src/index.js');

const flush = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

// Each field: its markup (the props of a server render), a later default, and
// how to read what it shows.
const fields = {
  text: { tag: 'input', props: { type: 'text' }, first: 'a', later: 'b', read: (el) => el.value, edit: (el) => { el.value = 'typed'; } },
  textarea: { tag: 'textarea', props: {}, first: 'a', later: 'b', read: (el) => el.value, edit: (el) => { el.value = 'typed'; } },
  number: { tag: 'input', props: { type: 'number' }, first: '1', later: '2', read: (el) => el.value, edit: (el) => { el.value = '7'; } },
  date: { tag: 'input', props: { type: 'date' }, first: '2026-01-01', later: '2026-02-02', read: (el) => el.value, edit: (el) => { el.value = '2026-03-03'; } },
  // No value attribute: the browser shows the midpoint, and #000000.
  range: { tag: 'input', props: { type: 'range' }, first: undefined, later: '20', read: (el) => el.value, edit: (el) => { el.value = '80'; } },
  color: { tag: 'input', props: { type: 'color' }, first: undefined, later: '#ff0000', read: (el) => el.value, edit: (el) => { el.value = '#00ff00'; } },
  checkbox: { tag: 'input', props: { type: 'checkbox' }, first: false, later: true, read: (el) => el.checked, edit: (el) => { el.checked = true; }, prop: 'defaultChecked' },
};

describe('hydration and fields the user did not touch', () => {
  for (const [name, field] of Object.entries(fields)) {
    it(`${name}: left as the markup shows it (a later default still moves it), and no event`, async () => {
      const prop = field.prop || 'defaultValue';
      const dflt = signal(field.first);
      const view = () => h('form', null, h(field.tag, { name: 'f', ...field.props, [prop]: dflt }));
      const host = document.createElement('div');
      document.body.append(host);
      host.innerHTML = renderToHydratableString(view());
      const el = host.querySelector('[name=f]');
      const before = field.read(el);
      const events = [];
      host.addEventListener('input', (e) => events.push(e.type), true);
      host.addEventListener('change', (e) => events.push(e.type), true);
      const stop = hydrate(view(), host);
      await flush();
      try {
        assert.equal(host.querySelector('[name=f]'), el);
        assert.equal(field.read(el), before);
        dflt(field.later);
        flushSync();
        assert.equal(String(field.read(el)), String(field.later), 'not dirty: the default moves it');
        assert.deepEqual(events, []);
      } finally {
        stop();
        host.remove();
      }
    });

    it(`${name}: an edit before hydration stays, and no event is dispatched for it`, async () => {
      const prop = field.prop || 'defaultValue';
      const view = () => h('form', null, h(field.tag, { name: 'f', ...field.props, [prop]: field.first }));
      const host = document.createElement('div');
      document.body.append(host);
      host.innerHTML = renderToHydratableString(view());
      const el = host.querySelector('[name=f]');
      field.edit(el);
      const edited = field.read(el);
      const events = [];
      host.addEventListener('input', (e) => events.push(e.type), true);
      host.addEventListener('change', (e) => events.push(e.type), true);
      const stop = hydrate(view(), host);
      await flush();
      try {
        assert.equal(field.read(el), edited);
        assert.deepEqual(events, []);
      } finally {
        stop();
        host.remove();
      }
    });
  }

  it('a select whose first group is disabled: the browser\'s selection is untouched', async () => {
    const dflt = signal(undefined);
    const view = () => h('form', null, h('select', { name: 'f', defaultValue: dflt },
      h('optgroup', { label: 'Off', disabled: true }, h('option', { value: 'x' }, 'x')),
      h('option', { value: 'a' }, 'a'), h('option', { value: 'b' }, 'b')));
    const host = document.createElement('div');
    document.body.append(host);
    host.innerHTML = renderToHydratableString(view());
    const select = host.querySelector('select');
    const shown = select.value;
    const events = [];
    host.addEventListener('change', (e) => events.push(e.type), true);
    const stop = hydrate(view(), host);
    await flush();
    try {
      assert.equal(select.value, shown);
      dflt('b');
      flushSync();
      assert.equal(select.value, 'b', 'not dirty: the default moves it');
      assert.deepEqual(events, []);
    } finally {
      stop();
      host.remove();
    }
  });

  it('a radio group whose markup checks two: the browser checks the last, and that is untouched', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    host.innerHTML = '<form><input type="radio" name="f" value="a" checked><input type="radio" name="f" value="b" checked></form>';
    const view = () => h('form', null, h('input', { type: 'radio', name: 'f', value: 'a', defaultChecked: true }), h('input', { type: 'radio', name: 'f', value: 'b', defaultChecked: true }));
    const [a, b] = host.querySelectorAll('input');
    assert.deepEqual([a.checked, b.checked], [false, true]);
    const events = [];
    host.addEventListener('change', (e) => events.push(e.type), true);
    const stop = hydrate(view(), host);
    await flush();
    try {
      assert.deepEqual([a.checked, b.checked], [false, true]);
      assert.deepEqual(events, []);
    } finally {
      stop();
      host.remove();
    }
  });

  it('a hidden input and a file input are left alone', async () => {
    const view = () => h('form', null, h('input', { type: 'hidden', name: 'h', value: 'kept' }), h('input', { type: 'file', name: 'u' }));
    const host = document.createElement('div');
    document.body.append(host);
    host.innerHTML = renderToHydratableString(view());
    const events = [];
    host.addEventListener('input', (e) => events.push(e.type), true);
    host.addEventListener('change', (e) => events.push(e.type), true);
    const stop = hydrate(view(), host);
    await flush();
    try {
      assert.equal(host.querySelector('[name=h]').value, 'kept');
      assert.equal(host.querySelector('[name=u]').value, '');
      assert.deepEqual(events, []);
    } finally {
      stop();
      host.remove();
    }
  });
});

process.on('exit', () => env.cleanup());
