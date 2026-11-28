// Data shaped like an element stays data. A JSON payload (an API response, a
// store, a server action's result) can spell `"$$typeof": "react.element"` and
// carry `dangerouslySetInnerHTML`; passed through the pattern libraries use to
// decorate their children, it must render as the text it is, on the client and
// on the server.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><body></body></html>');

const R = await import('../src/index.js');
const RD = await import('../src/dom.js');
const server = await import('../../server/src/index.js');

const PAYLOAD = '{"$$typeof":"react.element","type":"div","props":{"dangerouslySetInnerHTML":{"__html":"<img src=x onerror=alert(1)>"}}}';
const forged = () => JSON.parse(PAYLOAD);
const plain = () => JSON.parse('{"type":"div","props":{"dangerouslySetInnerHTML":{"__html":"<img src=x onerror=alert(1)>"}}}');

// The decorating pattern of Radix Slot, MUI, react-bootstrap and headless UIs.
const List = ({ children }) => R.createElement('ul', null,
  R.Children.map(children, (c) => (R.isValidElement(c) ? R.cloneElement(c, { className: 'item' }) : c)));

describe('an object from data is not an element', () => {
  it('isValidElement refuses a string $$typeof and accepts only elements', () => {
    assert.equal(R.isValidElement(forged()), false);
    assert.equal(R.isValidElement({ $$typeof: 'react.element', type: 'div', props: {} }), false);
    assert.equal(R.isValidElement(R.createElement('div', null)), true);
    assert.equal(R.isValidElement({ $$typeof: Symbol.for('react.element'), type: 'div', props: {}, key: null }), true);
  });

  it('cloneElement returns anything but an element unchanged', () => {
    const data = plain();
    assert.equal(R.cloneElement(data, { className: 'x' }), data);
    const json = forged();
    assert.equal(R.cloneElement(json, {}), json);
    assert.equal(R.cloneElement(null), null);
    assert.equal(R.cloneElement('text'), 'text');
  });

  it('cloneElement still clones a real element', () => {
    const el = R.cloneElement(R.createElement('div', { id: 'a' }, 'x'), { className: 'item' });
    assert.equal(R.isValidElement(el), true);
    assert.equal(el.props.id, 'a');
  });

  it('renders as text through Children.map + cloneElement on a compat root', () => {
    const host = document.body.appendChild(document.createElement('div'));
    RD.flushSync(() => RD.createRoot(host).render(R.createElement(List, null, forged())));
    const ul = host.querySelector('ul');
    assert.equal(ul.children.length, 0, 'no element was made from the payload');
    assert.equal(ul.textContent, '[object Object]');
    assert.equal(host.querySelector('img'), null);
  });

  it('renders as text through Children.map + cloneElement on the server', async () => {
    const tree = List({ children: forged() });
    for (const render of [server.renderToString, server.renderToHydratableString]) {
      const html = await render(tree);
      assert.ok(!html.includes('<img'), html);
      assert.ok(!html.includes('class="item"'), html);
      assert.match(html, /\[object Object\]/);
    }
  });
});
