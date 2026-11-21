// <style> and <script> hold raw text: the parser decodes nothing in them and
// only the closing sequence ends them, so HTML-escaping their text corrupts it
// (`a &amp;&amp; b` is not JavaScript). Every server path writes it as it is,
// with the two sequences that could end the element (`</`, and `<!--` in a
// script) encoded the way CSS, JavaScript and JSON read as the same text. In
// SVG or MathML the same elements are parsed as markup, so there the text is
// escaped. Compiled and h() output are the same bytes, and static text a
// compiler would have to change is a compile error instead.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { renderToString, renderToHydratableString, renderToStream, renderToStringAsync } = await import('../src/index.js');
const { h } = await import('what-framework');

async function streamed(tree) {
  let html = '';
  for await (const chunk of renderToStream(tree, { onError: () => {} })) html += chunk;
  return html;
}

async function everyRenderer(make) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return [
      renderToString(make()),
      renderToHydratableString(make()).replace(/ data-hk="h\d+"/g, ''),
      await streamed(make()),
      (await renderToStringAsync(make(), undefined, { onError: () => {} })).body,
    ];
  } finally {
    console.warn = warn;
  }
}

// What a browser builds from the markup.
const parse = (html) => new JSDOM(`<!DOCTYPE html><body>${html}`).window.document;

const compiled = await loadCompiled(`
  export const style = (css) => <style>{css}</style>;
  export const script = (code) => <script type="application/json">{code}</script>;
  export const fixed = () => <style>{".a > .b { content: 'x' }"}</style>;
  export const mixed = (css) => <style>{".a{"}{css}{"}"}</style>;
  export const svg = (css) => <svg><style>{css}</style></svg>;
  export const islandOfHtml = (css) => <svg><foreignObject><style>{css}</style></foreignObject></svg>;
  export const reactive = (css) => <style>{css()}</style>;
  export const textarea = (v) => <textarea>{v}</textarea>;
`, { pluginOptions: { generate: 'ssr' } });

