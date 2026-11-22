// A form field's value, through every path that writes it (h(), compiled
// setValue and setProp, hydration, each server renderer):
//   - a value prop set to null or undefined makes the field uncontrolled, and
//     a form reset then restores its default;
//   - the default (defaultValue, defaultChecked, defaultSelected) is the
//     field's content attribute in markup (server HTML, compiled templates),
//     and no value write touches it;
//   - a <select>'s value is shown by its options: a server marks the ones it
//     names `selected`, so a form posted before any script runs carries them,
//     and on the client a later write (null and false included) supersedes a
//     deferred one.
// A thenable whose `then` getter throws is a rejected action result.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { compileJSX } from '../../../test-utils/compile.js';

installDOM();
const { h, hydrate, mount, flushSync, settled, signal, Suspense } = await import('../../core/src/index.js');
const { _$Island } = await import('../../core/src/render.js');
const server = await import('../src/index.js');
const { Form, renderToHydratableString, renderToString, renderToStream } = server;

const FIELD = `
  import { signal } from 'what-framework';
  export const choice = signal('controlled');
  export function Field() {
    return <input name="field" defaultValue="default" value={choice()} />;
  }
`;

function submit(host) {
  host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return settled();
}

describe('a value released to null resets to the field default', () => {
  for (const wrapper of ['plain', 'Suspense', 'island']) {
    it(`compiled, ${wrapper}`, async (t) => {
      const build = (ssr) => loadCompiled(FIELD, { pluginOptions: { generate: ssr ? 'ssr' : 'dom', hydratable: !ssr } });
      const client = await build(false);
      const ssr = wrapper === 'island' ? await build(true) : null;
      client.choice('controlled');
      if (ssr) ssr.choice('controlled');
      const wrap = (Field) => {
        const field = wrapper === 'Suspense' ? h(Suspense, { fallback: 'wait' }, h(Field))
          : wrapper === 'island' ? h(_$Island, { component: Field, mode: 'interaction' }) : h(Field);
        return h(Form, { action: () => {} }, field);
      };
      const host = document.createElement('div');
      document.body.append(host);
      if (ssr) host.innerHTML = renderToHydratableString(wrap(ssr.Field));
      const stop = ssr ? hydrate(wrap(client.Field), host) : mount(wrap(client.Field), host);
      t.after(() => { stop(); host.remove(); });
      const input = host.querySelector('input');
      if (ssr) input.focus();
      assert.equal(input.value, 'controlled');
      assert.equal(input.defaultValue, 'default');
      client.choice(null);
      flushSync();
      input.value = 'a draft';
      await submit(host);
      assert.equal(input.defaultValue, 'default');
      assert.equal(input.value, 'default');
    });
  }

  it('h(), whichever value it starts with', async (t) => {
    for (const initial of ['controlled', null]) {
      const choice = signal(initial);
      const host = document.createElement('div');
      document.body.append(host);
      const stop = mount(h(Form, { action: () => {} }, h('input', { name: 'f', defaultValue: 'default', value: choice })), host);
      t.after(() => { stop(); host.remove(); });
      const input = host.querySelector('input');
      assert.equal(input.value, initial ?? 'default', 'a field never controlled shows its default');
      choice(null);
      flushSync();
      assert.equal(input.defaultValue, 'default');
      input.value = 'a draft';
      await submit(host);
      assert.equal(input.value, 'default');
    }
  });
});

describe('a field default is its content attribute in markup', () => {
  const source = `export function F() { return <form><input name="a" defaultValue="d" /><input type="checkbox" name="b" defaultChecked /><select name="c"><option>x</option><option defaultSelected>y</option></select><input name="e" defaultValue="def" value="shown" /></form>; }`;
  const read = (html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    const inputs = host.querySelectorAll('input');
    return { a: inputs[0].defaultValue, b: inputs[1].defaultChecked, c: host.querySelector('select').value, e: inputs[2].value, form: [...new FormData(host.querySelector('form'))] };
  };
  const expected = { a: 'd', b: true, c: 'y', e: 'shown', form: [['a', 'd'], ['b', 'on'], ['c', 'y'], ['e', 'shown']] };

  it('in the compiled client template', async () => {
    const { F } = await loadCompiled(source);
    const host = document.createElement('div');
    const stop = mount(h(F), host);
    try {
      const inputs = host.querySelectorAll('input');
      assert.deepEqual([inputs[0].defaultValue, inputs[1].defaultChecked, host.querySelector('select').value], ['d', true, 'y']);
    } finally {
      stop();
    }
  });

  it('in each server renderer, with the value prop taking the one attribute when both are given', async () => {
    const view = () => h('form', null,
      h('input', { name: 'a', defaultValue: 'd' }),
      h('input', { type: 'checkbox', name: 'b', defaultChecked: true }),
      h('select', { name: 'c' }, h('option', null, 'x'), h('option', { defaultSelected: true }, 'y')),
      h('input', { name: 'e', defaultValue: 'def', value: 'shown' }));
    assert.deepEqual(read(renderToString(view())), expected);
    assert.deepEqual(read(renderToHydratableString(view())), expected);
    let streamed = '';
    for await (const chunk of renderToStream(view())) streamed += chunk;
    assert.deepEqual(read(streamed), expected);
    const compiled = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
    assert.deepEqual(read(renderToString(h(compiled.F))), expected);
    // An option is placed at run time, where the select it sits in decides its
    // mark: its defaultSelected is a prop renderAttrs writes as `selected`.
    assert.doesNotMatch(compileJSX(source, { pluginOptions: { generate: 'ssr' } }), /defaultValue=|defaultChecked/);
  });
});

