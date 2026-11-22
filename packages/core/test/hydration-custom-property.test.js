// A custom element's own property need not reflect its attribute: a setter
// may keep state of its own. Hydration writes such a prop through the
// property, as a mount does, even when the server's attribute already shows
// the same text; for a built-in element's reflected attribute it still skips
// the write.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();
const { h, hydrate, mount } = await import('../src/index.js');
const { renderToHydratableString } = await import('../../server/src/index.js');

class AmountInput extends HTMLElement {
  #amount = null;
  get amount() { return this.#amount; }
  set amount(value) { this.#amount = Number(value); }
}
customElements.define('amount-input', AmountInput);

test('vnode hydration initializes a writable custom property the server wrote as an attribute', (t) => {
  const host = document.createElement('div');
  document.body.append(host);
  t.after(() => host.remove());
  const App = () => h('div', null, h('amount-input', { amount: '3' }), h('p', { title: 'same' }, 'x'));
  const stop = mount(h(App), host);
  assert.equal(host.querySelector('amount-input').amount, 3);
  stop();
  host.innerHTML = renderToHydratableString(h(App));
  assert.equal(host.querySelector('amount-input').getAttribute('amount'), '3');
  const title = host.querySelector('p').getAttributeNode('title');
  t.after(hydrate(h(App), host));
  assert.equal(host.querySelector('amount-input').amount, 3);
  assert.equal(host.querySelector('p').getAttributeNode('title'), title, 'a reflected attribute is kept as the server wrote it');
});