describe('raw-text elements: the text is written as it is', () => {
  it('CSS and JavaScript keep their characters, in every renderer, compiled and h() alike', async () => {
    const css = '.a > .b { content: "x" } .c::after { content: \'&\' }';
    for (const html of [...await everyRenderer(() => compiled.style(css)), ...await everyRenderer(() => h('style', null, css))]) {
      assert.equal(html, `<style>${css}</style>`);
    }
    const js = 'if (a && b < c) run("x");';
    for (const html of await everyRenderer(() => h('script', null, js))) assert.equal(html, `<script>${js}</script>`);
  });

  it('static text needs no run-time step and matches the h() spelling', async () => {
    const code = compileJSX(`const a = <style>{".a > .b { content: 'x' }"}</style>;`, { pluginOptions: { generate: 'ssr' } });
    assert.match(code, /_\$ssr\(\["<style>\.a > \.b \{ content: 'x' \}<\/style>"\]\)/);
    assert.equal(renderToString(compiled.fixed()), renderToString(h('style', null, ".a > .b { content: 'x' }")));
  });

  it('a value that would end the element is encoded, so the page keeps its structure and the text its meaning', async () => {
    const value = 'x</style><img src=x onerror=alert(1)><!--';
    for (const html of [...await everyRenderer(() => compiled.style(value)), ...await everyRenderer(() => h('style', null, value))]) {
      const doc = parse(html);
      assert.equal(doc.querySelector('img'), null, html);
      assert.equal(doc.querySelector('style').textContent, 'x<\\/style><img src=x onerror=alert(1)><!--');
    }
    const data = JSON.stringify({ html: '</script><img src=x onerror=alert(2)>', comment: '<!--<script>' });
    for (const html of [...await everyRenderer(() => compiled.script(data)), ...await everyRenderer(() => h('script', { type: 'application/json' }, data))]) {
      const doc = parse(html);
      assert.equal(doc.querySelector('img'), null, html);
      assert.deepEqual(JSON.parse(doc.querySelector('script').textContent), JSON.parse(data), 'the JSON reads the same');
    }
  });

  it('the encoding applies to the text as a whole, across static and dynamic pieces', async () => {
    for (const html of await everyRenderer(() => compiled.mixed('</style><img src=x onerror=alert(3)>'))) {
      assert.equal(parse(html).querySelector('img'), null, html);
    }
    // A sequence split between two pieces is still found.
    const split = await loadCompiled('export const a = (rest) => <style>{"<"}{rest}</style>;', { pluginOptions: { generate: 'ssr' } });
    for (const html of await everyRenderer(() => split.a('/style><img src=x onerror=alert(4)>'))) assert.equal(parse(html).querySelector('img'), null, html);
  });

  it('a reactive child is resolved where the element is placed, without hydration markers', async () => {
    for (const html of await everyRenderer(() => compiled.reactive(() => 'a > b'))) assert.equal(html, '<style>a > b</style>');
    for (const html of await everyRenderer(() => compiled.reactive(() => { throw new Error('css'); }))) assert.equal(html, '<style></style>');
  });

  it('inside SVG the elements are markup, so their text is escaped; inside <foreignObject> it is raw again', async () => {
    const value = '<img src=x onerror=alert(5)> & a > b';
    for (const html of [...await everyRenderer(() => compiled.svg(value)), ...await everyRenderer(() => h('svg', null, h('style', null, value)))]) {
      assert.equal(html, '<svg><style>&lt;img src=x onerror=alert(5)> &amp; a > b</style></svg>');
      assert.equal(parse(html).querySelector('img'), null);
    }
    for (const html of [...await everyRenderer(() => compiled.islandOfHtml('a > b')), ...await everyRenderer(() => h('svg', null, h('foreignObject', null, h('style', null, 'a > b'))))]) {
      assert.equal(html, '<svg><foreignObject><style>a > b</style></foreignObject></svg>');
    }
  });

  it('a compiled <style> placed inside an h() <svg> is escaped too', async () => {
    for (const html of await everyRenderer(() => h('svg', null, compiled.style('<img src=x onerror=alert(6)>')))) {
      assert.equal(parse(html).querySelector('img'), null, html);
      assert.match(html, /&lt;img/);
    }
  });

  it('<textarea> and <title> are still escaped: the parser decodes them', async () => {
    // The newline after <textarea> is the one the parser drops (markup-rules.js).
    for (const html of await everyRenderer(() => compiled.textarea('a & </textarea><b>'))) assert.equal(html, '<textarea>\na &amp; &lt;/textarea&gt;&lt;b&gt;</textarea>');
  });
});

describe('raw-text elements: static text a compiler would have to change is refused', () => {
  for (const generate of ['ssr', 'dom']) {
    it(`${generate} target: a static "</" or "<!--" in a <script>, a "</" in a <style>`, () => {
      for (const jsx of ['<script>{"a</script>"}</script>', '<script>{"<!--"}</script>', '<style>{"a</style>"}</style>']) {
        if (generate === 'dom' && jsx.includes('{')) continue;
        assert.throws(() => compileJSX(`const a = ${jsx};`, { pluginOptions: { generate } }), (e) => e.code === 'ERR_UNSAFE_STATIC_MARKUP', jsx);
      }
      assert.throws(() => compileJSX('const a = <script>a &lt;/script&gt;</script>;', { pluginOptions: { generate } }), (e) => e.code === 'ERR_UNSAFE_STATIC_MARKUP');
    });
  }

  it('the DOM target writes static script text as it is', async () => {
    const { installDOM } = await import('../../../test-utils/dom.js');
    installDOM('<!DOCTYPE html><html><head></head><body></body></html>');
    const client = await loadCompiled('export const a = () => <script>if (a &amp;&amp; b) run()</script>;');
    const host = document.createElement('div');
    host.append(client.a());
    assert.equal(host.querySelector('script').textContent, 'if (a && b) run()');
  });
});
