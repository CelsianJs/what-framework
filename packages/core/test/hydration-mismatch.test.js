// Hydration mismatches are diagnostics, not silent rewrites.
//
// For each kind of mismatch (an element of another tag, other text, a node
// missing, nodes left over, a marker where content belongs, a component key
// that is not the client's) hydrate() reports one ERR_HYDRATION_MISMATCH with
// the kind, the component and its owner path, the DOM path, what the client
// renders and what the server had, calls options.onHydrationError with the
// same record, and client-renders the smallest part it can: afterwards the
// container holds exactly what a client render holds, with no attribute the
// server wrote and the client does not. Both clients: h() vnodes and compiled
// JSX built for hydration.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();

const { h, mount, hydrate, flushSync, signal } = await import('../src/index.js');
const { getDiagnostics, clearDiagnostics } = await import('../src/diagnostics.js');

const quiet = (fn) => {
  const { warn, error } = console;
  console.warn = () => {};
  console.error = () => {};
  try { return fn(); } finally { console.warn = warn; console.error = error; }
};

// The page as a person sees it: elements with every attribute, and text.
// Comments (markers) are bookkeeping.
function shape(node) {
  if (node.nodeType === 3) return node.data;
  if (node.nodeType !== 1) return null;
  const attrs = [...node.attributes].map((a) => `${a.name}=${a.value}`).sort();
  const children = [];
  for (const child of node.childNodes) {
    const value = shape(child);
    if (value === null || value === '') continue;
    if (typeof value === 'string' && typeof children.at(-1) === 'string') children[children.length - 1] += value;
    else children.push(value);
  }
  return [node.localName, attrs, children];
}

function hydrateAgainst(serverHTML, tree) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  host.innerHTML = serverHTML;
  const reports = [];
  const stop = quiet(() => hydrate(tree(), host, { onHydrationError: (info) => reports.push(info) }));
  flushSync();
  const freshHost = document.createElement('div');
  const unmount = mount(tree(), freshHost);
  const result = { host, reports, hydrated: shape(host), fresh: shape(freshHost), diagnostics: getDiagnostics().events.filter((e) => e.code === 'ERR_HYDRATION_MISMATCH') };
  unmount();
  stop();
  host.remove();
  return result;
}

function expectMismatch(result, fields) {
  assert.equal(result.reports.length, 1, JSON.stringify(result.reports));
  for (const [key, value] of Object.entries(fields)) assert.equal(result.reports[0][key], value, key);
  assert.equal(result.diagnostics.length, 1, 'one coded diagnostic');
  assert.deepEqual(result.diagnostics[0].data, result.reports[0], 'the diagnostic carries the record');
  assert.deepEqual(result.hydrated.slice(1), result.fresh.slice(1), 'recovery leaves what a client render leaves');
}

beforeEach(() => clearDiagnostics());

describe('h() client: one coded report per mismatch, and the client render left behind', () => {
  it('tag: another element where the client renders one', () => {
    function Card() { return h('div', null, h('p', { class: 'p' }, 'a')); }
    const result = hydrateAgainst('<div><span class="s" data-x="1">a</span></div>', () => h(Card));
    expectMismatch(result, { kind: 'tag', component: 'Card', ownerPath: '~0', path: 'div>span', expected: '<p>', found: '<span class="s">', recovery: 'client-render' });
  });

  it('text: other text', () => {
    const result = hydrateAgainst('<p>Hello Bob</p>', () => h('p', null, 'Hello ', 'Ada'));
    expectMismatch(result, { kind: 'text', component: 'root', path: 'p>#text', expected: '"Ada"', found: '"Bob"' });
  });

  it('missing: a node the server did not render', () => {
    const result = hydrateAgainst('<div></div>', () => h('div', null, h('p', null, 'x')));
    expectMismatch(result, { kind: 'missing', path: 'div', expected: '<p>', found: 'nothing' });
  });

  it('extra-nodes: nodes the client does not render', () => {
    const result = hydrateAgainst('<div><p>x</p><p>y</p></div>', () => h('div', null, h('p', null, 'x')));
    expectMismatch(result, { kind: 'extra-nodes', path: 'div>p[1]', expected: 'nothing', found: '<p>' });
  });

  it('marker: a boundary marker where an element belongs', () => {
    const result = hydrateAgainst('<div><!--b--><p>x</p><!--/b--></div>', () => h('div', null, h('p', null, 'x')));
    expectMismatch(result, { kind: 'marker', path: 'div>#comment', expected: '<p>', found: '<!--b-->' });
  });

  it('key: a component key that cannot be the client\'s reports, and keeps the matching markup', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div data-hk="0"><p data-hk="5">x</p></div><script id="__what_data" type="application/json">{}</script>';
    const p = host.querySelector('p');
    const reports = [];
    function Para() { return h('p', null, 'x'); }
    function Outer() { return h('div', null, h(Para)); }
    const stop = quiet(() => hydrate(h(Outer), host, { onHydrationError: (info) => reports.push(info) }));
    try {
      assert.deepEqual(reports.map((r) => [r.kind, r.component, r.ownerPath, r.expected, r.found, r.recovery]), [['key', 'Para', '~00', 'data-hk="00"', 'data-hk="5"', 'none']]);
      assert.equal(host.querySelector('p'), p, 'the matching markup is kept');
      assert.equal(p.hasAttribute('data-hk'), false);
    } finally {
      stop();
    }
  });

  it('stale attributes: a claimed element keeps only what its props render', () => {
    const result = hydrateAgainst('<p class="a" data-stale="1" onclick="alert(1)" title="t">x</p>', () => h('p', { class: 'b', title: 'u' }, 'x'));
    assert.deepEqual(result.reports, []);
    assert.deepEqual(result.hydrated, result.fresh);
  });

  it('an attribute the client would refuse is not kept because the server wrote the same value', () => {
    const result = hydrateAgainst('<a href="javascript:alert(1)" onclick="alert(2)">x</a>', () => h('a', { href: 'javascript:alert(1)', onclick: 'alert(2)' }, 'x'));
    assert.deepEqual(result.hydrated, result.fresh);
    assert.equal(result.host.innerHTML.includes('javascript:'), false);
  });

  it('a reactive region whose text differs is corrected in place and stays live', () => {
    const host = document.createElement('div');
    host.innerHTML = '<p><!--$-->1<!--/$--></p>';
    const text = host.querySelector('p').childNodes[1];
    const count = signal(2);
    const reports = [];
    const stop = quiet(() => hydrate(h('p', null, () => count()), host, { onHydrationError: (info) => reports.push(info) }));
    try {
      assert.deepEqual(reports.map((r) => [r.kind, r.expected, r.found]), [['text', '"2"', '"1"']]);
      assert.equal(host.querySelector('p').childNodes[1], text, 'the server text node is kept');
      count(3);
      flushSync();
      assert.equal(host.textContent, '3');
    } finally {
      stop();
    }
  });
});

