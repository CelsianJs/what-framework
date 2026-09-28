// React-style prop names whose HTML attribute has a different name.
//
// The JSX types accept `htmlFor`, and on the client it works: the h() path sets
// the element's reflected DOM property (`label.htmlFor = 'email'`), which writes
// the `for` attribute. Markup has no properties, so the server has to rename the
// prop itself. It renamed `className` and nothing else, so
//
//   renderToString(h('label', { htmlFor: 'email' }, 'Email'))
//
// produced `<label htmlFor="email">`. The HTML parser lowercases that into an
// `htmlfor` attribute, which means nothing, and the label is not associated with
// its control. Hydration does not repair it either: static props are assumed to
// be in the server's markup already and are skipped, so the page stays broken
// after the client takes over, with no warning anywhere.
//
// The oracle is the client. Every alias is rendered once through mount() and
// once through each server path, and the attributes the browser ends up with
// must be the same. Names that differ from their attribute only by case
// (tabIndex, readOnly, maxLength) ride along as controls: the HTML parser
// lowercases attribute names, so those were never broken.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { h, mount, hydrate, signal } = await import('what-core');
const { renderToString, renderToHydratableString, renderToStream } = await import('../src/index.js');
const { flushSync } = await import('../../core/src/reactive.js');

// Run a render the way a real server sees it: no `document` global.
async function asServer(fn) {
  const saved = globalThis.document;
  delete globalThis.document;
  try {
    return await fn();
  } finally {
    globalThis.document = saved;
  }
}

async function streamToString(vnode) {
  let out = '';
  for await (const chunk of renderToStream(vnode)) out += chunk;
  return out;
}

async function renderAllPaths(makeVNode) {
  return asServer(async () => {
    const hydratable = await renderToHydratableString(makeVNode());
    return {
      string: await renderToString(makeVNode()),
      hydratable: typeof hydratable === 'string' ? hydratable : hydratable.html,
      stream: await streamToString(makeVNode()),
    };
  });
}

// The attributes an element ends up with, as a browser sees them. Server markup
// is PARSED, not string-compared, because parsing is what decides whether an
// attribute name means anything.
function attrsOf(el) {
  return Object.fromEntries([...el.attributes].map(a => [a.name, a.value]));
}

function parsedRoot(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.firstElementChild;
}

function clientRoot(vnode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mount(vnode, host);
  flushSync();
  const root = host.firstElementChild;
  host.remove();
  return root;
}

const CASES = [
  ['label htmlFor', () => h('label', { htmlFor: 'email' }, 'Email'), { for: 'email' }],
  ['output htmlFor', () => h('output', { htmlFor: 'a b' }), { for: 'a b' }],
  ['meta httpEquiv', () => h('meta', { httpEquiv: 'refresh', content: '5' }), { 'http-equiv': 'refresh', content: '5' }],
  ['form acceptCharset', () => h('form', { acceptCharset: 'utf-8' }), { 'accept-charset': 'utf-8' }],
  ['className', () => h('span', { className: 'x' }), { class: 'x' }],
  ['case-only names', () => h('input', { tabIndex: 3, maxLength: 5, readOnly: true }), { tabindex: '3', maxlength: '5', readonly: '' }],
];

describe('SSR renames prop aliases the way the client does', () => {
  it('renders <label htmlFor="email"> as for="email"', async () => {
    const html = await asServer(() => renderToString(h('label', { htmlFor: 'email' }, 'Email')));
    assert.equal(html, '<label for="email">Email</label>');
  });

  for (const [name, makeVNode, expected] of CASES) {
    it(`${name}: every server path yields the attributes a client render has`, async () => {
      const client = attrsOf(clientRoot(makeVNode()));
      assert.deepEqual(client, expected, 'the client oracle itself');

      const rendered = await renderAllPaths(makeVNode);
      for (const [path, html] of Object.entries(rendered)) {
        assert.deepEqual(attrsOf(parsedRoot(html)), client, `${path}: ${html}`);
      }
    });
  }

  it('renames a reactive alias too', async () => {
    const id = signal('pw');
    const rendered = await renderAllPaths(() => h('label', { htmlFor: () => id() }, 'Password'));
    for (const [path, html] of Object.entries(rendered)) {
      assert.match(html, /<label for="pw">/, `${path}: ${html}`);
    }
  });
});

describe('a server-rendered alias survives hydration', () => {
  it('keeps the label associated with its control, on the same node, without warnings', async () => {
    const makeVNode = () => h('form', {},
      h('label', { htmlFor: 'email' }, 'Email'),
      h('input', { id: 'email', type: 'email' }),
      h('meta', { httpEquiv: 'refresh', content: '5' }),
    );
    const html = await asServer(() => renderToString(makeVNode()));

    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = html;
    const labelBefore = container.querySelector('label');

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(' ')); };
    try {
      hydrate(makeVNode(), container);
      flushSync();
    } finally {
      console.warn = originalWarn;
    }

    const label = container.querySelector('label');
    assert.equal(label, labelBefore, 'hydration reused the server node');
    assert.equal(label.getAttribute('for'), 'email');
    assert.equal(label.hasAttribute('htmlfor'), false);
    assert.equal(label.control, container.querySelector('#email'), 'the label is associated with the input');
    assert.equal(container.querySelector('meta').getAttribute('http-equiv'), 'refresh');
    assert.deepEqual(warnings, []);
    container.remove();
  });
});
