// A registered file input holds the files chosen in it, as React Hook Form
// registers one, and not the fake path the browser reports as its value
// ("C:\fakepath\license.png"), which carries no file at all.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const { useForm, simpleResolver, rules } = await import('../src/form.js');

const flush = () => new Promise((r) => setTimeout(r, 0));

function fileInput(files) {
  const el = document.createElement('input');
  el.type = 'file';
  Object.defineProperty(el, 'files', { configurable: true, get: () => files });
  Object.defineProperty(el, 'value', { configurable: true, get: () => (files.length ? `C:\\fakepath\\${files[0].name}` : ''), set() {} });
  return el;
}

const choose = (handler, files) => handler({ type: 'change', target: fileInput(files) });

describe('register() on a file input', () => {
  it('holds the chosen files, not the fake path', () => {
    const form = useForm();
    const photo = new File(['abc'], 'license.png', { type: 'image/png' });
    choose(form.register('license').onchange, [photo]);
    const value = form.getValue('license');
    assert.notEqual(typeof value, 'string', `the field holds ${JSON.stringify(value)}`);
    assert.equal(value.length, 1);
    assert.equal(value[0], photo);
  });

  it('takes a second choice of as many files, and an emptied input', () => {
    const form = useForm();
    const { onchange } = form.register('license');
    const first = new File(['a'], 'front.png');
    const second = new File(['b'], 'back.png');
    choose(onchange, [first]);
    choose(onchange, [second]);
    assert.equal(form.getValue('license')[0], second);
    choose(onchange, []);
    assert.equal(form.getValue('license').length, 0);
  });

  it('hands the files to the resolver and to the submit handler', async () => {
    const seen = [];
    const form = useForm({
      resolver: simpleResolver({
        license: [rules.custom((files) => (files && files.length && files[0] instanceof File ? undefined : 'Attach a file'))],
      }),
    });
    const photo = new File(['abc'], 'license.png');
    choose(form.register('license').onchange, [photo]);
    await form.handleSubmit((values) => { seen.push(values.license[0]); })();
    assert.equal(form.formState.error('license'), null);
    assert.deepEqual(seen, [photo]);
  });

  it('a mounted file input reports its files on change and is never written to', async () => {
    const form = useForm();
    const photo = new File(['abc'], 'license.png');
    let input;
    function App() {
      return h('input', { type: 'file', ...form.register('license'), ref: (el) => { input = el; } });
    }
    const root = document.getElementById('app');
    root.textContent = '';
    mount(h(App), root);
    await flush();
    Object.defineProperty(input, 'files', { configurable: true, get: () => [photo] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    assert.equal(form.getValue('license')[0], photo);
  });
});
