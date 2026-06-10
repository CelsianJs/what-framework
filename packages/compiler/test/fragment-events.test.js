// Regression tests: top-level JSX fragments whose element children carry
// event handlers (or any dynamic parts).
//
// BUG (sprint/v0.11-quality): the JSXFragment visitor called
// transformFragmentFineGrained — which routes element children through
// transformElementFineGrained — but never drained state._pendingSetup.
// The element transform pushes its setup statements
// (`const _el$N = _tmpl$X(); _el$N.$$click = ...`) into _pendingSetup and
// returns the bare `_el$N` identifier, so fragments compiled to references
// to variables that were never declared: ReferenceError at runtime.
//
// Fix: JSXElement and JSXFragment now share one driver (transformJsxRoot)
// that hoists pending setup before the enclosing statement, or falls back
// to an IIFE across function boundaries / single-statement positions.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import babelPlugin from '../src/babel-plugin.js';

// --- jsdom globals (before importing any core module) ---
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;
global.Node = dom.window.Node;
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_INDEX = path.resolve(__dirname, '../../core/src/index.js');
const CORE_RENDER = path.resolve(__dirname, '../../core/src/render.js');

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

// Structural invariant: every `_el$N` referenced in the output must be
// declared somewhere in the output. (The bug emitted refs with no decl.)
function assertAllElRefsDeclared(code) {
  const declared = new Set(
    [...code.matchAll(/(?:const|let|var)\s+(_el\$\d+)/g)].map((m) => m[1])
  );
  const referenced = new Set([...code.matchAll(/_el\$\d+/g)].map((m) => m[0]));
  const undeclared = [...referenced].filter((r) => !declared.has(r));
  assert.deepEqual(
    undeclared,
    [],
    `compiled output references undeclared element vars: ${undeclared.join(', ')}\n--- output ---\n${code}`
  );
}

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-fragment-events-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });
let moduleId = 0;

// Compile JSX source and import the resulting module against local core.
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

const { flushSync } = await import(pathToFileURL(CORE_INDEX).href);

function click(el) {
  el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
}