describe('a server-rendered select shows its value through its options', () => {
  const posted = (html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    const data = new FormData(host.querySelector('form'));
    return [data.getAll('tags'), data.getAll('one'), host.querySelector('select').hasAttribute('value')];
  };
  const view = () => h('form', null,
    h('select', { multiple: true, name: 'tags', value: () => ['b', 'c'] }, ...['a', 'b', 'c'].map((tag) => h('option', { value: tag }, tag))),
    h('select', { name: 'one', value: 'Two words' }, h('option', null, 'One'), h('optgroup', { label: 'g' }, h('option', null, '  Two\n words '), h('option', null, 'Two words'))));
  const expected = [['b', 'c'], ['Two words'], false];

  it('in renderToString, renderToHydratableString and renderToStream', async () => {
    assert.deepEqual(posted(renderToString(view())), expected);
    assert.deepEqual(posted(renderToHydratableString(view())), expected);
    let streamed = '';
    for await (const chunk of renderToStream(view())) streamed += chunk;
    assert.deepEqual(posted(streamed), expected);
  });

  it('in compiled server output, static and dynamic', async () => {
    const { F } = await loadCompiled(`
      const opts = ['a', 'b', 'c'];
      const tags = () => ['b', 'c'];
      export const F = () => <form><select multiple name="tags" value={tags()}>{opts.map((o) => <option value={o}>{o}</option>)}</select><select name="one" value="Two words"><option>One</option><option>Two words</option></select></form>;
    `, { pluginOptions: { generate: 'ssr' } });
    assert.deepEqual(posted(renderToString(h(F))), [['b', 'c'], ['Two words'], false]);
    assert.deepEqual(posted(renderToHydratableString(h(F))), [['b', 'c'], ['Two words'], false]);
  });

  it('and hydrates without a mismatch, keeping the selection', async (t) => {
    const tags = signal(['b', 'c']);
    const field = () => h('form', null, h('select', { multiple: true, name: 'tags', value: tags }, ...['a', 'b', 'c'].map((tag) => h('option', { value: tag }, tag))));
    const host = document.createElement('div');
    host.innerHTML = renderToHydratableString(field());
    const errors = [];
    const stop = hydrate(field(), host, { onHydrationError: (error) => errors.push(error) });
    t.after(stop);
    await Promise.resolve();
    assert.deepEqual(errors, []);
    assert.deepEqual([...host.querySelector('select').selectedOptions].map((o) => o.value), ['b', 'c']);
  });
});

describe('a client select write supersedes an earlier one', () => {
  const selected = (host) => [...host.querySelector('select').selectedOptions].map((option) => option.value);

  it('null before the deferred option write leaves nothing selected', async (t) => {
    const selection = signal(['b']);
    const host = document.createElement('div');
    t.after(mount(h('select', { multiple: true, value: selection }, h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B')), host));
    selection(null);
    flushSync();
    assert.deepEqual(selected(host), []);
    await Promise.resolve();
    assert.deepEqual(selected(host), []);
  });

  it('false clears a controlled selection, in h() and compiled output', async (t) => {
    const selection = signal(['b']);
    const host = document.createElement('div');
    t.after(mount(h('select', { multiple: true, value: selection }, h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B')), host));
    await Promise.resolve();
    assert.equal(host.querySelector('select').value, 'b');
    selection(false);
    flushSync();
    assert.equal(host.querySelector('select').value, '');
    const compiled = await loadCompiled(`
      import { signal } from 'what-framework';
      export const pick = signal(['b']);
      export const S = () => <select multiple value={pick()}><option value="a">A</option><option value="b">B</option></select>;
    `);
    const other = document.createElement('div');
    t.after(mount(h(compiled.S), other));
    await Promise.resolve();
    compiled.pick(false);
    flushSync();
    assert.equal(other.querySelector('select').value, '');
  });
});

describe('an action result whose then getter throws', () => {
  it('is a rejection: form:error hears it, the form keeps its draft, and nothing reaches the window', async (t) => {
    const failure = new Error('bad result');
    const host = document.createElement('div');
    const errors = [];
    const uncaught = [];
    const onWindowError = (event) => { uncaught.push(event.error); event.preventDefault(); };
    window.addEventListener('error', onWindowError);
    t.after(() => window.removeEventListener('error', onWindowError));
    t.after(mount(h(Form, { action: () => ({ get then() { throw failure; } }) }, h('input', { name: 'field', value: 'initial' })), host));
    const form = host.querySelector('form');
    form.addEventListener('form:error', (event) => errors.push(event.detail.error));
    const input = form.querySelector('input');
    input.value = 'draft';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(input.value, 'draft');
    assert.deepEqual(uncaught, []);
    assert.deepEqual(errors, [failure]);
  });
});
