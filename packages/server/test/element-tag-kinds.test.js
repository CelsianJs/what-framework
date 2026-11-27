// The h() renderers write an element whose tag name asks for no further rule
// straight from the name's cached record (html.js tagInfo, TAG_PLAIN), and
// send every other element through the full rules. These pin the elements
// whose names carry a rule, in a tree with plain elements around them, on
// every server path: the leading newline the parser drops, text-only and
// raw-text content, the namespaces that decide whether a <style> or <script>
// holds raw text, form fields and void elements.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { renderToString, renderToHydratableString, renderToStream } from '../src/index.js';
import { collect } from './stream-helpers.js';

const css = 'a > b { content: "<" }';

const cases = {
  'leading newline': [
    () => h('div', null, h('pre', null, '\nx'), h('listing', null, 'y'), h('textarea', null, 'z'), h('p', null, 'w')),
    '<div><pre>\n\nx</pre><listing>\ny</listing><textarea>\nz</textarea><p>w</p></div>',
  ],
  'text-only and raw text in HTML': [
    () => h('div', null, h('title', null, 'a < b'), h('style', null, css), h('script', null, 'a < b'), h('span', null, 'a < b')),
    '<div><title>a &lt; b</title><style>a > b { content: "<" }</style><script>a < b</script><span>a &lt; b</span></div>',
  ],
  'MathML text points outside <math>': [
    () => h('div', null, h('mglyph', null, h('style', null, css)), h('malignmark', null, h('script', null, 'a < b')), h('b', null, h('style', null, css))),
    '<div><mglyph><style>a > b { content: "&lt;" }</style></mglyph><malignmark><script>a &lt; b</script></malignmark><b><style>a > b { content: "<" }</style></b></div>',
  ],
  'MathML and its HTML integration points': [
    () => h('math', null, h('mi', null, h('style', null, css)), h('annotation-xml', { encoding: 'text/html' }, h('style', null, css)), h('style', null, css)),
    '<math><mi><style>a > b { content: "<" }</style></mi><annotation-xml encoding="text/html"><style>a > b { content: "<" }</style></annotation-xml><style>a > b { content: "&lt;" }</style></math>',
  ],
  'SVG and foreignObject': [
    () => h('div', null, h('svg', null, h('style', null, css), h('foreignObject', null, h('style', null, css))), h('style', null, css)),
    '<div><svg><style>a > b { content: "&lt;" }</style><foreignObject><style>a > b { content: "<" }</style></foreignObject></svg><style>a > b { content: "<" }</style></div>',
  ],
  'form fields, options and void elements': [
    () => h('form', null,
      h('input', { value: 'v', defaultValue: 'd' }),
      h('select', { value: 'b' }, h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B')),
      h('textarea', { defaultValue: 't' }),
      h('img', { alt: 'i' }),
      h('br', null),
      h('span', { class: 'after' }, 's')),
    '<form><input value="v"><select><option value="a">A</option><option value="b" selected>B</option></select><textarea>\nt</textarea><img alt="i"><br><span class="after">s</span></form>',
  ],
};

describe('elements whose tag names carry a rule', () => {
  for (const [name, [tree, expected]] of Object.entries(cases)) {
    it(`${name}: the same markup on every server path`, async () => {
      assert.equal(renderToString(tree()), expected);
      assert.equal(renderToHydratableString(tree()), expected);
      assert.equal(await collect(renderToStream(tree())), expected);
    });
  }
});
