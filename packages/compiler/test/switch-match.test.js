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
    const mod = await compileAndLoad(`
      import { signal, Switch, Match } from 'what-framework';
      export const on = signal(false);
      export function App() {
        return (
          <div>
            <Switch>
              <Match when={on}><p>a</p></Match>
            </Switch>
          </div>
        );
      }
    `);
    const host = render(mod.App());
    assert.doesNotMatch(host.innerHTML, /<p>/, 'no arm matches, so nothing renders');

    // Positive control: the same Switch does render once the arm matches, so
    // the assertion above is about the arm and not about a dead Switch.
    mod.on(true);
    await tick();
    assert.match(host.innerHTML, /<p>a<\/p>/);
    host.remove();
  });

  it('does not build the DOM of a branch that is not taken', async () => {
    const mod = await compileAndLoad(`
      import { Switch, Match } from 'what-framework';
      export const calls = [];
      function Heavy() { calls.push('heavy'); return <p>heavy</p>; }
      function Taken() { calls.push('taken'); return <p>taken</p>; }
      export function App() {
        return (
          <Switch fallback={<p>none</p>}>
            <Match when={false}><Heavy /></Match>
            <Match when={true}><Taken /></Match>
          </Switch>
        );
      }
    `);
    const host = render(mod.App());
    assert.deepEqual(mod.calls, ['taken'], 'only the taken arm may run');
    assert.match(host.innerHTML, /<p>taken<\/p>/);
    assert.doesNotMatch(host.innerHTML, /heavy/);
    host.remove();
  });

  // A memo per arm evaluates every arm's `when` up front, because _$memo runs
  // its body immediately. The runtime Switch stops at the first match, and a
  // later arm that is only safe once an earlier one stops matching (the classic
  // null guard) must not be evaluated behind it.
  it('does not evaluate the when of an arm after the first match', async () => {
    const mod = await compileAndLoad(`
      import { signal, Switch, Match } from 'what-framework';
      export const data = signal(null);
      export function App() {
        return (
          <div>
            <Switch fallback={<p>none</p>}>
              <Match when={() => data() == null}><p>empty</p></Match>
              <Match when={() => data().ok}><p>ok</p></Match>
            </Switch>
          </div>
        );
      }
    `);
    let host;
    assert.doesNotThrow(() => { host = render(mod.App()); },
      'the guarded arm must not be evaluated while the guard arm matches');
    assert.match(host.innerHTML, /<p>empty<\/p>/, 'the first matching arm renders');

    mod.data({ ok: true });
    await tick();
    assert.match(host.innerHTML, /<p>ok<\/p>/, 'the second arm takes over when the first stops matching');
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

  it('skips a lone compiled Match whose when is false, and shows it when true', async () => {
    const mod = await compileAndLoad(`
      import { signal, Match } from 'what-framework';
      export const on = signal(false);
      export function App() { return <div><Match when={on}><p>solo</p></Match></div>; }
    `);
    const host = render(mod.App());
    assert.doesNotMatch(host.innerHTML, /solo/);

    mod.on(true);
    await tick();
    assert.match(host.innerHTML, /<p>solo<\/p>/, 'the same Match renders once its when is true');
    host.remove();
  });

  // A <Switch> the compiler cannot read statically has no working runtime path:
  // its arms compile to built DOM that the runtime Switch cannot match on, so it
  // would render the fallback and nothing else, forever. That must not compile.
  it('fails the build when an expression child is mixed with Match arms', () => {
    assert.throws(
      () => compile(`
        export const A = ({ extra }) => (
          <Switch fallback={<p>none</p>}>
            <Match when={true}><p>a</p></Match>
            {extra}
          </Switch>
        );
      `),
      /<Switch> cannot mix an expression child with its <Match> arms/
    );
  });

  it('fails the build when another element is mixed with Match arms', () => {
    assert.throws(
      () => compile(`
        export const A = () => (
          <Switch>
            <Match when={true}><p>a</p></Match>
            <div>hi</div>
          </Switch>
        );
      `),
      /<Switch> cannot mix other elements with its <Match> arms/
    );
  });

  it('fails the build on a Match with no when', () => {
    assert.throws(
      () => compile(`export const A = () => <Switch><Match><p>a</p></Match></Switch>;`),
      /<Switch> has a <Match> with no "when" prop/
    );
  });

  // "Switch" is Ant Design's, Headless UI's and MUI's toggle component. This
  // dispatches on the bare tag name, so a <Switch> with no <Match> arms must be
  // left alone rather than lowered or rejected.
  it('leaves a third-party Switch alone', () => {
    const code = compile(`
      import { Switch } from 'antd';
      export const A = ({ checked, onChange }) => (
        <Switch checked={checked} onChange={onChange} checkedChildren="ON" />
      );
    `);
    assert.match(code, /_\$createComponent\(Switch, \{/);
  });

  it('leaves a third-party Switch with children alone', () => {
    const code = compile(`
      import { Switch } from '@headlessui/react';
      export const A = ({ arms }) => <Switch className="toggle">{arms}</Switch>;
    `);
    assert.match(code, /_\$createComponent\(Switch, \{/);
  });

  it('never emits a runtime Switch or Match call', () => {
    const code = compile(`
      export const A = ({ n }) => (
        <Switch fallback={<p>none</p>}>
          <Match when={() => n() === 1}><p>one</p></Match>
          <Match when={() => n() === 2}><p>two</p></Match>
        </Switch>
      );
    `);
    assert.doesNotMatch(code, /_\$createComponent\(Switch/);
    assert.doesNotMatch(code, /_\$createComponent\(Match/);
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
