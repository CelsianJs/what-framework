// classList on the server.
//
// The client folds `classList={{ name: cond }}` into the element's class list
// on every path: compiled JSX, h(), setProp and spread. The server rendered the
// object as an attribute of its own, `classList="[object Object]"`, so the
// markup lacked the classes the client applies, and hydration, which trusts
// static props to be in the markup already, never added them.
//
// The oracle is the client. Each case is rendered through every client path
// and every server path, and the class attribute a browser ends up with must
// be the same. The client semantics are order-sensitive: `class` and
// `className` replace the attribute, `classList` toggles over it, in prop order.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();

const { h, mount, hydrate, signal, flushSync } = await import('what-core');
const { spread, setProp } = await import('what-core/render');
const { renderToString, renderToHydratableString, renderToStream } = await import('../src/index.js');

const compiled = await loadCompiled(`
  export const ClassFirst = (p) => <div class={p.class ?? p.className} classList={p.classList} />;
  export const ListFirst = (p) => <div classList={p.classList} class={p.class ?? p.className} />;
  export const ListOnly = (p) => <div classList={p.classList} />;
  export const Spread = (p) => <div {...p} />;
  export const ClassOnly = (p) => <div class={p.class} />;
  export const SvgClass = (p) => <svg class={p.class} />;
`);

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

function classOf(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.querySelector('div').getAttribute('class');
}

function mounted(node) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmount = mount(node, host);
  flushSync();
  const cls = host.firstElementChild.getAttribute('class');
  unmount();
  host.remove();
  return cls;
}

function element(apply) {
  const el = document.createElement('div');
  apply(el);
  flushSync();
  return el.getAttribute('class');
}

// The compiled spelling of the same props: attribute order follows prop order.
function compiledFor(props) {
  const keys = Object.keys(props);
  if (!keys.includes('class') && !keys.includes('className')) return compiled.ListOnly;
  return keys.indexOf('classList') < Math.max(keys.indexOf('class'), keys.indexOf('className'))
    ? compiled.ListFirst
    : compiled.ClassFirst;
}

const on = signal(true);
const CASES = [
  ['classList alone', () => ({ classList: { a: true, b: false, 'c d': 1 } }), 'a c d'],
  ['class then classList', () => ({ class: 'x a', classList: { a: false, y: true } }), 'x y'],
  ['className then classList', () => ({ className: 'x', classList: { x: true, z: 'yes' } }), 'x z'],
  ['classList then class', () => ({ classList: { a: true }, class: 'b' }), 'b'],
  ['a toggle that changes nothing leaves the text as written', () => ({ class: 'a  a', classList: { a: true, b: false } }), 'a  a'],
  ['nothing on and no class', () => ({ classList: { a: false } }), null],
  ['a null class still sets the attribute', () => ({ class: null, classList: { a: false } }), ''],
  ['reactive class and classList', () => ({ class: () => (on() ? 'p' : 'q'), classList: () => ({ r: on(), s: !on() }) }), 'p r'],
  ['accessor entries', () => ({ class: 'p', classList: { r: () => on(), s: () => !on() } }), 'p r'],
];

describe('the server folds classList into class the way the client does', () => {
  for (const [name, props, expected] of CASES) {
    it(name, async () => {
      const client = {
        'h()': mounted(h('div', props())),
        compiled: mounted(compiledFor(props())(props())),
        spread: element((el) => spread(el, props())),
        setProp: element((el) => { const p = props(); for (const key in p) setProp(el, key, p[key]); }),
      };
      for (const [path, cls] of Object.entries(client)) assert.equal(cls, expected, `client ${path}`);

      const server = await asServer(async () => {
        const hydratable = await renderToHydratableString(h('div', props()));
        return {
          string: await renderToString(h('div', props())),
          hydratable: typeof hydratable === 'string' ? hydratable : hydratable.html,
          stream: await streamToString(h('div', props())),
        };
      });
      for (const [path, html] of Object.entries(server)) {
        assert.equal(classOf(html), expected, `server ${path}: ${html}`);
        assert.ok(!/classList/i.test(html), `server ${path} writes no classList attribute: ${html}`);
      }
    });
  }

  it('hydrates the folded class and keeps it reactive', async () => {
    const flag = signal(true);
    const vnode = () => h('div', { class: 'base', classList: () => ({ live: flag() }) });
    const html = await asServer(() => renderToString(vnode()));
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    hydrate(vnode(), host);
    assert.equal(host.firstElementChild.getAttribute('class'), 'base live');
    flag(false);
    flushSync();
    assert.equal(host.firstElementChild.getAttribute('class'), 'base');
    host.remove();
  });
});

// Under updates the client's class attribute keeps holding the classes the
// server's fold gives for the current values: every client path, mounted once
// and then written to, against a fresh server render after each write. Token
// order may differ after a toggle, as it does for any DOMTokenList, so the
// classes are compared as sets (and an absent attribute as null).
const tokens = (cls) => (cls == null ? null : [...new Set(cls.split(/[\t\n\f\r ]+/).filter(Boolean))].sort().join(' '));

const state = { cls: signal('x a'), on: signal(true) };
const WRITES = [['cls', 'y'], ['on', false], ['cls', 'a b'], ['on', true], ['cls', ''], ['on', false], ['cls', 'b c']];
const UPDATE_CASES = [
  ['reactive class, then classList', () => ({ class: () => state.cls(), classList: { a: true, z: false } })],
  ['reactive class, then reactive classList', () => ({ class: () => state.cls(), classList: () => ({ on: state.on(), a: !state.on() }) })],
  ['reactive class, then accessor entries', () => ({ class: () => state.cls(), classList: { on: () => state.on(), b: () => !state.on() } })],
  ['classList, then reactive class', () => ({ classList: { on: () => state.on() }, class: () => state.cls() })],
  ['class, then a classList whose keys come and go', () => ({ class: 'base a', classList: () => (state.on() ? { a: false, b: true } : { c: true }) })],
  ['a classList alone whose keys come and go', () => ({ classList: () => (state.on() ? { a: true, 'p q': true } : { q: true }) })],
];