const compiled = await loadCompiled(`
  export const Tag = (props) => <div><p class="p">{props.value()}</p></div>;
  export const Text = (props) => <p>Hello {props.name}!</p>;
  export const Missing = () => <div><p>{'x'}</p><b>{'y'}</b></div>;
  export const Extra = () => <div><p>{'x'}</p></div>;
  export const Stale = (props) => <div><p title={props.title}>{props.value()}</p></div>;
  export const Link = () => <nav><a class="nav" href="/home">home</a></nav>;
`, { pluginOptions: { hydratable: true } });

describe('compiled client: one coded report per mismatch, and the client render left behind', () => {
  const value = () => () => 'a';

  it('tag', () => {
    const result = hydrateAgainst('<div><span data-x="1"><!--$-->a<!--/$--></span></div>', () => h(compiled.Tag, { value: value() }));
    expectMismatch(result, { kind: 'tag', component: 'Tag', path: 'div>span', expected: '<p class="p">', found: '<span>' });
  });

  it('text, inside a run the parser merged', () => {
    const result = hydrateAgainst('<p>Hello Bob!</p>', () => h(compiled.Text, { name: 'Ada' }));
    expectMismatch(result, { kind: 'text', component: 'Text', path: 'p>#text', expected: '"Ada"', found: '"Bob!"' });
  });

  it('missing', () => {
    const result = hydrateAgainst('<div><p>x</p></div>', () => h(compiled.Missing));
    expectMismatch(result, { kind: 'missing', component: 'Missing', path: 'div', expected: '<b>', found: 'nothing' });
  });

  it('extra-nodes', () => {
    const result = hydrateAgainst('<div><p>x</p><i>y</i></div>', () => h(compiled.Extra));
    expectMismatch(result, { kind: 'extra-nodes', component: 'Extra', path: 'div>i', expected: 'nothing', found: '<i>' });
  });

  it('stale attributes are removed and the bindings write the client\'s', () => {
    const result = hydrateAgainst('<div class="x" data-stale="1" onclick="alert(1)"><p title="server" data-y="2"><!--$-->a<!--/$--></p></div>', () => h(compiled.Stale, { title: 'client', value: value() }));
    assert.deepEqual(result.reports, []);
    assert.deepEqual(result.hydrated, result.fresh);
  });

  it('a static attribute ends as the template writes it, whatever the server wrote in its place', () => {
    for (const server of [
      '<nav><a onclick="alert(1)" data-x="1">home</a></nav>',
      '<nav><a class="evil" href="javascript:alert(1)">home</a></nav>',
      '<nav><a>home</a></nav>',
    ]) {
      const result = hydrateAgainst(server, () => h(compiled.Link, {}));
      assert.deepEqual(result.reports, [], server);
      assert.deepEqual(result.hydrated, result.fresh, server);
    }
  });

  it('text inside a subtree that is all the template\'s', () => {
    const result = hydrateAgainst('<nav><a class="nav" href="/home">away</a></nav>', () => h(compiled.Link, {}));
    expectMismatch(result, { kind: 'text', component: 'Link', path: 'nav>a>#text', expected: '"home"', found: '"away"' });
  });
});
