// what-framework/form's Input, Textarea and Checkbox (docs/API.md: "Bound
// field components"): unregistered they are the element with its props; with
// `register` the field's value drives them, a later write to the field
// (setValue, reset) shows, and their edits write the field.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();
const { Checkbox, Input, Textarea, useForm } = await import('../src/form.js');
const { h, mount, flushSync } = await import('../src/index.js');
const { renderToString } = await import('../../server/src/index.js');

function mounted(view) {
  const el = document.createElement('div');
  document.body.append(el);
  const stop = mount(view, el);
  flushSync();
  return { el, stop: () => { stop(); el.remove(); } };
}

function withForm(defaultValues, fields) {
  let form;
  function F() {
    form = useForm({ defaultValues });
    return h('form', null, ...fields(form.register));
  }
  const view = mounted(h(F));
  return { ...view, form: () => form };
}

describe('Checkbox', () => {
  it('unregistered, is checked by its checked prop, on the client and the server', () => {
    const { el, stop } = mounted(h(Checkbox, { name: 'a', checked: true }));
    assert.equal(el.querySelector('input').checked, true);
    stop();
    assert.equal(renderToString(h(Checkbox, { name: 'a', checked: true })), '<input type="checkbox" name="a" checked>');
  });

  it('registered, shows the field, writes it on a click and follows it', () => {
    const { el, stop, form } = withForm({ agree: true }, (register) => [h(Checkbox, { register, name: 'agree' })]);
    const input = el.querySelector('input');
    assert.equal(input.checked, true);
    assert.equal(input.hasAttribute('value'), false, 'no value attribute: the form submits "on"');
    assert.deepEqual([...new window.FormData(el.querySelector('form'))], [['agree', 'on']]);
    input.click();
    flushSync();
    assert.equal(form().getValue('agree'), false);
    input.click();
    flushSync();
    assert.equal(form().getValue('agree'), true);
    assert.equal(input.checked, true);
    form().setValue('agree', false);
    flushSync();
    assert.equal(input.checked, false, 'a write to the field unchecks it');
    stop();
  });
});

describe('Textarea', () => {
  it('unregistered, takes its props and marks an error', () => {
    const { el, stop } = mounted(h(Textarea, { name: 't', value: 'hi', error: 'bad', rows: 3 }));
    const ta = el.querySelector('textarea');
    assert.equal(ta.value, 'hi');
    assert.equal(ta.getAttribute('aria-invalid'), 'true');
    assert.equal(ta.getAttribute('rows'), '3');
    stop();
  });

  it('registered, shows the field, writes it as the user types and follows it', () => {
    const { el, stop, form } = withForm({ bio: 'x' }, (register) => [h(Textarea, { register, name: 'bio' })]);
    const ta = el.querySelector('textarea');
    assert.equal(ta.value, 'x');
    assert.equal(ta.hasAttribute('aria-invalid'), false);
    ta.value = 'typed';
    ta.dispatchEvent(new window.Event('input', { bubbles: true }));
    flushSync();
    assert.equal(form().getValue('bio'), 'typed');
    form().setValue('bio', 'set');
    flushSync();
    assert.equal(ta.value, 'set');
    stop();
  });
});

describe('Input', () => {
  it('registered, follows the field through setValue and reset', () => {
    const { el, stop, form } = withForm({ email: 'a@b.co' }, (register) => [h(Input, { register, name: 'email', type: 'email' })]);
    const input = el.querySelector('input');
    assert.equal(input.value, 'a@b.co');
    form().setValue('email', 'c@d.co');
    flushSync();
    assert.equal(input.value, 'c@d.co');
    form().reset();
    flushSync();
    assert.equal(input.value, 'a@b.co');
    stop();
  });
});
