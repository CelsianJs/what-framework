// Code that only a feature needs is reached through that feature alone
// (feature-reach.test.js checks what a bundle carries). Each way it gets there
// can fail where no unit test looks: the feature used in a production bundle
// in which nothing else brought its code. So each one here is a minimal app
// that uses only that feature, bundled through the `production` export
// condition (the dist/*.min.js tier, built here from the source into a
// temporary node_modules, so no prior `npm run build` is needed and the tier
// is never stale), and run against the test's DOM:
//
//   _$createLeaf     the component call of a module whose JSX hands no
//                    component children and no JSX in a prop: no lazy getters
//                    (dom.js _installLazyChildren). What it must still do, and
//                    what a module beside it that does hand children must
//                    (the lazy getters arrive with that module's call).
//   _$createFn       the same for a module whose every component is a plain
//                    function the compiler can see: no class component
//                    bridge (render.js _toFunctionComponent). The card module
//                    below calls one; the module beside it with a class
//                    component takes _$createLeaf.
//   _$reactive       insert() for a module whose every hole holds a function
//                    written in it: the reactive region alone, which must
//                    still show every kind of value.
//   _listFragment    a list rendered as a value, carried by the list inserter
//                    (its `_mapArray`) instead of being reached from every
//                    value: a component that returns a list, a list in a
//                    fragment, a list a region embeds.
//   _handlePending   the walk to the nearest <Suspense>, reached from what
//                    can suspend (render.js renderWhenSettled) and no longer
//                    from every component failure.
//   _isSvgParent     whether a vnode is built in an SVG element, asked by the
//                    vnode renderer h.js installs instead of by every value.
//   _$selects        the props of a <select> and its <option>s (dom.js
//                    selectProp): installed by a compiled module whose JSX
//                    writes one, by h(), and by spread(), setProp() and
//                    setValue() written by hand. A compiled app of inputs
//                    carries none of it.
//   isServerRender   asked by useEffect and onMount, without making the
//                    server render store a browser never has.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { buildModules } from '../../../scripts/build.js';

const { document, window } = installDOM();

const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));
const SVG_NS = 'http://www.w3.org/2000/svg';

let tmp;
let apps = 0;

before(async () => {
  // The real path: on macOS the temp dir is a symlink, and a module reached
  // through both spellings would be bundled twice.
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'what-feature-install-')));
  for (const [name, dir] of [['what-core', 'core'], ['what-framework', 'what']]) {
    const pkg = join(tmp, 'node_modules', name);
    mkdirSync(pkg, { recursive: true });
    cpSync(join(PACKAGES, dir, 'package.json'), join(pkg, 'package.json'));
    await buildModules(join(PACKAGES, dir), join(pkg, 'dist'));
  }
});

after(() => rmSync(tmp, { recursive: true, force: true }));

