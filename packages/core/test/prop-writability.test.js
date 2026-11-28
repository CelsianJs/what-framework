// A prop goes to the element's property only when the element can write that
// property: one with a setter or a writable data property. A getter-only
// reflection takes the attribute instead (an input's `form` owner and `list`
// datalist, a select's `type`, a custom element's read-only accessor), where
// assigning the property throws in a module. The same on every write path:
// h(), compiled JSX (static and reactive), a spread, and hydration.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();
const { h, mount, hydrate, signal, flushSync } = await import('../src/index.js');

class ReadOnly extends HTMLElement {
  get mode() { return this.getAttribute('mode') || 'none'; }
}
customElements.define('read-only-mode', ReadOnly);

function check(build) {
  const host = document.createElement('div');
  host.innerHTML = '<form id="owner"></form><datalist id="choices"></datalist>';
  document.body.append(host);
  const stop = mount(build(), host);
  try {
    const input = host.querySelector('input');
    assert.equal(input.form, host.querySelector('form'));
    assert.equal(input.list, host.querySelector('datalist'));
    assert.equal(host.querySelector('read-only-mode').mode, 'fast');
  } finally {
    stop();
    host.remove();
  }
}

describe('a getter-only property takes the attribute', () => {
  it('from h(), plain and reactive', () => {
    check(() => [h('input', { form: 'owner', list: 'choices' }), h('read-only-mode', { mode: 'fast' })]);
    const mode = signal('slow');
    check(() => {
      queueMicrotask(() => { mode('fast'); flushSync(); });
      return [h('input', { form: () => 'owner', list: 'choices' }), h('read-only-mode', { mode: () => mode() === 'slow' ? 'fast' : 'fast' })];
    });
  });

  it('from compiled JSX, static, reactive and spread', async () => {
    const { build } = await loadCompiled(`
      import { signal } from 'what-framework';
      export function build() {
        const owner = signal('owner');
        const rest = { list: 'choices' };
        return [<input form={owner()} {...rest} />, <read-only-mode mode={'fa' + 'st'} />];
      }
    `);
    check(build);
  });

  it('when hydration writes a prop the server left out', () => {
    const host = document.createElement('div');
    host.innerHTML = '<form id="owner"></form><input>';
    document.body.append(host);
    const stop = hydrate([h('form', { id: 'owner' }), h('input', { form: 'owner' })], host);
    try {
      assert.equal(host.querySelector('input').form, host.querySelector('form'));
    } finally {
      stop();
      host.remove();
    }
  });
});
