// Invalid HTML nesting is a compile error, with the file, line and column of
// the element the parser would move. Static markup is parsed by a real HTML
// parser (templates on the client, the response on the server), and the
// nestings below are the ones it restructures, so the tree it builds would not
// be the tree the JSX describes. The development check at first render
// (ERR_INVALID_HTML_NESTING in render.js) only caught some of them, and only
// when that template ran.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileJSX } from '../../../test-utils/compile.js';

const compileBoth = (jsx) => {
  const source = `export const view = () => (\n  ${jsx}\n);`;
  return ['dom', 'ssr'].map(generate => {
    try {
      compileJSX(source, { filename: '/app/src/View.jsx', pluginOptions: { generate } });
      return null;
    } catch (error) {
      return error;
    }
  });
};

const INVALID = [
  ['<p> holding a block element', '<p>Intro<div>body</div></p>', 'p', 'div'],
  ['<p> holding a block element through phrasing content', '<p><span><ul><li>x</li></ul></span></p>', 'p', 'ul'],
  ['a link inside a link', '<a href="/a"><span><a href="/b">b</a></span></a>', 'a', 'a'],
  ['a row directly in a table', '<table><tr><td>x</td></tr></table>', 'table', 'tr'],
  ['a cell directly in a table section', '<table><tbody><td>x</td></tbody></table>', 'tbody', 'td'],
  ['a cell outside a table', '<div><td>x</td></div>', 'div', 'td'],
  ['text directly in a table', '<table>text<tbody></tbody></table>', 'table', '#text'],
  ['a list item directly in a list item', '<ul><li>a<div><li>b</li></div></li></ul>', 'li', 'li'],
  ['a definition inside a definition', '<dl><dt>a<dd>b</dd></dt></dl>', 'dt', 'dd'],
  ['a heading inside a heading', '<h1><h2>x</h2></h1>', 'h1', 'h2'],
  ['a form inside a form', '<form><div><form></form></div></form>', 'form', 'form'],
  ['a button inside a button', '<button><span><button>x</button></span></button>', 'button', 'button'],
  ['an option inside an option', '<select><option><option>x</option></option></select>', 'option', 'option'],
  ['an element inside <textarea>', '<textarea><b>x</b></textarea>', 'textarea', 'b'],
  ['content inside a void element', '<input>text</input>', 'input', '#text'],
  ['an HTML element directly inside SVG', '<svg><div>x</div></svg>', 'svg', 'div'],
  ['an HTML element inside a MathML row', '<math><mrow><span>x</span></mrow></math>', 'mrow', 'span'],
  ['bad nesting inside a conditional branch', '<div>{ok && <p><div>x</div></p>}</div>', 'p', 'div'],
  // Checked against Chromium and jsdom: each one is restructured by both.
  ['a colored <font> inside SVG', '<svg><font color="red">x</font></svg>', 'svg', 'font'],
  ['an input inside a select', '<select><input /></select>', 'select', 'input'],
  ['an rp inside an rt', '<ruby>a<rt>b<rp>(</rp></rt></ruby>', 'rt', 'rp'],
  ['an rt inside an rb', '<ruby><rb>a<rt>b</rt></rb></ruby>', 'rb', 'rt'],
  ['a nobr inside a nobr', '<nobr><span><nobr>x</nobr></span></nobr>', 'nobr', 'nobr'],
  ['a visible input in a table', '<table><input /></table>', 'table', 'input'],
];

// The server target writes a child expression's JSX and static text into its
// parent's markup, where the parser restructures them as it would static
// markup. The DOM target inserts them at run time, which it does not.
const SERVER_ONLY_INVALID = [
  ['a block element in a conditional child of <p>', '<p>{ok && <div>inserted</div>}</p>', 'p', 'div'],
  ['a block element in either arm of a ternary', '<p>{ok ? <span>a</span> : <ul><li>b</li></ul>}</p>', 'p', 'ul'],
  ['rows a .map() writes straight into a table', '<table>{rows.map(r => <tr><td>{r}</td></tr>)}</table>', 'table', 'tr'],
  ['static text written as an expression in a row', '<table><tbody><tr>{"x"}</tr></tbody></table>', 'tr', '#text'],
];

const VALID = [
  '<div><p>Intro<span>x</span></p><ul><li>a<ul><li>b</li></ul></li></ul></div>',
  '<table><caption>c</caption><thead><tr><th>h</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>',
  '<p>{ok && <span>phrasing content</span>}</p>',
  '<p><Box><div>a component renders its own markup</div></Box></p>',
  '<p><button><div>a button closes the scope</div></button></p>',
  '<template><tr><td>x</td></tr></template>',
  '<svg><foreignObject><div>html</div></foreignObject></svg>',
  '<math><mtext><span>html</span></mtext></math>',
  '<table><tbody>{rows().map(r => <tr key={r}><td>{r}</td></tr>)}</tbody></table>',
  '<a href="/x"><span>link</span></a>',
  // Checked against Chromium and jsdom: each one is kept as written.
  '<p><select><hr /></select></p>',
  '<table><input type="hidden" /></table>',
  '<table><tbody><tr><input type="HIDDEN" /></tr></tbody></table>',
  '<svg><font>plain</font></svg>',
  '<ruby><rtc><rt>a</rt></rtc></ruby>',
];

describe('compile-time HTML nesting validation', () => {
  for (const [name, jsx, parent, child] of INVALID) {
    it(`rejects ${name} in both targets`, () => {
      for (const error of compileBoth(jsx)) {
        assert.ok(error, `expected a compile error for ${jsx}`);
        assert.equal(error.code, 'ERR_INVALID_HTML_NESTING');
        assert.match(error.message, new RegExp(`<${parent}> cannot contain <${child.replace('#', '#')}>`));
        assert.match(error.message, /ERR_INVALID_HTML_NESTING at \/app\/src\/View\.jsx:2:\d+: /);
        assert.match(error.message, /> 2 \|/, 'the code frame points at the offending line');
      }
    });
  }

  for (const [name, jsx, parent, child] of SERVER_ONLY_INVALID) {
    it(`rejects ${name} in the server target only`, () => {
      const [dom, ssr] = compileBoth(jsx);
      assert.equal(dom, null, dom && dom.message);
      assert.ok(ssr, `expected a server compile error for ${jsx}`);
      assert.equal(ssr.code, 'ERR_INVALID_HTML_NESTING');
      assert.match(ssr.message, new RegExp(`<${parent}> cannot contain <${child}>`));
    });
  }

  it('reports the exact position of the offending element', () => {
    const [error] = compileBoth('<p>Intro<div>body</div></p>');
    assert.deepEqual(error.loc, { file: '/app/src/View.jsx', line: 2, column: 10 });
    assert.match(error.message, /ERR_INVALID_HTML_NESTING at \/app\/src\/View\.jsx:2:11: <p> cannot contain <div>/);
  });

  for (const jsx of VALID) {
    it(`accepts ${jsx.slice(0, 60)}`, () => {
      for (const error of compileBoth(jsx)) assert.equal(error, null, error && error.message);
    });
  }
});
