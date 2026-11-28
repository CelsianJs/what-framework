// <Form>'s reset after a successful action restores each controlled field to
// what its prop holds, whatever kind of field it is and whatever else fails:
//   - a multiple <select> keeps every option its array value names;
//   - a value prop set to null or undefined leaves the field uncontrolled, so
//     the reset restores its default, not the value it had before;
//   - a field whose own setter throws reports it as form:error, and every
//     other field is still restored;
//   - a field outside the form joins it through the `form` attribute, from
//     h() as from markup.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { withResolvers } from '../../../test-utils/with-resolvers.js';

installDOM();
const { h, mount, signal, flushSync, settled } = await import('what-core');
const { Form } = await import('../src/form.js');

const submit = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
function show(t, tree) {
  const host = document.createElement('div');
  document.body.append(host);
  const stop = mount(tree, host);
  t.after(() => { stop(); host.remove(); });
  return host;
}

describe('<Form> reset restores every controlled field', () => {
  it('a multiple select keeps each option its value names', async (t) => {
    const host = show(t, h(Form, { action: () => {} }, h('select', { name: 'tags', multiple: true, value: ['a', 'c'] },
      ...['a', 'b', 'c'].map((v) => h('option', { value: v }, v)))));
    const select = host.querySelector('select');
    // The options mount after the select's value is set: it is applied once they are in.
    await Promise.resolve();
    assert.deepEqual([...select.selectedOptions].map((o) => o.value), ['a', 'c']);
    for (const [i, on] of [[0, false], [1, true], [2, false]]) select.options[i].selected = on;
    submit(host.querySelector('form'));
    await settled();
    assert.deepEqual([...select.selectedOptions].map((o) => o.value), ['a', 'c']);
  });

  it('a value prop cleared to null while the action ran is not restored', async (t) => {
    const flight = withResolvers();
    const value = signal('old');
    const host = show(t, h(Form, { action: () => flight.promise }, h('input', { name: 'title', value })));
    const input = host.querySelector('input');
    submit(host.querySelector('form'));
    value(null);
    flushSync();
    flight.resolve();
    await settled();
    assert.equal(input.value, '');
  });

  it('one field whose setter throws is reported, and the next is still restored', async (t) => {
    const host = show(t, h(Form, { action: () => {} },
      h('input', { name: 'broken', value: 'first' }),
      h('input', { name: 'good', value: 'second' })));
    const [broken, good] = host.querySelectorAll('input');
    const form = host.querySelector('form');
    const errors = [];
    Object.defineProperty(broken, 'value', { get: () => 'first', set() { throw new Error('cannot restore'); } });
    form.addEventListener('form:error', (event) => errors.push(event.detail.error.message));
    good.value = 'typed';
    submit(form);
    await settled();
    assert.deepEqual([errors, good.value], [['cannot restore'], 'second']);
  });

  it('a field outside the form joins it with the form attribute', (t) => {
    const host = show(t, [h(Form, { action: () => {}, id: 'owner' }), h('input', { form: 'owner', name: 'outside' })]);
    assert.equal(host.querySelector('input').form, host.querySelector('form'));
  });
});
