// ErrorBoundary and Suspense on the COMPILED-JSX path.
// A boundary only catches what is built while its boundary context is on the
// component stack. Compiled children arrive behind a factory, so when the
// boundary component realizes them matters: realize them in the component body
// and the subtree is built before the boundary context exists, which sends
// throws and suspensions to the ENCLOSING boundary instead.

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

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-bounds-'));
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

// The runtime logs caught errors; keep the test output readable.
function quietly(fn) {
  const real = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = real; }
}

function render(node) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  quietly(() => mount(node, host));
  return host;
}

describe('compiled JSX: ErrorBoundary', () => {
  it('renders the fallback when a child throws during render', async () => {
    const mod = await compileAndLoad(`
      import { ErrorBoundary } from 'what-framework';
      function Boom() { throw new Error('boom'); }
      export function App() {
        return <ErrorBoundary fallback={<p class="fb">caught</p>}><Boom /></ErrorBoundary>;
      }
    `);
    const host = render(mod.App());
    await tick();
    assert.equal(host.querySelector('.fb')?.textContent, 'caught');
    host.remove();
  });

  it('does not let the error escape mount()', async () => {
    const mod = await compileAndLoad(`
      import { ErrorBoundary } from 'what-framework';
      function Boom() { throw new Error('boom'); }
      export function App() {
        return <ErrorBoundary fallback={<p class="fb">caught</p>}><Boom /></ErrorBoundary>;
      }
    `);
    const host = document.createElement('div');
    document.body.appendChild(host);
    quietly(() => {
      assert.doesNotThrow(() => mount(mod.App(), host), 'the boundary must swallow the throw');
    });
    host.remove();
  });

  it('gives the innermost boundary the error, not the enclosing one', async () => {
    const mod = await compileAndLoad(`
      import { ErrorBoundary } from 'what-framework';
      function Boom() { throw new Error('boom'); }
      export function App() {
        return (
          <ErrorBoundary fallback={<p class="outer">outer</p>}>
            <div class="mid">
              <ErrorBoundary fallback={<p class="inner">inner</p>}>
                <Boom />
              </ErrorBoundary>
            </div>
          </ErrorBoundary>
        );
      }
    `);
    const host = render(mod.App());
    await tick();
    assert.ok(host.querySelector('.inner'), 'the inner boundary must catch');
    assert.equal(host.querySelector('.outer'), null, 'the outer boundary must not be reached');
    assert.ok(host.querySelector('.mid'), 'only the inner subtree is replaced');
    host.remove();
  });

  it('leaves a non-throwing subtree alone', async () => {
    const mod = await compileAndLoad(`
      import { ErrorBoundary } from 'what-framework';
      export function App() {
        return <ErrorBoundary fallback={<p class="fb">caught</p>}><p class="ok">fine</p></ErrorBoundary>;
      }
    `);
    const host = render(mod.App());
    assert.equal(host.querySelector('.ok')?.textContent, 'fine');
    assert.equal(host.querySelector('.fb'), null);
    host.remove();
  });
});

