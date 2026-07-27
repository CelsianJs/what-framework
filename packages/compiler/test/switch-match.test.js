// <Switch>/<Match> on the compiled-JSX path. The runtime Switch looks for Match
// marker vnodes, which _$createComponent never produces, so compiled Switch had
// no working path at all. The compiler lowers it the way it lowers <Show>.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import babelPlugin from '../src/babel-plugin.js';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;
global.Node = dom.window.Node;
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_INDEX = path.resolve(__dirname, '../../core/src/index.js');
const CORE_RENDER = path.resolve(__dirname, '../../core/src/render.js');

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-switch-'));
let moduleId = 0;

function compile(source) {
  return transformSync(source, {
    filename: 'fixture.jsx',
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
    compact: false,
  }).code;
}

async function compileAndLoad(source) {
  const out = compile(source)
    .replaceAll('"what-framework/render"', JSON.stringify(CORE_RENDER))
    .replaceAll("'what-framework/render'", JSON.stringify(CORE_RENDER))
    .replaceAll('"what-framework"', JSON.stringify(CORE_INDEX))
    .replaceAll("'what-framework'", JSON.stringify(CORE_INDEX));

  const file = path.join(tmpDir, `mod-${moduleId++}.mjs`);
  writeFileSync(file, out);
  return import(pathToFileURL(file).href);
}

const { mount } = await import(pathToFileURL(CORE_INDEX).href);

const tick = () => new Promise((r) => setTimeout(r, 0));

function render(node) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mount(node, host);
  return host;
}

async function renderApp(body, preamble = '') {
  const mod = await compileAndLoad(`
    import { signal, Switch, Match } from 'what-framework';
    ${preamble}
    export function App() {
      return ${body};
    }
  `);
  return render(mod.App());
}

describe('compiled Switch/Match', () => {
  it('renders the first matching Match', async () => {
    const host = await renderApp(`(
      <Switch fallback={<p>none</p>}>
        <Match when={false}><p>a</p></Match>
        <Match when={true}><p>b</p></Match>
        <Match when={true}><p>c</p></Match>
      </Switch>
    )`);
    assert.match(host.innerHTML, /<p>b<\/p>/);
    assert.doesNotMatch(host.innerHTML, /<p>a<\/p>/);
    assert.doesNotMatch(host.innerHTML, /<p>c<\/p>/);
    assert.doesNotMatch(host.innerHTML, /none/);
    host.remove();
  });

  it('renders the fallback when nothing matches', async () => {
    const host = await renderApp(`(
      <Switch fallback={<p>none</p>}>
        <Match when={false}><p>a</p></Match>
      </Switch>
    )`);
    assert.match(host.innerHTML, /<p>none<\/p>/);
    assert.doesNotMatch(host.innerHTML, /<p>a<\/p>/);
    host.remove();
  });

  it('renders nothing when nothing matches and there is no fallback', async () => {
    const host = await renderApp(`(
      <Switch>
        <Match when={false}><p>a</p></Match>
      </Switch>
    )`);
    assert.doesNotMatch(host.innerHTML, /<p>/);
    host.remove();
  });

  it('does not build the DOM of a branch that is not taken', async () => {
    const mod = await compileAndLoad(`
      import { Switch, Match } from 'what-framework';
      export let built = 0;
      export function bump() { built++; return 'x'; }
      function Heavy() { bump(); return <p>heavy</p>; }
      export function App() {
        return (
          <Switch fallback={<p>none</p>}>
            <Match when={false}><Heavy /></Match>
            <Match when={true}><p>taken</p></Match>
          </Switch>
        );
      }
    `);
    const host = render(mod.App());
    assert.match(host.innerHTML, /<p>taken<\/p>/);
    assert.doesNotMatch(host.innerHTML, /heavy/);
    host.remove();
  });

  it('tracks a reactive when and swaps the active arm', async () => {
    const mod = await compileAndLoad(`
      import { signal, Switch, Match } from 'what-framework';
      export const step = signal(0);
      export function App() {
        return (
          <div>
            <Switch fallback={<p>none</p>}>
              <Match when={() => step() === 1}><p>one</p></Match>
              <Match when={() => step() === 2}><p>two</p></Match>
            </Switch>
          </div>
        );
      }
    `);
    const host = render(mod.App());
    assert.match(host.innerHTML, /<p>none<\/p>/);
    mod.step(1);
    await tick();
    assert.match(host.innerHTML, /<p>one<\/p>/);
    assert.doesNotMatch(host.innerHTML, /<p>two<\/p>/);
    mod.step(2);
    await tick();
    assert.match(host.innerHTML, /<p>two<\/p>/);
    assert.doesNotMatch(host.innerHTML, /<p>one<\/p>/);
    host.remove();
  });

  it('works as a child of a host element', async () => {
    const host = await renderApp(`(
      <div class="wrap">
        <Switch fallback={<p>none</p>}>
          <Match when={true}><span>hit</span></Match>
        </Switch>
      </div>
    )`);
    assert.equal(host.querySelector('.wrap span').textContent, 'hit');
    host.remove();
  });

  it('lowers to a thunk rather than a _$createComponent(Switch) call', () => {
    const code = compile(`
      export const A = () => (
        <Switch fallback={<p>none</p>}>
          <Match when={true}><p>a</p></Match>
        </Switch>
      );
    `);
    assert.doesNotMatch(code, /_\$createComponent\(Switch/);
    assert.doesNotMatch(code, /_\$createComponent\(Match/);
  });

  it('renders a lone compiled Match instead of recursing forever', async () => {
    const host = await renderApp(`(
      <div><Match when={true}><p>solo</p></Match></div>
    )`);
    assert.match(host.innerHTML, /<p>solo<\/p>/);
    host.remove();
  });

  it('skips a lone compiled Match whose when is false', async () => {
    const host = await renderApp(`(
      <div><Match when={false}><p>solo</p></Match></div>
    )`);
    assert.doesNotMatch(host.innerHTML, /solo/);
    host.remove();
  });

  it('falls back to the runtime component when children are not plain Matches', () => {
    const code = compile(`
      export const A = ({ arms }) => (
        <Switch fallback={<p>none</p>}>{arms}</Switch>
      );
    `);
    assert.match(code, /_\$createComponent\(Switch/);
  });
});

// Lowering Switch must not perturb host-element output: the deferred-children
// work was only acceptable because plain DOM trees compile byte-identically.
describe('host-element codegen', () => {
  it('emits an unchanged template and setup for a plain DOM tree', () => {
    const code = compile(`
      export function Card({ title, onPick }) {
        return (
          <div class="card" id="c1">
            <h2 class="t">{title}</h2>
            <p>static text</p>
            <button onclick={onPick}>Pick</button>
          </div>
        );
      }
    `);

    assert.ok(
      code.includes('const _tmpl$0 = /* @__PURE__ */_$template("<div class=\\"card\\" id=\\"c1\\"><h2 class=\\"t\\"><!--$--></h2><p>static text</p><button>Pick</button></div>");'),
      `template literal changed:\n${code}`
    );
    assert.ok(code.includes('const _el$0 = _tmpl$0();'), code);
    assert.ok(code.includes('const _el$1 = _el$0.firstChild;'), code);
    assert.ok(code.includes('const _el$2 = _el$1.nextSibling.nextSibling;'), code);
    assert.ok(code.includes('_$insert(_el$1, () => title, _el$1.firstChild);'), code);
    assert.ok(code.includes('_el$2.$$click = onPick;'), code);
    assert.doesNotMatch(code, /_\$createComponent/);
  });
});
