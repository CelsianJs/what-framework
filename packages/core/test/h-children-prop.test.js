// An element vnode made with its children as a prop, React's createElement
// form (`h('button', { ...props })` in a wrapper component, or
// `h('p', { children: 'x' })`), renders them on the client and on the server.
// Children passed as arguments win over the prop.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let env;
let W;
let S;
before(async () => {
  env = installDOM();
  W = await import('../src/index.js');
  S = await import('../../server/src/index.js');
});
after(() => env.cleanup());

function rendered(vnode) {
  const host = document.createElement('div');
  const stop = W.mount(vnode, host);
  W.flushSync();
  const html = host.innerHTML.replace(/<!--[^>]*-->/g, '');
  stop();
  return html;
}

describe('h() with children as a prop', () => {
  it('a wrapper that spreads its props onto an element renders their children', () => {
    const { h } = W;
    function Button(props) {
      return h('button', { ...props, type: 'button' });
    }
    assert.equal(rendered(h(Button, { class: 'primary' }, 'Save')), '<button class="primary" type="button">Save</button>');
    assert.equal(S.renderToString(h(Button, { class: 'primary' }, 'Save')).replace(/<!--[^>]*-->/g, ''), '<button class="primary" type="button">Save</button>');
  });

  it('renders a children prop of text, vnodes and arrays', () => {
    const { h } = W;
    assert.equal(rendered(h('p', { children: 'text' })), '<p>text</p>');
    assert.equal(rendered(h('p', { children: ['a', h('b', null, 'B')] })), '<p>a<b>B</b></p>');
  });

  it('children passed as arguments win over the prop', () => {
    const { h } = W;
    assert.equal(rendered(h('p', { children: 'prop' }, 'argument')), '<p>argument</p>');
  });
});
