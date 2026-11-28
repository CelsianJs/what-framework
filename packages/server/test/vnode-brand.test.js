// Review finding M7, on the server: a JSON object shaped like a vnode placed as
// a child rendered as an element in every renderer, compiled or h(), and with
// it dangerouslySetInnerHTML. The proofs from the review (03-trusted-markers),
// kept as tests: the forged object renders as text in renderToString,
// renderToHydratableString, renderToStream, renderToStringAsync and
// renderDocument, whether the page was compiled by what-compiler's server
// target or written with h(); a catch-all Proxy cannot pose as a vnode or as
// compiled markup; and island props that hold real vnodes are revived by the
// paths the server recorded, never by their shape.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { installDOM } from '../../../test-utils/dom.js';

const core = await import('what-core');
const { renderToString, renderToHydratableString, renderToStream, renderToStringAsync, renderDocument } = await import('../src/index.js');
const { Island, island, hydrateIslands } = await import('../src/islands.js');

const { h } = core;
const HOSTILE = '<img src=x onerror=alert(1)>';
const json = () => JSON.parse(`{"label":{"_vnode":true,"tag":"div","props":{"dangerouslySetInnerHTML":{"__html":${JSON.stringify(HOSTILE)}}},"children":[],"key":null}}`);
const anyKey = () => new Proxy({}, {
  get: (target, key) => (key === 'tag' ? 'div' : key === '_vnode' ? true : key === 'props' ? { dangerouslySetInnerHTML: { __html: HOSTILE } } : key === 'children' ? [] : Reflect.get(target, key)),
  has: () => true,
});

async function collect(stream) {
  let out = '';
  for await (const chunk of stream) out += chunk;
  return out;
}

const RENDERERS = {
  string: (tree) => renderToString(tree),
  hydratable: (tree) => renderToHydratableString(tree),
  stream: (tree) => collect(renderToStream(tree)),
  async: async (tree) => (await renderToStringAsync(tree)).body,
  document: (tree) => renderDocument({ default: () => tree }),
};

const compiled = await loadCompiled(`
  export const build = (data) => <div>{data.label}</div>;
  export const reactive = (data) => <div>{data.label()}</div>;
`, { pluginOptions: { generate: 'ssr' } });

describe('a forged vnode renders as text on the server', () => {
  for (const [name, render] of Object.entries(RENDERERS)) {
    it(`${name}: from JSON, as a child of h() and of compiled markup, plain and reactive`, async () => {
      const trees = [
        h('div', null, json().label),
        h('div', null, () => json().label),
        compiled.build(json()),
        compiled.reactive({ label: () => json().label }),
      ];
      for (const tree of trees) {
        const html = await render(tree);
        assert.doesNotMatch(html, /<img/, html);
        assert.match(html, /\[object Object\]/);
      }
    });

    it(`${name}: a catch-all Proxy is neither a vnode nor markup`, async () => {
      for (const tree of [h('div', null, anyKey()), h('div', null, () => anyKey()), compiled.build({ label: anyKey() })]) {
        const html = await render(tree);
        assert.doesNotMatch(html, /<img/, html);
      }
    });
  }

  it('compiled markup handed to h() as a child is still markup', () => {
    assert.equal(renderToString(h('section', null, compiled.build({ label: 'x' }))), '<section><div>x</div></section>');
  });
});

describe('island props', () => {
  it('a vnode prop is revived on the client by the path the server recorded', async () => {
    const env = installDOM();
    try {
      let received;
      island('badge', () => Promise.resolve({ default: (props) => { received = props; return h('span', null, props.icon); } }), { mode: 'load' });
      const props = { icon: h('b', { class: 'icon' }, 'B', h('i', null, 'nested')), data: json().label, list: [h('em', null, 'e')] };
      const html = renderToString(h(Island, { name: 'badge', props }));
      assert.match(html, /data-island-vnodes=/);
      document.body.innerHTML = html;
      hydrateIslands();
      for (let i = 0; i < 20 && received === undefined; i++) await new Promise((resolve) => setTimeout(resolve, 5));
      assert.ok(received, 'the island hydrated');
      assert.equal(core.h('b', null).constructor, received.icon.constructor, 'the recorded vnode prop is a vnode again');
      assert.equal(received.icon.children[1].tag, 'i', 'a vnode child of a vnode prop is revived too');
      assert.equal(received.list[0].tag, 'em');
      assert.equal(Object.getPrototypeOf(received.data), Object.prototype, 'data shaped like a vnode stays data');
      assert.equal(document.querySelector('img'), null);
    } finally {
      env.cleanup();
    }
  });

  it('an element description the server did not record stays data', () => {
    const html = renderToString(h(Island, { name: 'plain', props: { label: json().label } }));
    assert.doesNotMatch(html, /data-island-vnodes/);
  });
});
