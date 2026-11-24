// The server target and a `.map()` row's reactive attributes.
//
//   {rows.map(row => <tr key={row.id} class={sel() === row.id ? 'on' : ''}>…</tr>)}
//
// h() is handed the class as a thunk made for each row and calls it where the
// row is placed. The server target writes that thunk once for the list, as a
// function of the row's item, and each row passes its item (ssr.js
// rowAttributes): no closure per row, the same expression run at the same
// point with the same item. So the output and the order of every side effect
// stay those of the h() spelling in every renderer, which is what this file
// holds, with the shapes that must not be hoisted.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { content, keyShape, stableIds } from '../../server/test/stream-helpers.js';

const { renderToString, renderToHydratableString, renderToStream, renderToStringAsync } = await import('../../server/src/index.js');
const { h } = await import('what-framework');

const ssr = { pluginOptions: { generate: 'ssr' } };
const compile = (source) => compileJSX(source, ssr);
const flat = (code) => code.replace(/\s+/g, ' ');

describe('server target: a row\'s reactive attribute is one function for its list', () => {
  it('a keyed row passes its item, and the list holds the function', () => {
    const code = flat(compile(`
      export const List = (props) => <ul>{props.rows().map(row => <li key={row.id} class={props.sel() === row.id ? 'on' : ''}>{row.name}</li>)}</ul>;
    `));
    assert.match(code, /_\$ssrTemplate\(\["<li", ">", "<\/li>"\], \[\["class", "class", 0\], null\]\)/);
    assert.match(code, /row => _\$ssrRow\(_tmpl\$\d+, row, _\$ssrText\(row\.name\)\), true, row => row\.id, \d+, \[row => props\.sel\(\) === row\.id \? 'on' : ''\]\)/);
  });

  it('an unkeyed row too, with no key function and no number before its functions', () => {
    const code = flat(compile(`
      export const List = (props) => <ul>{props.rows.map(row => <li class={cls(row)} title={row.name}>x</li>)}</ul>;
    `));
    assert.match(code, /_\$ssrList\(props\.rows, row => _\$ssrRow\(_tmpl\$\d+, row, row\.name\), (?:true|false), null, void 0, \[row => cls\(row\)\]\)/);
    assert.match(code, /\[\["class", "class", 0\], \["plain", "title"\]\]/);
  });

  it('every reactive attribute of the row\'s template, its inner elements\' too, in source order', () => {
    const code = flat(compile(`
      export const List = (props) => <ul>{props.rows().map(row => (
        <li key={row.id} class={a(row)} data-n={1}><a href={link(row)} title={row.tags.some(tag => tag === on())}>{row.name}</a><b style={theme()}>!</b></li>
      ))}</ul>;
    `));
    assert.match(code, /\[row => a\(row\), row => link\(row\), row => row\.tags\.some\(tag => tag === on\(\)\), row => theme\(\)\]/);
    assert.match(code, /\[\["class", "class", 0\], \["url", "href", 1\], \["plain", "title", 2\], null, \["style", "style", 3\]\]/);
  });

  it('an inner list\'s rows read the outer row\'s item from the scope its functions are written in', () => {
    const code = flat(compile(`
      export const Grid = (props) => <table><tbody>{props.rows().map(row => (
        <tr key={row.id}>{row.cells.map(cell => <td key={cell.id} class={mark(row, cell)}>{cell.text}</td>)}</tr>
      ))}</tbody></table>;
    `));
    assert.match(code, /cell => _\$ssrRow\(_tmpl\$\d+, cell, _\$ssrText\(cell\.text\)\), true, cell => cell\.id, \d+, \[cell => mark\(row, cell\)\]\)/);
  });

  const KEPT = {
    'the callback\'s index': 'props.rows().map((row, i) => <li key={row.id} class={cls(row, i)}>x</li>)',
    'the callback\'s array': 'props.rows().map((row, i, all) => <li key={row.id} class={cls(all)}>x</li>)',
    'a destructured item': 'props.rows().map(({ id, on }) => <li key={id} class={cls(on)}>x</li>)',
    'an item with a default': 'props.rows().map((row = fallback) => <li class={cls(row)}>x</li>)',
    'an item the row assigns': 'props.rows().map(row => <li key={row.id} class={cls(row = next(row))}>x</li>)',
    'a block body': 'props.rows().map(row => { const c = cls(row); return <li key={row.id} class={c()}>x</li>; })',
    'a function expression': 'props.rows().map(function (row) { return <li key={row.id} class={cls(row)}>x</li>; })',
    'this': 'props.rows().map(row => <li key={row.id} class={this.cls(row)}>x</li>)',
    'arguments': 'props.rows().map(row => <li key={row.id} class={cls(arguments[0], row)}>x</li>)',
  };
  for (const [name, list] of Object.entries(KEPT)) {
    it(`an attribute that reads ${name} stays a thunk of its row`, () => {
      const code = flat(compile(`export function List(props) { return <ul>{${list}}</ul>; }`));
      assert.doesNotMatch(code, /_\$ssrTemplate\([^;]*"class", "class", \d/, code);
      assert.doesNotMatch(code, /_\$ssrList\([^;]*, \[/, code);
    });
  }

  it('a plain attribute stays a plain value, and JSX inside a function inside the row is not the row\'s', () => {
    const code = flat(compile(`
      export const List = (props) => <ul>{props.rows.map(row => <li title={label} class={row.cls}>{wrap(() => <b class={cls(row)} />)}</li>)}</ul>;
    `));
    assert.doesNotMatch(code, /_\$ssrList\([^;]*, \[/, code);
    assert.match(code, /_\$ssrRow\(_tmpl\$\d+, label, row\.cls, /);
    assert.match(code, /wrap\(\(\) => _\$ssr\(_tmpl\$\d+, \(\) => cls\(row\)\)\)/);
  });
});

// --- The same output and order as the h() spelling ----------------------------

const log = [];
globalThis.__rowLog = log;

const mod = await loadCompiled(`
  const log = globalThis.__rowLog;
  const say = (tag, value) => { log.push(tag); return value; };

  function Mark(props) {
    log.push('Mark:' + props.id);
    return <i>{props.id}</i>;
  }

  export const keyed = (rows, sel, lang) => (
    <ul>{rows().map(row => (
      <li key={row.id} class={say('class:' + row.id, sel() === row.id ? 'on' : '')} data-id={say('id:' + row.id, row.id)} lang={lang}>
        <a href={say('href:' + row.id, row.href)} title={say('title:' + row.id, row.title)}>{row.name}</a>
      </li>
    ))}</ul>
  );

  export const withComponents = (rows, sel) => (
    <ul>{rows().map(row => <li key={row.id} class={say('class:' + row.id, sel() === row.id ? 'on' : '')}><Mark id={row.id} /><b title={say('title:' + row.id, row.title)}>{row.name}</b></li>)}</ul>
  );

  export const unkeyed = (rows, sel) => <ol>{rows.map(row => <li class={say('class:' + row.id, sel() === row.id ? 'on' : '')}>{row.name}</li>)}</ol>;

  export const nested = (rows, sel) => (
    <table><tbody>{rows().map(row => (
      <tr key={row.id} class={say('row:' + row.id, sel() === row.id ? 'on' : '')}>
        {row.cells.map(cell => <td key={cell} class={say('cell:' + row.id + cell, sel() === row.id ? cell : '')}>{cell}</td>)}
      </tr>
    ))}</tbody></table>
  );

  export const texts = (items, cls) => <ul>{items().map(item => <li key={item} class={cls(item)} title={item}>{item}</li>)}</ul>;

  export const drawn = (rows, fill) => <svg>{rows().map(row => <circle key={row.id} r={row.r} fill={fill(row)} />)}</svg>;
`, ssr);

const quiet = async (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = warn; }
};

const RENDERERS = {
  string: (tree) => renderToString(tree),
  hydratable: (tree) => keyShape(renderToHydratableString(tree)),
  stream: async (tree) => {
    let html = '';
    for await (const chunk of renderToStream(tree, { onError: () => {} })) html += chunk;
    return keyShape(stableIds(html));
  },
  async: async (tree) => keyShape((await renderToStringAsync(tree, undefined, { onError: () => {} })).body),
};

async function renderAll(make) {
  const out = {};
  for (const [name, render] of Object.entries(RENDERERS)) {
    log.length = 0;
    const html = await quiet(() => render(make()));
    out[name] = { html, order: log.join('>') };
  }
  return out;
}

const say = (tag, value) => { log.push(tag); return value; };

const ROWS = [
  { id: 1, name: 'one', href: '/one?a=1&b=2', title: 'the "first"' },
  { id: 2, name: 'two', href: ' javascript:alert(1)', title: null },
  { id: 3, name: 'three', href: '/three', title: '<b>bold</b>' },
];

describe('server target: a list\'s row functions render as the h() thunks do, in every renderer', () => {
  it('a keyed list: escaped values, a refused URL, a dropped null, in h()\'s order', async () => {
    const compiled = await renderAll(() => mod.keyed(() => ROWS, () => 2, 'en'));
    // What the compiler hands h(): a thunk for every attribute that reads a
    // signal or the keyed row's item, the value itself for any other.
    const expected = await renderAll(() => h('ul', null, () => ROWS.map((row) => h('li', {
      key: row.id, class: () => say('class:' + row.id, 2 === row.id ? 'on' : ''), 'data-id': () => say('id:' + row.id, row.id), lang: 'en',
    }, h('a', { href: () => say('href:' + row.id, row.href), title: () => say('title:' + row.id, row.title) }, row.name)))));
    assert.deepEqual(compiled, expected);
    assert.equal(compiled.string.html,
      '<ul><li class="" data-id="1" lang="en"><a href="/one?a=1&amp;b=2" title="the &quot;first&quot;">one</a></li>'
      + '<li class="on" data-id="2" lang="en"><a>two</a></li>'
      + '<li class="" data-id="3" lang="en"><a href="/three" title="&lt;b&gt;bold&lt;/b&gt;">three</a></li></ul>');
    assert.equal(compiled.string.order, 'class:1>id:1>href:1>title:1>class:2>id:2>href:2>title:2>class:3>id:3>href:3>title:3');
  });

  it('rows that hold a component: each attribute where it stands around it', async () => {
    const compiled = await renderAll(() => mod.withComponents(() => ROWS, () => 3));
    for (const { html, order } of Object.values(compiled)) {
      assert.equal(content(html),
        '<ul><li class=""><i>1</i><b title="the &quot;first&quot;">one</b></li><li class=""><i>2</i><b>two</b></li>'
        + '<li class="on"><i>3</i><b title="&lt;b&gt;bold&lt;/b&gt;">three</b></li></ul>');
      assert.equal(order, 'class:1>Mark:1>title:1>class:2>Mark:2>title:2>class:3>Mark:3>title:3');
    }
  });

  it('an unkeyed list, and a list inside a row', async () => {
    const unkeyed = await renderAll(() => mod.unkeyed(ROWS, () => 1));
    const unkeyedH = await renderAll(() => h('ol', null, () => ROWS.map((row) => h('li', { class: () => say('class:' + row.id, 1 === row.id ? 'on' : '') }, row.name))));
    assert.deepEqual(unkeyed, unkeyedH);
    assert.equal(unkeyed.string.html, '<ol><li class="on">one</li><li class="">two</li><li class="">three</li></ol>');

    const grid = [{ id: 'a', cells: ['x', 'y'] }, { id: 'b', cells: ['z'] }];
    const nested = await renderAll(() => mod.nested(() => grid, () => 'b'));
    for (const { html, order } of Object.values(nested)) {
      assert.equal(content(html), '<table><tbody><tr class=""><td class="">x</td><td class="">y</td></tr><tr class="on"><td class="z">z</td></tr></tbody></table>');
      assert.equal(order, 'row:a>cell:ax>cell:ay>row:b>cell:bz');
    }
  });

  it('a row\'s item is never written as markup, whatever it holds', async () => {
    const items = ['<img src=x onerror=alert(1)>', '"><script>alert(2)</script>', '<!--', 'plain'];
    for (const cls of [(item) => item, () => { throw new Error('no class'); }, () => () => 'a function', () => null, () => false, () => true]) {
      const out = await renderAll(() => mod.texts(() => items, cls));
      for (const { html } of Object.values(out)) {
        assert.ok(!/<img|<script|<!--(?!\$|\/\$|\[\]|\/\[\]|k:)/.test(html.replace(/<!--pl-[^>]*-->/g, '')), html);
        assert.ok(html.includes('title="&lt;img src=x onerror=alert(1)&gt;">&lt;img src=x onerror=alert(1)&gt;</li>'), html);
      }
    }
    const shown = (await renderAll(() => mod.texts(() => items, (item) => item))).string.html;
    assert.ok(shown.startsWith('<ul><li class="&lt;img src=x onerror=alert(1)&gt;" title='), shown);
  });

  it('a source that is not an array, and rows in SVG', async () => {
    const lazy = { map: (fn) => ROWS.map((row, i) => fn(row, i)) };
    const fromObject = await renderAll(() => mod.unkeyed(lazy, () => 2));
    for (const { html } of Object.values(fromObject)) assert.equal(content(html), '<ol><li class="">one</li><li class="on">two</li><li class="">three</li></ol>');

    const circles = [{ id: 1, r: 2 }, { id: 2, r: 3 }];
    const svg = await renderAll(() => mod.drawn(() => circles, (row) => (row.id === 2 ? 'red' : 'none')));
    for (const { html } of Object.values(svg)) assert.equal(content(html), '<svg><circle r="2" fill="none"></circle><circle r="3" fill="red"></circle></svg>');
  });
});
