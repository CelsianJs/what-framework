// A React island's server markup (src/server.js, src/markup.js) against
// React's: react-dom 19.3.0's renderToString of the same elements, written
// here as it printed them (2026-11-24). Compared as the browser reads it
// (the elements, their attributes and values after parsing), which is what a
// user, a stylesheet or a library sees. What differs only in the HTML text
// (a bare boolean where React writes ="", &#39; for &#x27;, attribute order,
// the text separators, React 19's hoisted <link>/<style>/<title>) is listed
// in REACT-COMPAT.md, Known limitations.
// Run: node --test packages/react-compat/test/island-server.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();
globalThis.__WHAT_DEV__ = true;

const here = path.dirname(fileURLToPath(import.meta.url));
const pk = path.resolve(here, '../..');
const server = await import(path.join(pk, 'server/src/index.js'));
const { h } = await import(path.join(pk, 'core/src/index.js'));
const React = await import('../src/index.js');
const { ReactIsland } = await import('../src/mixed.js');
const { createElement: e, useSyncExternalStore } = React;

function serverHtml(view) {
  return server.renderToString(h(ReactIsland, { view }));
}

// Each element under `html`, as the browser reads it: tag and attributes (sorted).
function parsed(html) {
  const box = document.createElement('div');
  box.innerHTML = html;
  return [...box.querySelectorAll('*')].map((el) => [el.localName, ...[...el.attributes].map((a) => `${a.name}=${a.value}`).sort()].join(' '));
}

function sameAsReact(view, reactHtml) {
  assert.deepEqual(parsed(serverHtml(view)), parsed(reactHtml));
}

test('custom elements: an object, an array, a function or false is no attribute; true is ""', () => {
  sameAsReact(
    () => e('div', { title: { a: 1 }, 'data-o': { a: 1 } }, e('my-el', { config: { a: 1 }, list: [1, 2], fn: () => 1, on: true, off: false, n: 3, s: 'x' })),
    '<div title="[object Object]" data-o="[object Object]"><my-el on="" n="3" s="x"></my-el></div>',
  );
});

test('booleans: written on boolean attributes only; data-* and aria-* as text', () => {
  sameAsReact(
    () => e('div', { title: true, lang: false, 'data-a': true, 'aria-b': false, hidden: true, inert: false, translate: 'no' }),
    '<div data-a="true" aria-b="false" hidden="" translate="no"></div>',
  );
  sameAsReact(
    () => e('div', null, e('a', { download: true }), e('a', { download: false }), e('a', { download: 'f.txt' }), e('input', { capture: true }), e('input', { capture: 'user' })),
    '<div><a download=""></a><a></a><a download="f.txt"></a><input capture=""/><input capture="user"/></div>',
  );
});

test('draggable, spellCheck and contentEditable write "true" and "false"', () => {
  sameAsReact(
    () => e('div', { draggable: false, spellCheck: false, contentEditable: false, suppressContentEditableWarning: true }, e('img', { draggable: true, src: 'a' }), e('div', { spellCheck: true, contentEditable: 'plaintext-only', suppressContentEditableWarning: true })),
    '<div draggable="false" spellCheck="false" contentEditable="false"><img draggable="true" src="a"/><div spellCheck="true" contentEditable="plaintext-only"></div></div>',
  );
  sameAsReact(() => e('svg', { focusable: false }), '<svg focusable="false"></svg>');
});

test('selected only on an <option>; numbers React leaves out', () => {
  sameAsReact(
    () => e('div', null, e('input', { selected: true }), e('div', { selected: true }), e('select', { defaultValue: 'o' }, e('option', { value: 'o' }, 'o'))),
    '<div><input/><div></div><select><option value="o" selected="">o</option></select></div>',
  );
  sameAsReact(
    () => e('table', null, e('tbody', null, e('tr', null, e('td', { rowSpan: 0, colSpan: 'x' }, 'a'), e('td', { rowSpan: NaN }, 'b'))), e('colgroup', { span: 0 })),
    '<table><tbody><tr><td rowSpan="0" colSpan="x">a</td><td>b</td></tr></tbody><colgroup></colgroup></table>',
  );
  sameAsReact(() => e('div', { defaultValue: 'd', defaultChecked: true, value: 'v' }), '<div value="v"></div>');
});

test('attribute names: xlink:href and xml:lang in SVG, tabindex, crossorigin', () => {
  const html = serverHtml(() => e('svg', null, e('use', { xlinkHref: '#a', xlinkTitle: 't', xmlLang: 'en', xmlSpace: 'preserve' })));
  assert.match(html, /<use xlink:href="#a" xlink:title="t" xml:lang="en" xml:space="preserve">/);
  const box = document.createElement('div');
  box.innerHTML = html;
  assert.equal(box.querySelector('use').getAttributeNS('http://www.w3.org/1999/xlink', 'href'), '#a', 'the link an SVG <use> follows');
  assert.match(serverHtml(() => e('div', { tabIndex: 0, crossOrigin: 'anonymous' })), /<div tabindex="0" crossorigin="anonymous">/);
});

test('style: React\'s unitless properties, values trimmed', () => {
  // react-dom 19.3.0 (isUnitlessNumber), the same style object:
  const react = 'aspect-ratio:1.5;columns:2;scale:2;stroke-width:2;stroke-dasharray:4;tab-size:4;border-image-width:2;grid-gap:10px;column-width:100px;flex-basis:0;flex-order:2;box-ordinal-group:1;--x:v;margin:3px;-webkit-line-clamp:2;-ms-flex:1;zoom:2;line-height:1.2';
  const html = serverHtml(() => e('div', { style: { aspectRatio: 1.5, columns: 2, scale: 2, strokeWidth: 2, strokeDasharray: 4, tabSize: 4, borderImageWidth: 2, gridGap: 10, columnWidth: 100, flexBasis: 0, flexOrder: 2, boxOrdinalGroup: 1, '--x': ' v ', margin: ' 3px ', WebkitLineClamp: 2, msFlex: 1, zoom: 2, lineHeight: 1.2 } }));
  assert.equal(html.match(/style="([^"]*)"/)[1], react);
});

test('useSyncExternalStore without getServerSnapshot: React\'s error on the server, and the island renders in the browser', () => {
  // react-dom 19.3.0: renderToString throws "Missing getServerSnapshot,
  // which is required for server-rendered content. Will revert to client
  // rendering."
  function Reader() { return e('b', null, useSyncExternalStore(() => () => {}, () => 'client')); }
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => warnings.push(a.map(String).join(' '));
  let html;
  try {
    html = serverHtml(() => e(Reader));
  } finally {
    console.warn = warn;
  }
  assert.equal(html.includes('client'), false, 'getSnapshot is not read on the server');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Missing getServerSnapshot, which is required for server-rendered content\. Will revert to client rendering\./);
  // With one, the server reads it.
  function Served() { return e('b', null, useSyncExternalStore(() => () => {}, () => 'client', () => 'server')); }
  assert.match(serverHtml(() => e(Served)), /<b>server<\/b>/);
});
