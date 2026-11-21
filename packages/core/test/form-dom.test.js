import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { dom } = installDOM();

const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
await import('../src/reactive.js'); // imported for module-init order; no binding is used here
const { useForm, Input, ErrorMessage, rules, simpleResolver } = await import('../src/form.js');

async function flush() {
  await new Promise(r => queueMicrotask(r));
  await new Promise(r => queueMicrotask(r));
  await new Promise(r => setTimeout(r, 0));
}

function getContainer() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

describe('form DOM integration', () => {
  it('useForm returns stable form object (component runs once)', async () => {
    const forms = [];
    const container = getContainer();

    function App() {
      const form = useForm({ defaultValues: { email: '' } });
      forms.push(form);
      return h('div', null, 'form');
    }

    mount(h(App), container);
    await flush();

    // In fine-grained mode, component runs once
    assert.equal(forms.length, 1, 'component should run exactly once');
    assert.ok(forms[0], 'form object should be returned');
    assert.ok(typeof forms[0].register === 'function', 'form has register');
    assert.ok(typeof forms[0].handleSubmit === 'function', 'form has handleSubmit');
  });

  it('shows inline errors via reactive function children after submit validation', async () => {
    const container = getContainer();

    function App() {
      const { register, handleSubmit, formState } = useForm({
        defaultValues: { email: '' },
        resolver: simpleResolver({
          email: [rules.required('Email required')],
        }),
      });

      // A reactive function child reads the error each time it changes.
      return h(
        'form',
        { onSubmit: handleSubmit(async () => {}) },
        h(Input, { name: 'email', register, placeholder: 'Email' }),
        h(
          'p',
          { class: 'inline-error' },
          () => formState.errors.email ? formState.errors.email.message : ''
        ),
        h('button', { type: 'submit' }, 'Submit'),
      );
    }

    mount(h(App), container);
    await flush();

    const form = container.querySelector('form');
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    assert.equal(container.querySelector('.inline-error')?.textContent, 'Email required');
  });

  it('ErrorMessage shows, changes and removes the message as the field error does', async () => {
    const container = getContainer();
    let form;

    function App() {
      form = useForm({
        defaultValues: { email: '' },
        resolver: simpleResolver({
          email: [rules.required('Email required'), rules.email('Enter a valid email')],
        }),
      });
      return h(
        'form',
        { onSubmit: form.handleSubmit(async () => {}) },
        h(Input, { name: 'email', register: form.register }),
        h(ErrorMessage, { name: 'email', formState: form.formState }),
        h(ErrorMessage, {
          name: 'email',
          formState: form.formState,
          render: ({ message, type }) => h('em', { 'data-type': type }, message),
        }),
      );
    }

    mount(h(App), container);
    await flush();
    const message = () => container.querySelector('.what-error')?.textContent ?? null;
    const custom = () => container.querySelector('em');
    assert.equal(message(), null);
    assert.equal(custom(), null);

    const submit = () => container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    submit();
    await flush();
    assert.equal(message(), 'Email required');
    assert.equal(container.querySelector('.what-error').getAttribute('role'), 'alert');
    assert.equal(custom()?.textContent, 'Email required');

    form.setValue('email', 'not-an-email');
    submit();
    await flush();
    assert.equal(message(), 'Enter a valid email');
    assert.equal(custom()?.textContent, 'Enter a valid email');

    form.setValue('email', 'ada@example.com');
    submit();
    await flush();
    assert.equal(message(), null);
    assert.equal(custom(), null);
  });
});