function reset() {
  state.cls('x a');
  state.on(true);
  flushSync();
}

async function serverClass(props) {
  return classOf(await asServer(() => renderToString(h('div', props()))));
}

describe('the client keeps the server\'s fold under updates', () => {
  for (const [name, props] of UPDATE_CASES) {
    it(name, async () => {
      reset();
      const hosts = [];
      const elements = {};
      const mountInto = (node) => {
        const host = document.body.appendChild(document.createElement('div'));
        hosts.push(host);
        mount(node, host);
        return host.firstElementChild;
      };
      elements['h()'] = mountInto(h('div', props()));
      elements.compiled = mountInto(compiledFor(props())(props()));
      elements.spread = document.createElement('div');
      spread(elements.spread, props());
      elements.setProp = document.createElement('div');
      for (const [key, value] of Object.entries(props())) setProp(elements.setProp, key, value);
      flushSync();
      try {
        for (const [signalName, value] of [[null, null], ...WRITES]) {
          if (signalName) {
            state[signalName](value);
            flushSync();
          }
          const expected = tokens(await serverClass(props));
          for (const [path, el] of Object.entries(elements)) {
            assert.equal(tokens(el.getAttribute('class')), expected, `client ${path} after ${signalName}=${JSON.stringify(value)}`);
          }
        }
      } finally {
        for (const host of hosts) host.remove();
      }
    });
  }

  for (const [name, props] of UPDATE_CASES) {
    it(`${name}, hydrated`, async () => {
      reset();
      const host = document.body.appendChild(document.createElement('div'));
      host.innerHTML = await asServer(() => renderToString(h('div', props())));
      hydrate(h('div', props()), host);
      try {
        for (const [signalName, value] of [[null, null], ...WRITES]) {
          if (signalName) {
            state[signalName](value);
            flushSync();
          }
          assert.equal(tokens(host.firstElementChild.getAttribute('class')), tokens(await serverClass(props)),
            `after ${signalName}=${JSON.stringify(value)}`);
        }
      } finally {
        host.remove();
      }
    });
  }
});


// Without a classList, a class of null, undefined or false is no attribute on
// the server, so the client writes none either: not `class=""`. Any other
// value is its text on both.
const plain = signal(undefined);
const PLAIN_CASES = [
  ['null', () => ({ class: null }), null],
  ['undefined', () => ({ class: undefined }), null],
  ['false', () => ({ class: false }), null],
  ['an accessor that answers undefined', () => ({ class: () => undefined }), null],
  ['an accessor that answers false', () => ({ class: () => false }), null],
  ['an empty string', () => ({ class: '' }), ''],
  ['zero', () => ({ class: 0 }), '0'],
  ['a classList of undefined', () => ({ class: undefined, classList: undefined }), null],
];

describe('a class of null, undefined or false writes no attribute on either side', () => {
  for (const [name, props, expected] of PLAIN_CASES) {
    it(name, async () => {
      const client = {
        'h()': mounted(h('div', props())),
        compiled: mounted(compiled.ClassOnly(props())),
        spread: element((el) => spread(el, props())),
        setProp: element((el) => { const p = props(); for (const key in p) setProp(el, key, p[key]); }),
      };
      for (const [path, cls] of Object.entries(client)) assert.equal(cls, expected, `client ${path}`);
      const server = await asServer(() => renderToString(h('div', props())));
      assert.equal(classOf(server), expected, `server: ${server}`);
    });
  }

  it('on an SVG element', () => {
    const host = document.body.appendChild(document.createElement('div'));
    mount(compiled.SvgClass({ class: () => plain() }), host);
    const svg = host.firstElementChild;
    assert.equal(svg.getAttribute('class'), null);
    plain('a');
    flushSync();
    assert.equal(svg.getAttribute('class'), 'a');
    plain(undefined);
    flushSync();
    assert.equal(svg.getAttribute('class'), null);
    host.remove();
  });

  it('a reactive class that goes to undefined and back, hydrated', async () => {
    plain(undefined);
    const vnode = () => h('a', { class: () => plain() });
    const host = document.body.appendChild(document.createElement('div'));
    host.innerHTML = await asServer(() => renderToString(vnode()));
    assert.equal(host.innerHTML, '<a></a>');
    hydrate(vnode(), host);
    assert.equal(host.innerHTML, '<a></a>');
    plain('on');
    flushSync();
    assert.equal(host.innerHTML, '<a class="on"></a>');
    plain(false);
    flushSync();
    assert.equal(host.innerHTML, '<a></a>');
    host.remove();
  });

  it('a classList after a class that wrote none composes over an empty attribute', () => {
    const cls = signal(undefined);
    const el = element((node) => {
      setProp(node, 'class', () => cls());
      setProp(node, 'classList', { on: () => plain() });
    });
    assert.equal(el, '');
    const node = document.createElement('div');
    setProp(node, 'class', () => cls());
    setProp(node, 'classList', { on: () => plain() });
    plain(true);
    flushSync();
    assert.equal(node.getAttribute('class'), 'on');
    cls('base');
    flushSync();
    assert.equal(node.getAttribute('class'), 'base on', 'the classList toggles over the class written later');
    cls(null);
    flushSync();
    assert.equal(node.getAttribute('class'), 'on');
    plain(undefined);
    flushSync();
  });
});
