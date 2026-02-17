import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

if (!global.customElements) {
  const registry = new Map();
  global.customElements = {
    get: (name) => registry.get(name),
    define: (name, cls) => registry.set(name, cls),
  };
}

const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const { signal } = await import('../src/reactive.js');
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
  it('keeps useForm stable across component re-renders', async () => {
    const tick = signal(0);
    const forms = [];
    const container = getContainer();

    function App() {
      tick();
      const form = useForm({ defaultValues: { email: '' } });
      forms.push(form);
      return h('div', null, 'form');
    }

    mount(h(App), container);
    await flush();
    tick(1);
    await flush();

    assert.ok(forms.length >= 2);
    assert.equal(forms[0], forms[1]);
  });

  it('shows ErrorMessage and formState.errors text after submit validation', async () => {
    const container = getContainer();

    function App() {
      const { register, handleSubmit, formState } = useForm({
        defaultValues: { email: '' },
        resolver: simpleResolver({
          email: [rules.required('Email required')],
        }),
      });

      return h(
        'form',
        { onSubmit: handleSubmit(async () => {}) },
        h(Input, { name: 'email', register, placeholder: 'Email' }),
        h(ErrorMessage, { name: 'email', formState }),
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

    assert.equal(container.querySelector('.what-error')?.textContent, 'Email required');
    assert.equal(container.querySelector('.inline-error')?.textContent, 'Email required');
  });
});
