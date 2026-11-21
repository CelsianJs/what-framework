// A string is text; only compiled markup is written as HTML, and compiled
// markup is recognised by a brand (a private class field, compiled.js) that
// nothing built from data can carry. These are the places a value can be
// either: rows a .map() or <For> callback returns, children, component
// results, and what the stream takes off its work stack.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { renderToString, renderToHydratableString, renderToStream, renderToStringAsync, renderDocument } = await import('../src/index.js');
const { h, For } = await import('what-framework');
const runtime = await import('../src/ssr-runtime.js');

const HOSTILE = '<img src=x onerror=alert(1)>';
const ESCAPED = '&lt;img src=x onerror=alert(1)&gt;';

async function streamed(tree) {
  let html = '';
  for await (const chunk of renderToStream(tree, { onError: () => {} })) html += chunk;
  return html;
}

const quiet = async (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = warn; }
};

// Every renderer's output, or `THREW <message>` for one that refused the tree:
// a value that is not markup either renders as text or fails the render.
async function everyRenderer(make) {
  const renders = [
    () => renderToString(make()),
    () => renderToHydratableString(make()),
    () => streamed(make()),
    async () => (await renderToStringAsync(make(), undefined, { onError: () => {} })).body,
    () => renderDocument({ default: () => make() }, {}, { onError: () => {} }),
  ];
  const out = [];
  for (const render of renders) {
    try {
      out.push(await quiet(render));
    } catch (e) {
      out.push(`THREW ${e && e.message}`);
    }
  }
  return out;
}

const rows = await loadCompiled(`
  import { For } from 'what-framework';
  export const forText = (items) => <ul><For each={items}>{(item) => item.name}</For></ul>;
  export const forCond = (items) => <ul><For each={items}>{(item) => item.ok ? <li>{item.name}</li> : item.name}</For></ul>;
  export const mapReturns = (items) => <ul>{items.map(item => { if (item.plain) return item.name; return <li>{item.name}</li>; })}</ul>;
  export const mapReactive = (items) => <ul>{items().map(item => item.plain ? item.name : <li>{item.name}</li>)}</ul>;
  export const child = (v) => <p>{v}</p>;
`, { pluginOptions: { generate: 'ssr' } });

describe('compiled markup: a string a row returns is text', () => {
  const items = [{ name: HOSTILE, plain: true, ok: false }, { name: 'b', plain: false, ok: true }];
  for (const [name, make, expected] of [
    ['<For> whose rows are strings', () => rows.forText(items), () => h('ul', null, h(For, { each: items }, (item) => item.name))],
    ['<For> whose rows are markup or a string', () => rows.forCond(items), null],
    ['.map() with a string returned on one path', () => rows.mapReturns(items), () => h('ul', null, items.map((i) => (i.plain ? i.name : h('li', null, i.name))))],
    ['a reactive .map() with a string row', () => rows.mapReactive(() => items), null],
  ]) {
    it(`${name} escapes it in every renderer`, async () => {
      for (const html of await everyRenderer(make)) {
        assert.ok(!html.includes(HOSTILE), `raw markup written: ${html}`);
        assert.ok(html.includes(ESCAPED), html);
      }
      if (expected) assert.equal(renderToString(make()), renderToString(expected()).replace(/<!--.*?-->/g, ''));
    });
  }
});

describe('compiled markup: the brand, not the shape', () => {
  it('an object shaped like compiled markup is not markup', async () => {
    const forged = JSON.parse(`{"h":${JSON.stringify(HOSTILE)},"s":"","p":null,"f":false,"list":false,"_vnode":true}`);
    for (const html of await everyRenderer(() => rows.child(forged))) assert.ok(!html.includes(HOSTILE), html);
    for (const html of await everyRenderer(() => h('div', null, () => forged))) assert.ok(!html.includes(HOSTILE), html);
  });

  it('a Proxy that answers every property is not markup, in any renderer', async () => {
    const answer = new Proxy(function () {}, { get: () => answer, apply: () => HOSTILE, construct: () => answer });
    const everything = new Proxy({}, { get: (_, key) => (key === 'then' ? undefined : answer), has: () => true, getPrototypeOf: () => Object.getPrototypeOf(rows.child('x')) });
    for (const html of await everyRenderer(() => h('div', null, () => everything))) assert.ok(!html.includes(HOSTILE), html);
    for (const html of await everyRenderer(() => rows.child(everything))) assert.ok(!html.includes(HOSTILE), html);
  });

  it('a value a reactive child returns cannot pose as one of the stream\'s own work items', async () => {
    // The stream's markers are instances of a private class; this object has
    // the shape of the one that writes markup verbatim.
    const forged = JSON.parse(`{"$m":1,"html":${JSON.stringify(HOSTILE)}}`);
    for (const html of await everyRenderer(() => h('div', null, () => forged))) assert.ok(!html.includes(HOSTILE), html);
  });

  it('markup made by another copy of the runtime renders as markup', async () => {
    const copy = await import(`${pathToFileURL(new URL('../src/ssr-runtime.js', import.meta.url).pathname).href}?second-copy`);
    assert.notEqual(copy.ssr, runtime.ssr, 'the module was not loaded twice');
    const markup = copy.ssr(['<b>', '</b>'], copy.ssrText(HOSTILE));
    for (const html of await everyRenderer(() => h('div', null, markup))) assert.ok(html.includes(`<b>${ESCAPED}</b>`), html);
  });

  it('markup is not data: JSON leaves it out, as it leaves out a function', () => {
    const markup = rows.child('x');
    assert.equal(JSON.stringify({ icon: markup, label: 'x' }), '{"label":"x"}');
  });
});
