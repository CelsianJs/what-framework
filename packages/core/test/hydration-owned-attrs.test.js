// The attributes a claimed element's bindings write in full on their first
// run (a class, an id, a title, a data-* or aria-* attribute: what-compiler
// names them to the claim) keep the server's attribute for the binding to
// write, instead of losing it and having the binding make it again. Every
// other attribute the server wrote and the client does not render still goes,
// and either way the element ends as a client render leaves it.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { compileJSX } from '../../../test-utils/compile.js';

installDOM();

const { h, hydrate, mount, flushSync } = await import('../src/index.js');
const { __resetHydrationData } = await import('../src/hydration-data.js');
const server = await import('../../server/src/index.js');

const SOURCE = `
  export const Card = (props) => (
    <div class="card" id={'card-' + props.n} title={props.title} data-n={props.n} aria-label={props.label}>
      <b class={props.on ? 'on' : ''}>{props.n}</b>
    </div>
  );
  export const Spread = (props) => <p {...props.rest} id={props.id}>x</p>;
`;
const client = await loadCompiled(SOURCE, { pluginOptions: { hydratable: true } });
const ssr = await loadCompiled(SOURCE, { pluginOptions: { generate: 'ssr' } });

const PROPS = { n: 1, title: 't', label: 'one', on: true };

function attrs(el) {
  return [...el.attributes].map((a) => `${a.name}=${a.value}`).sort();
}

function hostWith(html) {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.textContent = '';
  __resetHydrationData();
});

describe('a claimed element\'s owned attributes', () => {
  it('are the ones its bindings write in full', () => {
    const code = compileJSX(SOURCE, { pluginOptions: { hydratable: true } });
    assert.match(code, /_\$claim\(_tmpl\$\d+, 1, "id title data-n aria-label"\)/);
    assert.match(code, /_\$next\(0, 1, "class"\)/);
    assert.doesNotMatch(code, /_\$claim\(_tmpl\$\d+, 1, "id"\)/, 'none for an element with a spread');
  });

  it('keep the server\'s attribute for the binding, which writes the client\'s value', () => {
    const el = hostWith(server.renderToHydratableString(h(ssr.Card, PROPS)));
    const card = el.querySelector('.card');
    const kept = ['id', 'title', 'data-n', 'aria-label'].map((name) => card.getAttributeNode(name));
    const cls = el.querySelector('b').getAttributeNode('class');
    const reports = [];
    const stop = hydrate(h(client.Card, { ...PROPS, title: 'client' }), el, { onHydrationError: (info) => reports.push(info) });
    try {
      flushSync();
      assert.deepEqual(reports, []);
      assert.deepEqual(['id', 'title', 'data-n', 'aria-label'].map((name) => card.getAttributeNode(name)), kept);
      assert.equal(el.querySelector('b').getAttributeNode('class'), cls);
      assert.equal(card.getAttribute('title'), 'client');
      const fresh = document.createElement('div');
      const unmount = mount(h(client.Card, { ...PROPS, title: 'client' }), fresh);
      assert.deepEqual(attrs(card), attrs(fresh.firstElementChild));
      assert.deepEqual(attrs(el.querySelector('b')), attrs(fresh.querySelector('b')));
      unmount();
    } finally {
      stop();
    }
  });

  it('are removed when the client writes none, and what nothing owns still goes', () => {
    const el = hostWith(server.renderToHydratableString(h(ssr.Card, PROPS)).replace('<div', '<div data-stale="1" lang="xx"'));
    const stop = hydrate(h(client.Card, { n: 1, title: undefined, label: null, on: false }), el);
    try {
      flushSync();
      const card = el.querySelector('.card');
      assert.deepEqual(attrs(card), ['class=card', 'data-n=1', 'id=card-1']);
      assert.deepEqual(attrs(el.querySelector('b')), ['class=']);
    } finally {
      stop();
    }
  });

  it('are none on an element with a spread: its server attributes go as before', () => {
    const el = hostWith(server.renderToHydratableString(h(ssr.Spread, { rest: { title: 'a' }, id: 'p' })).replace('<p', '<p data-stale="1"'));
    const stop = hydrate(h(client.Spread, { rest: { title: 'a' }, id: 'p' }), el);
    try {
      flushSync();
      assert.deepEqual(attrs(el.querySelector('p')), ['id=p', 'title=a']);
    } finally {
      stop();
    }
  });
});
