// The server target and a `.map()` row's reactive attributes.
//
//   {rows.map(row => <tr key={row.id} class={sel() === row.id ? 'on' : ''}>…</tr>)}
//
// h() is handed the class as a thunk made for each row and calls it where the
// row is placed. The server target writes that thunk once for the list, as a
// function of the row's item: the list calls the row's callback with its
// functions, and each row hands them to its template and passes its item
// (ssr.js rowAttributes). No closure per row, the same expression run at the same
// point with the same item. So the output and the order of every side effect
// stay those of the h() spelling in every renderer, which is what this file
// holds, with the shapes that must not be hoisted, and with what a row's
// functions must never do: reach a row of another list, or outlive the call
// that made them.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import babelPlugin from '../src/babel-plugin.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { content, keyShape, stableIds } from '../../server/test/stream-helpers.js';

const { renderToString, renderToHydratableString, renderToStream, renderToStringAsync } = await import('../../server/src/index.js');
const { h } = await import('what-framework');

const ssr = { pluginOptions: { generate: 'ssr' } };
const compile = (source) => compileJSX(source, ssr);
const flat = (code) => code.replace(/\s+/g, ' ');

describe('server target: a row\'s reactive attribute is one function for its list', () => {
  it('the list holds the function, its callback takes the list\'s functions, and a keyed row hands them on with its item', () => {
    const code = flat(compile(`
      export const List = (props) => <ul>{props.rows().map(row => <li key={row.id} class={props.sel() === row.id ? 'on' : ''}>{row.name}</li>)}</ul>;
    `));
    assert.match(code, /_\$ssrTemplate\(\["<li", ">", "<\/li>"\], \[\["class", "class", 0\], null\]\)/);
    assert.match(code, /\(_f\$0, row\) => _\$ssrRow\(_tmpl\$\d+, _f\$0, row, _\$ssrText\(row\.name\)\), true, row => row\.id, \d+, \[row => props\.sel\(\) === row\.id \? 'on' : ''\]\)/);
  });

  it('an unkeyed row too, with no key function and no number before its functions', () => {
    const code = flat(compile(`
      export const List = (props) => <ul>{props.rows.map(row => <li class={cls(row)} title={row.name}>x</li>)}</ul>;
    `));
    assert.match(code, /_\$ssrList\(props\.rows, \(_f\$0, row\) => _\$ssrRow\(_tmpl\$\d+, _f\$0, row, row\.name\), (?:true|false), null, void 0, \[row => cls\(row\)\]\)/);
    assert.match(code, /\[\["class", "class", 0\], \["plain", "title"\]\]/);
  });

  it('the callback keeps every parameter it has, after the list\'s functions', () => {
    const code = flat(compile(`
      export const A = (props) => <ul>{props.rows.map((row, { length }, ...rest) => <li class={cls(row)}>x</li>)}</ul>;
      export const B = (props) => <ul>{props.rows.map((row, n = 2) => <li class={cls(row)}>{n}</li>)}</ul>;
    `));
    assert.match(code, /\(_f\$0, row, \{ length \}, \.\.\.rest\) => _\$ssrRow\(_tmpl\$\d+, _f\$0, row\)/);
    assert.match(code, /\(_f\$1, row, n = 2\) => _\$ssrRow\(_tmpl\$\d+, _f\$1, row, /);
  });

  it('a name the file already uses is not taken for the functions', () => {
    const code = flat(compile(`
      const _f$0 = 'mine';
      export const List = (props) => <ul>{props.rows.map(row => <li class={cls(row, _f$0)}>x</li>)}</ul>;
    `));
    assert.match(code, /\(_f\$1, row\) => _\$ssrRow\(_tmpl\$\d+, _f\$1, row\), (?:true|false), null, void 0, \[row => cls\(row, _f\$0\)\]\)/);
  });

  it('every reactive attribute of the row\'s template, its inner elements\' too, in source order', () => {
    const code = flat(compile(`
      export const List = (props) => <ul>{props.rows().map(row => (
        <li key={row.id} class={a(row)} data-n={1}><a href={link(row)} title={row.tags.some(tag => tag === on())}>{row.name}</a><b style={theme()}>!</b></li>
      ))}</ul>;
    `));
    assert.match(code, /\[row => a\(row\), row => link\(row\), row => row\.tags\.some\(tag => tag === on\(\)\), row => theme\(\)\]/);
    assert.match(code, /\[\["class", "class", 0\], \["url", "href", 1\], \["plain", "title", 2\], null, \["style", "style", 3\]\]/);
    // The list's functions once, then the item for each of them.
    assert.match(code, /_\$ssrRow\(_tmpl\$\d+, _f\$0, row, row, row, _\$ssrText\(row\.name\), row\)/);
  });

  it('an inner list\'s rows read the outer row\'s item from the scope its functions are written in', () => {
    const code = flat(compile(`
      export const Grid = (props) => <table><tbody>{props.rows().map(row => (
        <tr key={row.id}>{row.cells.map(cell => <td key={cell.id} class={mark(row, cell)}>{cell.text}</td>)}</tr>
      ))}</tbody></table>;
    `));
    assert.match(code, /\(_f\$(\d+), cell\) => _\$ssrRow\(_tmpl\$\d+, _f\$\1, cell, _\$ssrText\(cell\.text\)\), true, cell => cell\.id, \d+, \[cell => mark\(row, cell\)\]\)/);
  });

  it('a destructured item is read through a named item, so its attribute is one function for the list', () => {
    // lists.js nameRowParam: `({ id, on })` reads `item.on` where it is used,
    // on both targets, so the row is any other keyed row.
    const code = flat(compile(`export function List(props) { return <ul>{props.rows().map(({ id, on }) => <li key={id} class={cls(on)}>x</li>)}</ul>; }`));
    assert.match(code, /\(_f\$0, (_row\$\d+)\) => _\$ssrRow\(_tmpl\$\d+, _f\$0, \1\), true, \1 => \1\.id, \d+, \[\1 => cls\(\1\.on\)\]\)/, code);
  });

  const KEPT = {
    'the callback\'s index': 'props.rows().map((row, i) => <li key={row.id} class={cls(row, i)}>x</li>)',
    'the callback\'s array': 'props.rows().map((row, i, all) => <li key={row.id} class={cls(all)}>x</li>)',
    'an item with a default': 'props.rows().map((row = fallback) => <li class={cls(row)}>x</li>)',
    'an item the row assigns': 'props.rows().map(row => <li key={row.id} class={cls(row = next(row))}>x</li>)',
    'a block body': 'props.rows().map(row => { const c = cls(row); return <li key={row.id} class={c()}>x</li>; })',
    'a function expression': 'props.rows().map(function (row) { return <li key={row.id} class={cls(row)}>x</li>; })',
    'an async callback': 'props.rows().map(async row => <li key={row.id} class={cls(row)}>x</li>)',
    'this': 'props.rows().map(row => <li key={row.id} class={this.cls(row)}>x</li>)',
    'arguments': 'props.rows().map(row => <li key={row.id} class={cls(arguments[0], row)}>x</li>)',
    // What the callback binds can be written without being read: an
    // assignment's target is no reference, and it is the callback's all the same.
    'an index it only assigns': 'props.rows().map((row, i) => <li key={row.id} class={(i = 100, cls(row))}>x</li>)',
    'an index it adds to': 'props.rows().map((row, i) => <li key={row.id} class={cls(row, i += 10)}>x</li>)',
    'an index it counts up': 'props.rows().map((row, i) => <li key={row.id} class={cls(row, i++)}>x</li>)',
    'an index a pattern assigns': 'props.rows().map((row, i) => <li key={row.id} class={([i] = [1], cls(row))}>x</li>)',
    'an index an object pattern assigns': 'props.rows().map((row, i) => <li key={row.id} class={({ i } = row, cls(row))}>x</li>)',
    'an index a function inside it assigns': 'props.rows().map((row, i) => <li key={row.id} class={cls(row, (() => { i = 1; })())}>x</li>)',
    'an index a loop inside it assigns': 'props.rows().map((row, i) => <li key={row.id} class={cls(row, (() => { for (i of row.tags); })())}>x</li>)',
    'the array it assigns': 'props.rows().map((row, i, all) => <li key={row.id} class={(all = null, cls(row))}>x</li>)',
    'a destructured second parameter': 'props.rows().map((row, { length }) => <li key={row.id} class={cls(row, length)}>x</li>)',
    'a rest parameter': 'props.rows().map((row, ...rest) => <li key={row.id} class={cls(row, rest)}>x</li>)',
    'a name the callback binds, even where the name is another binding\'s or a property': 'props.rows().map((row, i) => <li key={row.id} class={cls(row.tags.filter(i => i), row.i)}>x</li>)',
    'eval': 'props.rows().map((row, i) => <li key={row.id} class={cls(row, eval("i"))}>x</li>)',
    'new.target': 'props.rows().map(row => <li key={row.id} class={cls(row, new.target)}>x</li>)',
  };
  for (const [name, list] of Object.entries(KEPT)) {
    it(`an attribute that holds ${name} stays a thunk of its row`, () => {
      const code = flat(compile(`export function List(props) { return <ul>{${list}}</ul>; }`));
      assert.doesNotMatch(code, /_\$ssrTemplate\([^;]*"class", "class", \d/, code);
      assert.doesNotMatch(code, /_\$ssrList\([^;]*, \[/, code);
      assert.doesNotMatch(code, /_f\$/, code);
      assert.match(code, /\(\) => /, code);
    });
  }

  it('an eval anywhere in the callback keeps every attribute of the row a thunk: it can assign the item unseen', () => {
    const code = flat(compile(`
      export const List = (props) => <ul>{props.rows.map(row => <li class={cls(row)}>{eval('row = other')}</li>)}</ul>;
    `));
    assert.doesNotMatch(code, /_f\$/, code);
    assert.match(code, /_\$ssrRow\(_tmpl\$\d+, \(\) => cls\(row\)/, code);
  });

  it('an attribute that names none of them is hoisted beside one that does', () => {
    const code = flat(compile(`
      export const List = (props) => <ul>{props.rows.map((row, i) => <li class={cls(row)} title={label(row, i)}>x</li>)}</ul>;
    `));
    assert.match(code, /\(_f\$0, row, i\) => _\$ssrRow\(_tmpl\$\d+, _f\$0, row, \(\) => label\(row, i\)\), (?:true|false), null, void 0, \[row => cls\(row\)\]\)/, code);
  });

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

// --- What the review of the first version found --------------------------------

const PRELUDE = `
  const log = globalThis.__rowLog;
  const say = (tag, value) => { log.push(tag); return value; };
`;
const load = (source) => loadCompiled(PRELUDE + source, ssr);

// Renders with nothing written to the console, whatever a render reports.
const silent = async (fn) => {
  const { warn, error } = console;
  console.warn = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, { warn, error }); }
};

// The same, for a render that is expected to fail: what it wrote, or null.
const attempt = (fn) => silent(async () => {
  try { return await fn(); } catch { return null; }
});

describe('server target: a row function is compiled like the code around it', () => {
  const CASES = {
    'JSX handed to a call': {
      source: `
        const label = (node, row) => (node ? 'has-icon ' : '') + row.name;
        export const make = (rows, on) => <ul>{rows().map(row => <li key={row.id} title={label(on() && <i class="icon" />, row)}>{row.name}</li>)}</ul>;`,
      code: /\[row => label\(on\(\) && _tmpl\$\d+, row\)\]/,
      html: '<ul><li title="has-icon one">one</li><li title="has-icon two">two</li></ul>',
    },
    'JSX in a function': {
      source: `
        const kind = (make, row) => typeof make === 'function' ? 'fn-' + row.name : 'none';
        export const make = (rows, on) => <ul>{rows().map(row => <li key={row.id} class={kind(() => <b>{row.name}</b>, row) + on()}>{row.name}</li>)}</ul>;`,
      code: /\[row => kind\(\(\) => _\$ssr\(_tmpl\$\d+, _\$ssrText\(row\.name\)\), row\) \+ on\(\)\]/,
      html: '<ul><li class="fn-onetrue">one</li><li class="fn-twotrue">two</li></ul>',
    },
    'JSX in one arm of a ternary': {
      source: `
        const kind = (value) => value === null ? 'null' : typeof value;
        export const make = (rows, on) => <ul>{rows().map(row => <li key={row.id} data-kind={kind(on() && row.id === 2 ? <b>{row.name}</b> : null)}>{row.name}</li>)}</ul>;`,
      code: /\[row => kind\(on\(\) && row\.id === 2 \? _\$ssr\(_tmpl\$\d+, _\$ssrText\(row\.name\)\) : null\)\]/,
      html: '<ul><li data-kind="null">one</li><li data-kind="object">two</li></ul>',
    },
    'a .map() of JSX': {
      source: `
        export const make = (rows, on) => <ul>{rows().map(row => <li key={row.id} data-n={row.tags.map(tag => <i>{tag}</i>).length + ':' + on()}>{row.name}</li>)}</ul>;`,
      code: /\[row => row\.tags\.map\(tag => _\$ssr\(_tmpl\$\d+, _\$ssrText\(tag\)\)\)\.length \+ ':' \+ on\(\)\]/,
      html: '<ul><li data-n="2:true">one</li><li data-n="0:true">two</li></ul>',
    },
  };
  const rows = [{ id: 1, name: 'one', tags: ['a', 'b'] }, { id: 2, name: 'two', tags: [] }];
  for (const [name, { source, code, html }] of Object.entries(CASES)) {
    it(`${name}: lowered where the function is written, and the module loads`, async () => {
      const compiled = flat(compile(source));
      assert.match(compiled, code, compiled);
      // No JSX is left outside the templates' strings.
      assert.doesNotMatch(compiled.replace(/"(?:[^"\\]|\\.)*"/g, '""'), /<\/?[A-Za-z]/, compiled);
      const mod = await load(source);
      const out = await renderAll(() => mod.make(() => rows, () => true));
      for (const [renderer, { html: got }] of Object.entries(out)) assert.equal(content(got), html, renderer);
    });
  }

  it('every plugin of the build visits a row function', () => {
    // A row function that only the server target sees would keep whatever the
    // other plugins of a build rewrite: types, syntax a target lacks.
    const probe = () => ({
      visitor: {
        Identifier(path) {
          if (path.node.name === 'PROBE') path.replaceWith({ type: 'StringLiteral', value: 'probed' });
        },
      },
    });
    const { code } = transformSync(`
      export const List = (props) => <ul>{props.rows.map(row => <li class={cls(row, PROBE)} title={PROBE}>{label(row, PROBE)}</li>)}</ul>;
    `, {
      filename: 'fixture.jsx', plugins: [[babelPlugin, { generate: 'ssr' }], probe], parserOpts: { plugins: ['jsx'] },
      configFile: false, babelrc: false, compact: false, highlightCode: false,
    });
    assert.doesNotMatch(code, /PROBE/, code);
    assert.match(flat(code), /\[row => cls\(row, "probed"\)\]/, code);
  });
});

describe('server target: a row takes its list\'s functions from the call that renders it', () => {
  const B = [{ name: 'b1' }, { name: 'b2' }];
  // Sources that are not arrays, whose map() calls the callback when a row is
  // read, and when a row is placed.
  const onRead = (rows) => ({
    map(fn) {
      const out = { length: rows.length };
      rows.forEach((row, i) => Object.defineProperty(out, i, { get: () => fn(row, i) }));
      return out;
    },
  });
  const onPlacement = (rows) => ({ map: (fn) => rows.map((row, i) => () => fn(row, i)) });

  it('a key function that throws leaves nothing for the next render', async () => {
    const mod = await load(`
      export const Keyed = (props) => <ul>{props.rows().map(row => <li key={row.id} class={props.session() + '/' + row.name}>{row.name}</li>)}</ul>;
      export const Other = (props) => <ol>{props.source.map(row => <li class={props.tag() + '-' + row.name}>{row.name}</li>)}</ol>;
    `);
    for (const [renderer, render] of Object.entries(RENDERERS)) {
      for (const source of [onRead, onPlacement, (rows) => rows]) {
        // One request: a row is null, so its key function throws where the
        // list is rendered (a keyed list is a reactive child).
        const failed = await attempt(() => render(h(mod.Keyed, { rows: () => [{ id: 1, name: 'a1' }, null], session: () => 'SESSION-OF-A' })));
        if (failed !== null) assert.equal(content(failed), '<ul></ul>', renderer);
        // The next one renders a list of its own.
        const html = await silent(() => render(h(mod.Other, { source: source(B), tag: () => 'B' })));
        assert.equal(content(html), '<ol><li class="B-b1">b1</li><li class="B-b2">b2</li></ol>', renderer);
      }
    }
  });

  it('a source whose map() calls the callback later: when a row is read, and when it is placed', async () => {
    const mod = await load(`
      export const make = (source, tag) => <ol>{source.map(row => <li class={say('class:' + row.name, tag() + '-' + row.name)} title={row.name}>{row.name}</li>)}</ol>;
    `);
    for (const source of [onRead, onPlacement]) {
      const out = await renderAll(() => mod.make(source(B), () => 'B'));
      for (const [renderer, { html, order }] of Object.entries(out)) {
        assert.equal(content(html), '<ol><li class="B-b1" title="b1">b1</li><li class="B-b2" title="b2">b2</li></ol>', renderer);
        assert.equal(order, 'class:b1>class:b2', renderer);
      }
    }
  });

  it('such a source inside another list\'s row: each row is given its own list\'s functions', async () => {
    const mod = await load(`
      export const make = (outer, source, tag) => (
        <div>{outer.map(group => (
          <section class={say('outer:' + group.id, tag() + '/outer-' + group.id)}>
            {source(group).map(row => <p class={say('inner:' + group.id + row.name, tag() + '/inner-' + group.id + row.name)}>{row.name}</p>)}
            <b title={say('after:' + group.id, tag() + '/after-' + group.id)}>end</b>
          </section>
        ))}</div>
      );
    `);
    const groups = [{ id: 1 }, { id: 2 }];
    const out = await renderAll(() => mod.make(groups, () => onPlacement(B), () => 'T'));
    for (const [renderer, { html, order }] of Object.entries(out)) {
      assert.equal(content(html),
        '<div><section class="T/outer-1"><p class="T/inner-1b1">b1</p><p class="T/inner-1b2">b2</p><b title="T/after-1">end</b></section>'
        + '<section class="T/outer-2"><p class="T/inner-2b1">b1</p><p class="T/inner-2b2">b2</p><b title="T/after-2">end</b></section></div>', renderer);
      assert.equal(order, 'outer:1>inner:1b1>inner:1b2>after:1>outer:2>inner:2b1>inner:2b2>after:2', renderer);
    }
    // Read while the outer row is written: wherever the rows land, each
    // attribute is its own list's.
    const read = await renderAll(() => mod.make(groups, () => onRead(B), () => 'T'));
    for (const [renderer, { html, order }] of Object.entries(read)) {
      assert.deepEqual(html.match(/<p class="[^"]*"/g), ['1b1', '1b2', '2b1', '2b2'].map((id) => `<p class="T/inner-${id}"`), renderer);
      assert.deepEqual(html.match(/<section class="[^"]*"/g), ['<section class="T/outer-1"', '<section class="T/outer-2"'], renderer);
      assert.deepEqual(html.match(/<b title="[^"]*"/g), ['<b title="T/after-1"', '<b title="T/after-2"'], renderer);
      assert.equal(order.split('>').sort().join('>'), 'after:1>after:2>inner:1b1>inner:1b2>inner:2b1>inner:2b2>outer:1>outer:2', renderer);
    }
  });

  it('a list inside a row: the outer row\'s attributes after it are still the outer list\'s', async () => {
    const mod = await load(`
      // Lists of a constant are made where they are written, inside the
      // outer row's callback, not when the row is placed.
      const ROWS = [{ id: 1 }, { id: 2 }];
      const COLS = ['x', 'y'];
      const NONE = [];
      const BAD = [{ id: 1 }, null];
      export const grid = (sel) => (
        <table><tbody>{ROWS.map(row => (
          <tr class={say('row:' + row.id, sel() + '/row-' + row.id)}>
            {COLS.map(col => <td class={say('cell:' + row.id + col, sel() + '/cell-' + row.id + col)}>{col}</td>)}
            <td title={say('after:' + row.id, sel() + '/after-' + row.id)}>end</td>
          </tr>
        ))}</tbody></table>
      );
      export const keyedGrid = (rows, sel) => (
        <table><tbody>{rows().map(row => (
          <tr key={row.id} class={say('row:' + row.id, sel() + '/row-' + row.id)}>
            {COLS.map(col => <td key={col} class={say('cell:' + row.id + col, sel() + '/cell-' + row.id + col)}>{col}</td>)}
            <td title={say('after:' + row.id, sel() + '/after-' + row.id)}>end</td>
          </tr>
        ))}</tbody></table>
      );
      export const emptyGrid = (sel) => (
        <table><tbody>{ROWS.map(row => (
          <tr class={say('row:' + row.id, sel() + '/row-' + row.id)}>
            {NONE.map(col => <td class={say('cell:' + row.id + col, sel() + '/cell-' + row.id + col)}>{col}</td>)}
            <td title={say('after:' + row.id, sel() + '/after-' + row.id)}>end</td>
          </tr>
        ))}</tbody></table>
      );
      export const between = (sel) => (
        <div>{ROWS.map(row => (
          <section>
            <ul>{COLS.map(col => <li class={say('a:' + row.id + col, sel() + '/a-' + row.id + col)}>{col}</li>)}</ul>
            <p class={say('p:' + row.id, sel() + '/p-' + row.id)}>{row.id}</p>
            <ol>{COLS.map(col => <li title={say('b:' + row.id + col, sel() + '/b-' + col)}>{col}</li>)}</ol>
            <b class={say('end:' + row.id, sel() + '/end-' + row.id)}>b</b>
          </section>
        ))}</div>
      );
      export const failing = (sel) => (
        <div>{ROWS.map(row => (
          <section class={say('s:' + row.id, sel() + '/s-' + row.id)}>
            <em>{BAD.map(b => <i key={b.id} class={say('never', sel() + row.id)}>i</i>)}</em>
            <b class={say('b:' + row.id, sel() + '/b-' + row.id)}>b</b>
          </section>
        ))}</div>
      );
    `);
    const rows = [{ id: 1 }, { id: 2 }];
    const cols = ['x', 'y'];
    const tr = (id, list) => `<tr class="S/row-${id}">${list.map((col) => `<td class="S/cell-${id}${col}">${col}</td>`).join('')}<td title="S/after-${id}">end</td></tr>`;
    const trOrder = (id, list) => [`row:${id}`, ...list.map((col) => `cell:${id}${col}`), `after:${id}`].join('>');

    for (const [make, list] of [[() => mod.grid(() => 'S'), cols], [() => mod.keyedGrid(() => rows, () => 'S'), cols], [() => mod.emptyGrid(() => 'S'), []]]) {
      const out = await renderAll(make);
      for (const [renderer, { html, order }] of Object.entries(out)) {
        assert.equal(content(html), `<table><tbody>${tr(1, list)}${tr(2, list)}</tbody></table>`, renderer);
        assert.equal(order, `${trOrder(1, list)}>${trOrder(2, list)}`, renderer);
      }
    }

    const between = await renderAll(() => mod.between(() => 'S'));
    const section = (id) => `<section><ul><li class="S/a-${id}x">x</li><li class="S/a-${id}y">y</li></ul><p class="S/p-${id}">${id}</p>`
      + `<ol><li title="S/b-x">x</li><li title="S/b-y">y</li></ol><b class="S/end-${id}">b</b></section>`;
    for (const [renderer, { html, order }] of Object.entries(between)) {
      assert.equal(content(html), `<div>${section(1)}${section(2)}</div>`, renderer);
      assert.equal(order, [1, 2].map((id) => `a:${id}x>a:${id}y>p:${id}>b:${id}x>b:${id}y>end:${id}`).join('>'), renderer);
    }

    // An inner keyed list that fails where it is rendered (a key function
    // over a null row) is an empty region, and the row around it is whole.
    const failing = await silent(() => renderAll(() => mod.failing(() => 'S')));
    for (const [renderer, { html, order }] of Object.entries(failing)) {
      assert.equal(content(html), '<div><section class="S/s-1"><em></em><b class="S/b-1">b</b></section><section class="S/s-2"><em></em><b class="S/b-2">b</b></section></div>', renderer);
      assert.equal(order, 's:1>b:1>s:2>b:2', renderer);
    }
  });
});

describe('server target: what a row\'s callback binds stays the callback\'s', () => {
  const rows = [{ id: 1, name: 'one' }, { id: 2, name: 'two' }];
  const CASES = {
    'an index an attribute assigns': {
      source: `export const make = (rows, on) => <ul>{rows().map((row, i) => <li key={row.id} class={(i = 'w' + row.id, on() + '-' + row.id)}>{() => String(i)}</li>)}</ul>;`,
      html: '<ul><li class="on-1">w1</li><li class="on-2">w2</li></ul>',
    },
    'an index an attribute adds to': {
      source: `export const make = (rows, on) => <ul>{rows().map((row, i) => <li key={row.id} class={on() + '-' + (i += 10)}>{() => String(i)}</li>)}</ul>;`,
      html: '<ul><li class="on-10">10</li><li class="on-11">11</li></ul>',
    },
    'an index a pattern in an attribute assigns': {
      source: `export const make = (rows, on) => <ul>{rows().map((row, i) => <li key={row.id} class={([i] = ['d' + row.id], on() + '-' + row.id)}>{() => String(i)}</li>)}</ul>;`,
      html: '<ul><li class="on-1">d1</li><li class="on-2">d2</li></ul>',
    },
    'an index a function in an attribute assigns': {
      source: `export const make = (rows, on) => <ul>{rows().map((row, i) => <li key={row.id} class={on() + '-' + row.id + String((() => { i = 'f' + row.id; return ''; })())}>{() => String(i)}</li>)}</ul>;`,
      html: '<ul><li class="on-1">f1</li><li class="on-2">f2</li></ul>',
    },
    'the array an attribute assigns': {
      source: `export const make = (rows, on) => <ul>{rows().map((row, i, all) => <li key={row.id} class={(all = null, on() + '-' + row.id)}>{() => String(all)}</li>)}</ul>;`,
      html: '<ul><li class="on-1">null</li><li class="on-2">null</li></ul>',
    },
    'an index named like a variable outside, which the attribute must not write': {
      source: `export const make = (rows, on) => { let i = 'outer'; const list = <ul>{rows().map((row, i) => <li key={row.id} class={(i = 'w', on() + '-' + row.id)}>{() => String(i)}</li>)}</ul>; return <div>{list}{() => String(i)}</div>; };`,
      html: '<div><ul><li class="on-1">w</li><li class="on-2">w</li></ul>outer</div>',
    },
    'an index an eval in an attribute reads': {
      source: `export const make = (rows, on) => <ul>{rows().map((row, i) => <li key={row.id} class={eval('i') + '-' + on()}>{row.name}</li>)}</ul>;`,
      html: '<ul><li class="0-on">one</li><li class="1-on">two</li></ul>',
    },
  };
  for (const [name, { source, html }] of Object.entries(CASES)) {
    it(name, async () => {
      const mod = await load(source);
      const out = await silent(() => renderAll(() => mod.make(() => rows, () => 'on')));
      for (const [renderer, { html: got }] of Object.entries(out)) assert.equal(content(got), html, renderer);
    });
  }
});