// Compile `modules` ({ 'main.jsx': source, ... }, main.jsx the entry), bundle
// them as a production app and load the bundle. Returns its exports and the
// compiled code of each module.
async function app(modules) {
  const dir = join(tmp, `app-${++apps}`);
  mkdirSync(dir);
  const compiled = {};
  for (const [name, source] of Object.entries(modules)) {
    compiled[name] = compileJSX(source, { production: true, filename: join(dir, name) });
    writeFileSync(join(dir, name.replace(/\.jsx$/, '.js')), compiled[name]);
  }
  const result = await build({
    entryPoints: [join(dir, 'main.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    conditions: ['production'],
    treeShaking: true,
    write: false,
    logLevel: 'silent',
    metafile: true,
  });
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.some((file) => file.endsWith('what-core/dist/render.min.js')), 'the app is bundled from the production tier');
  assert.ok(!inputs.some((file) => /what-(core|framework)\/src\//.test(file)), 'and from none of the source');
  const file = join(dir, 'bundle.mjs');
  writeFileSync(file, result.outputFiles[0].text);
  return { exports: await import(pathToFileURL(file).href), compiled, code: result.outputFiles[0].text };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function host() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }));

describe('a module whose JSX hands no component children (_$createLeaf)', () => {
  it('renders, updates a live prop and unmounts', async () => {
    const { exports, compiled } = await app({ 'main.jsx': `
      import { mount, signal, onCleanup } from 'what-framework';
      export const gone = [];
      function Badge(props) {
        onCleanup(() => gone.push('badge'));
        return <b>{props.n}</b>;
      }
      class Legacy {
        constructor(props) { this.props = props; }
        render() { return <i>{this.props.label}</i>; }
      }
      function App() {
        const count = signal(1);
        return <main><Badge n={count()} /><Legacy label="old" /><button onClick={() => count((c) => c + 1)}>+</button></main>;
      }
      export const run = (el) => mount(<App />, el);
    ` });
    assert.match(compiled['main.jsx'], /_\$createLeaf as _\$createComponent/);
    const el = host();
    const unmount = exports.run(el);
    assert.deepEqual([...el.querySelector('main').children].map((child) => child.outerHTML), ['<b>1</b>', '<i>old</i>', '<button>+</button>']);
    click(el.querySelector('button'));
    await flush();
    assert.equal(el.querySelector('b').textContent, '2');
    unmount();
    assert.equal(el.innerHTML, '');
    assert.deepEqual(exports.gone, ['badge']);
  });

  it('a component of such a module still takes children and JSX props from a module that hands them', async () => {
    const { exports, compiled } = await app({
      'card.jsx': `
        import { useContext } from 'what-framework';
        import { Theme } from './theme.js';
        function Rule() { return <hr />; }
        export function Label() { return <em>{useContext(Theme)}</em>; }
        export function Card(props) {
          return <section><header>{props.header}</header><Rule />{props.children}</section>;
        }
      `,
      'theme.jsx': `
        import { createContext } from 'what-framework';
        export const Theme = createContext('light');
      `,
      'main.jsx': `
        import { mount } from 'what-framework';
        import { Theme } from './theme.js';
        import { Card, Label } from './card.js';
        function App() {
          return <Theme.Provider value="dark"><Card header={<Label />}><Label /><p>body</p></Card></Theme.Provider>;
        }
        export const run = (el) => mount(<App />, el);
      `,
    });
    // Its one component call is of a function it defines (render-helper-selection).
    assert.match(compiled['card.jsx'], /_\$createFn as _\$createComponent/);
    assert.match(compiled['main.jsx'], /[{ ]_\$createComponent[,} ]/);
    assert.doesNotMatch(compiled['main.jsx'], /_\$createLeaf|_\$createFn/);
    const el = host();
    exports.run(el);
    // Built where the Card reads them, under the provider: both read "dark".
    const section = el.querySelector('section');
    assert.deepEqual([...section.children].map((child) => child.outerHTML), ['<header><em>dark</em></header>', '<hr>', '<em>dark</em>', '<p>body</p>']);
  });
});

describe('a module whose every hole holds a function written in it (_$reactive)', () => {
  it('shows text, nothing, a node, an array and text again', async () => {
    const { exports, compiled } = await app({ 'main.jsx': `
      import { mount, signal } from 'what-framework';
      export const value = signal('a');
      export const tail = signal(1);
      function App() {
        return <p>{value()}<span>{tail() + 1}</span></p>;
      }
      export const run = (el) => mount(<App />, el);
    ` });
    assert.match(compiled['main.jsx'], /_\$reactive as _\$insert/);
    assert.doesNotMatch(compiled['main.jsx'], /[{ ]insert as /);
    const el = host();
    exports.run(el);
    const p = el.querySelector('p');
    const span = p.querySelector('span');
    assert.equal(p.innerHTML, 'a<span>2</span>');
    const text = p.firstChild;
    exports.value(5);
    exports.tail(2);
    await flush();
    assert.equal(p.innerHTML, '5<span>3</span>');
    assert.equal(p.firstChild, text, 'a text value is written to the same text node');
    exports.value(null);
    await flush();
    assert.equal(p.innerHTML, '<span>3</span>');
    const b = document.createElement('b');
    exports.value(b);
    await flush();
    assert.equal(p.innerHTML, '<b></b><span>3</span>');
    exports.value(['x', b, 7]);
    await flush();
    assert.equal(p.innerHTML, 'x<b></b>7<span>3</span>');
    assert.equal(p.querySelector('b'), b, 'a node that stays is not built again');
    exports.value(false);
    await flush();
    assert.equal(p.innerHTML, '<span>3</span>');
    exports.value('z');
    await flush();
    assert.equal(p.innerHTML, 'z<span>3</span>');
    assert.equal(p.querySelector('span'), span);
  });

  it('a module with any other hole imports insert()', () => {
    const general = (source) => compileJSX(source, { production: true });
    for (const [what, source] of [
      ['a component in an element', 'const Leaf = () => <i/>; export const a = () => <p><Leaf /></p>;'],
      ['a value that is not a function', 'export const a = (node) => <p>{node}</p>;'],
      ['a keyed list', 'export const a = (rows) => <ul>{rows().map((r) => <li key={r.id}>{r.t}</li>)}</ul>;'],
      ['a placed prop', 'export const A = (props) => <p>{props.children}</p>;'],
    ]) {
      assert.match(general(source), /[{ ]insert as _\$insert/, what);
    }
  });
});

describe('a list rendered as a value (_listFragment on the inserter)', () => {
  it('a component that returns a list, a list in a fragment, and a region that embeds one', async () => {
    const { exports } = await app({ 'main.jsx': `
      import { mount, signal } from 'what-framework';
      export const items = signal([{ id: 1, t: 'a' }, { id: 2, t: 'b' }]);
      export const shown = signal(true);
      function Rows(props) {
        return <>{props.items().map((item) => <li key={item.id}>{item.t}</li>)}</>;
      }
      function Both() {
        return <>{items().map((item) => <li key={item.id} class="f">{item.t}</li>)}<li class="end">end</li></>;
      }
      function App() {
        return <div><ul id="rows"><Rows items={items} /></ul><ul id="both"><Both /></ul><ul id="region">{shown() ? <Rows items={items} /> : null}</ul></div>;
      }
      export const run = (el) => mount(<App />, el);
    ` });
    const el = host();
    exports.run(el);
    const text = (id) => [...el.querySelectorAll(`#${id} li`)].map((li) => li.textContent).join(',');
    assert.equal(text('rows'), 'a,b');
    assert.equal(text('both'), 'a,b,end');
    assert.equal(text('region'), 'a,b');
    const first = el.querySelector('#rows li');
    exports.items([{ id: 1, t: 'a' }, { id: 2, t: 'b' }, { id: 3, t: 'c' }]);
    await flush();
    assert.equal(text('rows'), 'a,b,c');
    assert.equal(text('both'), 'a,b,c,end');
    assert.equal(text('region'), 'a,b,c');
    assert.equal(el.querySelector('#rows li'), first, 'a row whose key stays keeps its node');
    // The region removes the list it embeds with the rows the list added
    // since: its start marker reaches the list's end (_rangeEnd).
    exports.shown(false);
    await flush();
    assert.equal(el.querySelector('#region').children.length, 0);
    exports.shown(true);
    await flush();
    assert.equal(text('region'), 'a,b,c');
    exports.items([]);
    await flush();
    assert.equal(text('rows'), '');
    assert.equal(text('both'), 'end');
  });
});

describe('a component that suspends (_handlePending from renderWhenSettled)', () => {
  it('shows the nearest <Suspense> fallback, then the component', async () => {
    const { exports } = await app({ 'main.jsx': `
      import { mount, Suspense, lazy } from 'what-framework';
      let load;
      export const loaded = (Component) => load({ default: Component });
      const Late = lazy(() => new Promise((resolve) => { load = resolve; }));
      function App() {
        return <main><Suspense fallback={<i>wait</i>}><Late n={3} /></Suspense></main>;
      }
      export const Shown = (props) => <b>late {props.n}</b>;
      export const run = (el) => mount(<App />, el);
    ` });
    const el = host();
    exports.run(el);
    assert.equal(el.querySelector('main').textContent, 'wait');
    exports.loaded(exports.Shown);
    await flush();
    await flush();
    assert.equal(el.querySelector('main').textContent, 'late 3');
    assert.equal(el.querySelector('i'), null);
  });

  it('in an app that cannot suspend, a thrown promise is the error it always was', async () => {
    const { exports } = await app({ 'main.jsx': `
      import { mount, ErrorBoundary } from 'what-framework';
      export const thrown = new Promise(() => {});
      function Throws() { throw thrown; }
      export const bare = (el) => mount(<main><Throws /></main>, el);
      export const caught = [];
      export const bounded = (el) => mount(
        <ErrorBoundary fallback={({ error }) => { caught.push(error); return <i>failed</i>; }}><Throws /></ErrorBoundary>, el);
    ` });
    const error = console.error;
    console.error = () => {};
    try {
      assert.throws(() => exports.bare(host()), (err) => err === exports.thrown);
    } finally {
      console.error = error;
    }
    const el = host();
    exports.bounded(el);
    await flush();
    assert.equal(el.textContent, 'failed');
    assert.deepEqual(exports.caught, [exports.thrown]);
  });
});

describe('a vnode built in an SVG element (_isSvgParent in the installed renderer)', () => {
  it('is an SVG element, from a region and from a keyed vnode list', async () => {
    const { exports } = await app({ 'main.jsx': `
      import { mount, signal, h } from 'what-framework';
      export const on = signal(true);
      export const dots = signal([1, 2]);
      function App() {
        return <svg><g id="one">{on() ? h('circle', { r: 2 }) : null}</g><g id="many">{dots().map((d) => h('rect', { key: d, width: d }))}</g></svg>;
      }
      export const run = (el) => mount(<App />, el);
    ` });
    const el = host();
    exports.run(el);
    const circle = el.querySelector('#one circle');
    assert.equal(circle.namespaceURI, SVG_NS);
    assert.deepEqual([...el.querySelectorAll('#many rect')].map((r) => r.namespaceURI), [SVG_NS, SVG_NS]);
    exports.on(false);
    exports.dots([1, 2, 3]);
    await flush();
    assert.equal(el.querySelector('#one circle'), null);
    assert.deepEqual([...el.querySelectorAll('#many rect')].map((r) => `${r.namespaceURI === SVG_NS}:${r.getAttribute('width')}`), ['true:1', 'true:2', 'true:3']);
    exports.on(true);
    await flush();
    assert.equal(el.querySelector('#one circle').namespaceURI, SVG_NS);
  });
});

// The minified bundle keeps the property names and strings of the select
// code: `_$selectWrite` is written only by it (dom.js _setSelectValue).
const SELECT_MARK = '_$selectWrite';

describe('the props of a <select> and its <option>s (_$selects and the setters that install it)', () => {
  it('a compiled select: its value, options that arrive later, multiple, and a pick it refuses', async () => {
    const { exports, compiled, code } = await app({ 'main.jsx': `
      import { mount, signal } from 'what-framework';
      export const picked = signal('c');
      export const options = signal(['a', 'b']);
      export const many = signal(['a', 'c']);
      function App() {
        return <form>
          <select id="picked-one" value={picked()}>{options().map((o) => <option key={o}>{o}</option>)}</select>
          <select id="picked-many" multiple value={many()}><option>a</option><option>b</option><option>c</option></select>
        </form>;
      }
      export const run = (el) => mount(<App />, el);
    ` });
    assert.match(compiled['main.jsx'], /^_\$selects\(\);$/m);
    assert.ok(code.includes(SELECT_MARK));
    const el = host();
    exports.run(el);
    const one = el.querySelector('#picked-one');
    const many = el.querySelector('#picked-many');
    assert.equal(one.selectedIndex, -1, 'no option is "c" yet');
    exports.options(['a', 'b', 'c']);
    await flush();
    await flush();
    assert.equal(one.value, 'c', 'the option the value names is selected once it is there');
    assert.deepEqual([...many.options].map((o) => o.selected), [true, false, true]);
    exports.picked('a');
    exports.many(['b']);
    await flush();
    assert.equal(one.value, 'a');
    assert.deepEqual([...many.options].map((o) => o.selected), [false, true, false]);
    one.value = 'b';
    one.dispatchEvent(new window.Event('change', { bubbles: true }));
    await flush();
    assert.equal(one.value, 'a', 'a controlled select goes back to its value');
  });

  it('options in a module of their own, inside a select of another module', async () => {
    const { exports, compiled } = await app({
      'options.jsx': `
        export function Options(props) { return <>{props.values.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</>; }
      `,
      'main.jsx': `
        import { mount, signal } from 'what-framework';
        import { Options } from './options.js';
        export const picked = signal('2');
        export const run = (el) => mount(<select value={picked()}><Options values={[{ id: '1', label: 'one' }, { id: '2', label: 'two' }]} /></select>, el);
      `,
    });
    assert.match(compiled['options.jsx'], /^_\$selects\(\);$/m);
    const el = host();
    exports.run(el);
    await flush();
    assert.equal(el.querySelector('select').value, '2');
    exports.picked('1');
    await flush();
    assert.equal(el.querySelector('select').value, '1');
  });

  it('h() makes a select with no compiled select in the app', async () => {
    const { exports, code } = await app({ 'main.jsx': `
      import { mount, h, signal } from 'what-framework';
      export const picked = signal('b');
      export const run = (el) => mount(h('select', { value: () => picked() }, h('option', {}, 'a'), h('option', { value: 'b' }, 'b')), el);
    ` });
    assert.ok(code.includes(SELECT_MARK));
    const el = host();
    exports.run(el);
    await flush();
    assert.equal(el.querySelector('select').value, 'b');
    exports.picked('a');
    await flush();
    assert.equal(el.querySelector('select').value, 'a');
  });

  it('spread(), setProp() and setValue() written by hand on a select', async () => {
    const { exports } = await app({ 'main.jsx': `
      import { spread, setProp, setValue } from 'what-framework/render';
      export function run(el) {
        const make = () => {
          const select = document.createElement('select');
          select.multiple = true;
          for (const v of ['a', 'b', 'c']) {
            const option = document.createElement('option');
            option.textContent = v;
            select.append(option);
          }
          el.append(select);
          return select;
        };
        const a = make(), b = make(), c = make();
        spread(a, { value: ['a', 'c'] });
        setProp(b, 'value', ['b']);
        setValue(c, ['c']);
        return [a, b, c];
      }
    ` });
    const shown = exports.run(host()).map((s) => [...s.options].map((o) => o.selected));
    assert.deepEqual(shown, [[true, false, true], [false, true, false], [false, false, true]]);
  });

  it('a compiled app of inputs and a spread carries none of it, and its fields work', async () => {
    const { exports, code } = await app({ 'main.jsx': `
      import { mount, signal } from 'what-framework';
      export const text = signal('a');
      export const on = signal(true);
      function App(props) {
        return <form><input id="t" value={text()} onInput={(e) => text(e.target.value)} /><input id="c" type="checkbox" checked={on()} /><input id="s" {...props.field} /></form>;
      }
      export const run = (el) => mount(<App field={{ value: 'start', name: 'x' }} />, el);
    ` });
    assert.ok(!code.includes(SELECT_MARK));
    const el = host();
    exports.run(el);
    assert.deepEqual(['#t', '#s'].map((s) => el.querySelector(s).value), ['a', 'start']);
    assert.equal(el.querySelector('#c').checked, true);
    exports.text('b');
    exports.on(false);
    await flush();
    assert.equal(el.querySelector('#t').value, 'b');
    assert.equal(el.querySelector('#c').checked, false);
  });
});

describe('useEffect and onMount in the browser (isServerRender without the server store)', () => {
  it('run after mount, and their cleanups on unmount', async () => {
    const { exports, code } = await app({ 'main.jsx': `
      import { mount, useEffect, onMount, signal } from 'what-framework';
      export const log = [];
      export const n = signal(0);
      function App() {
        useEffect(() => { log.push('effect ' + n()); return () => log.push('cleanup'); });
        onMount(() => { log.push('mounted'); });
        return <p>{n()}</p>;
      }
      export const run = (el) => mount(<App />, el);
    ` });
    assert.ok(!code.includes('rootFor(_engine)') && !code.includes('.frames'), 'no server store');
    const el = host();
    const unmount = exports.run(el);
    await flush();
    assert.deepEqual(exports.log.splice(0).sort(), ['effect 0', 'mounted']);
    exports.n(1);
    await flush();
    assert.deepEqual(exports.log.splice(0), ['cleanup', 'effect 1']);
    unmount();
    assert.deepEqual(exports.log.splice(0), ['cleanup']);
  });
});