// Wrapping a boundary or a provider in your own component is a mainstream
// pattern, and it only works if the wrapper's children stay unbuilt until the
// component it forwards them to has run. Destructuring `children` in the
// parameter list reads them before the body starts, so the compiler rewrites a
// parameter whose `children` binding is only ever forwarded; forwarding
// `props.children` instead is an expression child, which the compiler defers.
describe('compiled JSX: user components that forward children', () => {
  const wrappers = {
    'destructured parameter': 'function MyBoundary({ children, fallback }) { return <ErrorBoundary fallback={fallback}>{children}</ErrorBoundary>; }',
    'props.children': 'function MyBoundary(props) { return <ErrorBoundary fallback={props.fallback}>{props.children}</ErrorBoundary>; }',
    'explicit _deferChildren': 'function MyBoundary({ children, fallback }) { return <ErrorBoundary fallback={fallback}>{children}</ErrorBoundary>; }\nMyBoundary._deferChildren = true;',
  };

  for (const [shape, wrapper] of Object.entries(wrappers)) {
    it(`catches through a boundary wrapper written with a ${shape}`, async () => {
      const mod = await compileAndLoad(`
        import { ErrorBoundary } from 'what-framework';
        function Boom() { throw new Error('boom'); }
        ${wrapper}
        export function App() {
          return <MyBoundary fallback={<p class="fb">caught</p>}><Boom /></MyBoundary>;
        }
      `);
      const host = document.createElement('div');
      document.body.appendChild(host);
      quietly(() => {
        assert.doesNotThrow(() => mount(mod.App(), host), 'the throw must not escape mount()');
      });
      await tick();
      assert.equal(host.querySelector('.fb')?.textContent, 'caught');
      host.remove();
    });
  }

  for (const [shape, wrapper] of Object.entries({
    'destructured parameter': 'function ThemeProvider({ children }) { return <Theme.Provider value="DARK">{children}</Theme.Provider>; }',
    'props.children': 'function ThemeProvider(props) { return <Theme.Provider value="DARK">{props.children}</Theme.Provider>; }',
  })) {
    it(`resolves context through a provider wrapper written with a ${shape}`, async () => {
      const mod = await compileAndLoad(`
        import { createContext, useContext } from 'what-framework';
        const Theme = createContext('LIGHT');
        ${wrapper}
        function Leaf() {
          const t = useContext(Theme);
          return <p class="t">{typeof t === 'function' ? t() : t}</p>;
        }
        export function App() { return <ThemeProvider><Leaf /></ThemeProvider>; }
      `);
      const host = render(mod.App());
      await tick();
      assert.equal(host.querySelector('.t')?.textContent, 'DARK', 'the consumer must not read the default');
      host.remove();
    });
  }

  it('leaves children realized for a component that inspects them', async () => {
    const mod = await compileAndLoad(`
      export const seen = [];
      function Tabs({ children }) {
        seen.push(Array.isArray(children), children.length);
        return <div class="tabs">{children}</div>;
      }
      export function App() {
        return <Tabs><p class="a">a</p><p class="b">b</p></Tabs>;
      }
    `);
    const host = render(mod.App());
    assert.deepEqual(mod.seen, [true, 2], 'an inspecting component still gets a real array');
    assert.ok(host.querySelector('.tabs .a') && host.querySelector('.tabs .b'));
    host.remove();
  });

  it('rewrites only a children binding that is never inspected', () => {
    const forwarded = compile('function W({ children }) { return <Panel>{children}</Panel>; }');
    assert.match(forwarded, /_props\.children/, 'a pure forward moves to a lazy read');

    const inspected = compile('function W({ children }) { return <Panel>{children.length}{children}</Panel>; }');
    assert.doesNotMatch(inspected, /_props\.children/, 'an inspected binding keeps its destructuring');
  });
});

describe('compiled JSX: Suspense', () => {
  it('renders the fallback for a suspending child, then the real content', async () => {
    const mod = await compileAndLoad(`
      import { Suspense } from 'what-framework';
      let release;
      let ready = false;
      const pending = new Promise((r) => { release = r; });
      export function finish() { ready = true; release(); }
      function Slow() {
        if (!ready) throw pending;
        return <p class="done">done</p>;
      }
      export function App() {
        return <Suspense fallback={<p class="fb">waiting</p>}><Slow /></Suspense>;
      }
    `);
    const host = render(mod.App());
    await tick();
    assert.equal(host.querySelector('.fb')?.textContent, 'waiting', 'the fallback shows while pending');
    assert.equal(host.querySelector('.done'), null);

    mod.finish();
    await tick();
    await tick();

    assert.equal(host.querySelector('.done')?.textContent, 'done', 'content replaces the fallback on resolve');
    assert.equal(host.querySelector('.fb'), null);
    host.remove();
  });

  it('does not let the suspension escape mount()', async () => {
    const mod = await compileAndLoad(`
      import { Suspense } from 'what-framework';
      // One stable pending promise. A child that throws a NEW promise on every
      // attempt suspends forever by construction, in this framework and others.
      const pending = new Promise(() => {});
      function Slow() { throw pending; }
      export function App() {
        return <Suspense fallback={<p class="fb">waiting</p>}><Slow /></Suspense>;
      }
    `);
    const host = document.createElement('div');
    document.body.appendChild(host);
    quietly(() => {
      assert.doesNotThrow(() => mount(mod.App(), host), 'the boundary must absorb the thenable');
    });
    await tick();
    assert.equal(host.querySelector('.fb')?.textContent, 'waiting');
    host.remove();
  });
});