describe('fragment events: structural (no undeclared _el$ refs)', () => {
  it('single element child with delegated handler (original repro)', () => {
    const code = compile(`
      function App() {
        return (<>
          <button onclick={() => x()}>hi</button>
        </>);
      }
    `);
    assertAllElRefsDeclared(code);
    // The handler must actually be wired (delegated $$click).
    assert.match(code, /_el\$\d+\.\$\$click = /);
  });

  it('multiple element children mixing delegated and non-delegated handlers', () => {
    const code = compile(`
      function App() {
        return (<>
          <button onclick={() => a()}>A</button>
          <button onmouseenter={() => b()}>B</button>
        </>);
      }
    `);
    assertAllElRefsDeclared(code);
    assert.match(code, /_el\$\d+\.\$\$click = /, 'click is delegated');
    assert.match(code, /_el\$\d+\.addEventListener\("mouseenter"/, 'mouseenter is direct');
    assert.match(code, /return \[_el\$\d+, _el\$\d+\]/, 'fragment returns an array of both elements');
  });

  it('nested fragments with handlers in the inner fragment', () => {
    const code = compile(`
      function App() {
        return (<>
          <span>t</span>
          <>
            <button onclick={() => inner()}>in</button>
          </>
        </>);
      }
    `);
    assertAllElRefsDeclared(code);
    assert.match(code, /_el\$\d+\.\$\$click = /);
  });

  it('fragment children mixing text, expressions, and elements with handlers', () => {
    const code = compile(`
      import { signal } from 'what-framework';
      function App() {
        const count = signal(0);
        return (<>
          before
          {count()}
          <button onclick={() => count(c => c + 1)}>inc</button>
        </>);
      }
    `);
    assertAllElRefsDeclared(code);
    assert.match(code, /_el\$\d+\.\$\$click = /);
    assert.match(code, /"before"/, 'static text child preserved');
  });

  it('fragment with dynamic attrs composes with C2 specialized setters', () => {
    const code = compile(`
      import { signal } from 'what-framework';
      function App() {
        const cls = signal('on');
        return (<>
          <div class={cls()}>styled</div>
          <button onclick={() => cls('off')}>toggle</button>
        </>);
      }
    `);
    assertAllElRefsDeclared(code);
    assert.match(code, /_\$setClass\(_el\$\d+/, 'specialized class setter targets a declared element');
  });

  it('fragment in an arrow expression body falls back to a self-contained IIFE', () => {
    const code = compile(`
      const make = () => (<>
        <button onclick={() => z()}>z</button>
      </>);
    `);
    assertAllElRefsDeclared(code);
    // Crossing the arrow boundary must not hoist — the decl and the return
    // value live in one IIFE block.
    assert.match(code, /\(\(\) => \{[\s\S]*const _el\$\d+[\s\S]*return _el\$\d+;[\s\S]*\}\)\(\)/);
  });

  it('fragment in single-statement position (if without block) stays self-contained', () => {
    const code = compile(`
      function App(cond) {
        if (cond) return (<>
          <button onclick={() => q()}>q</button>
        </>);
        return null;
      }
    `);
    assertAllElRefsDeclared(code);
  });

  it('fragment inside .map() callback keeps closure variables in scope', () => {
    const code = compile(`
      function List({ items }) {
        return <ul>{items().map(item => (<>
          <li key={item.id}><button onclick={() => pick(item)}>{item.name}</button></li>
        </>))}</ul>;
      }
    `);
    assertAllElRefsDeclared(code);
  });
});

describe('fragment events: runtime (jsdom mount + click)', () => {
  it('clicking a delegated handler inside a fragment updates a signal-bound text', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const count = signal(0);
      export function App() {
        return (<>
          <button onclick={() => count(c => c + 1)}>inc</button>
          <span>{count()}</span>
        </>);
      }
    `);
    // Multi-child fragment returns an array of nodes.
    const out = mod.App();
    assert.ok(Array.isArray(out), 'multi-child fragment returns an array');
    const host = document.createElement('div');
    document.body.appendChild(host);
    for (const node of out) host.appendChild(node);

    const button = host.querySelector('button');
    const span = host.querySelector('span');
    assert.ok(button, 'button mounted');
    assert.equal(span.textContent, '0');

    click(button);
    flushSync();
    assert.equal(mod.count(), 1, 'delegated $$click handler ran');
    assert.equal(span.textContent, '1', 'reactive sibling text updated');

    click(button);
    flushSync();
    assert.equal(span.textContent, '2');
    host.remove();
  });

  it('single-child fragment returns the element itself; click works (original repro)', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const hits = signal(0);
      export function App() {
        return (<>
          <button onclick={() => hits(h => h + 1)}>hi</button>
        </>);
      }
    `);
    const el = mod.App();
    assert.ok(el instanceof global.HTMLElement, 'single-child fragment unwraps to the element');
    document.body.appendChild(el);

    click(el);
    flushSync();
    assert.equal(mod.hits(), 1, 'click handler fired');
    el.remove();
  });

  it('non-delegated handler on a fragment child fires', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const entered = signal(false);
      export function App() {
        return (<>
          <button onmouseenter={() => entered(true)}>hover</button>
          <span>x</span>
        </>);
      }
    `);
    const [button] = mod.App();
    document.body.appendChild(button);

    button.dispatchEvent(new dom.window.Event('mouseenter'));
    flushSync();
    assert.equal(mod.entered(), true, 'addEventListener-bound handler fired');
    button.remove();
  });

  it('nested fragment: inner button click works', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const n = signal(0);
      export function App() {
        return (<>
          <span>head</span>
          <>
            <button onclick={() => n(v => v + 10)}>in</button>
          </>
        </>);
      }
    `);
    const out = mod.App();
    const host = document.createElement('div');
    document.body.appendChild(host);
    // Flatten: nested fragments may yield nested arrays.
    (function append(nodes) {
      for (const node of [].concat(nodes)) {
        if (Array.isArray(node)) append(node);
        else host.appendChild(node);
      }
    })(out);

    const button = host.querySelector('button');
    assert.ok(button, 'inner fragment button mounted');
    click(button);
    flushSync();
    assert.equal(mod.n(), 10, 'inner fragment delegated handler ran');
    host.remove();
  });
});
