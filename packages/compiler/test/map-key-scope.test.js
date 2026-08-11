// A `key` expression the extracted key function cannot see must not be lowered
// to keyed reconciliation.
//
// The compiler rebuilds the key as `(item) => keyExpr` and hoists it out of the
// map callback, so it receives ONLY the first parameter. `key={i}` therefore
// compiled to:
//
//   _$mapArray(() => items(), (t, i) => ..., { key: t => i, raw: true })
//                                                        ^ free variable
//
// and the failure mode was the quiet kind. The first render was correct. The
// first update threw `ReferenceError: i is not defined` inside the reconciler's
// effect, the effect error handler swallowed it into one console.error, and the
// list stayed frozen on its initial contents for the rest of the session. No
// exception reached the page, nothing looked broken in a screenshot, and the
// framework's own tutorial taught the pattern.
//
// Two things had to be true at once for it to show up: a `.map()` with a key
// AND an update to the source array. Compiler tests asserted on emitted code
// and never ran it; runtime tests ran hand-written mapArray calls with real key
// functions. Broken only in combination.
//
// The same hole swallowed any key built from a variable declared in the
// callback body, for exactly the same reason.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-key-scope-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

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

async function load(source) {
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

/** Everything the module logged, so a swallowed error cannot pass as silence. */
function captureConsole(fn) {
  const seen = [];
  const { warn, error } = console;
  console.warn = (...a) => seen.push(`warn: ${a.join(' ')}`);
  console.error = (...a) => seen.push(`error: ${a.join(' ')}`);
  try { fn(); } finally { console.warn = warn; console.error = error; }
  return seen;
}

function quietCompile(source) {
  let code;
  captureConsole(() => { code = compile(source); });
  return code;
}

/** Render, then push a reordered + extended array, and report both states. */
async function renderThenUpdate(source, nextItems) {
  let mod;
  const compileLog = [];
  {
    const { warn } = console;
    console.warn = (...a) => compileLog.push(a.join(' '));
    try { mod = await load(source); } finally { console.warn = warn; }
  }
  const el = mod.App();
  document.body.appendChild(el);
  flushSync();
  const initial = el.textContent;
  const runtimeLog = captureConsole(() => {
    mod.items(nextItems);
    flushSync();
  });
  const updated = el.textContent;
  el.remove();
  return { initial, updated, runtimeLog, compileLog };
}

describe('a key the key function cannot reach falls back instead of breaking', () => {
  it('keeps an index-keyed list updating', async () => {
    const { initial, updated, runtimeLog } = await renderThenUpdate(`
      import { signal } from 'what-framework';
      export const items = signal([{ name: 'a' }, { name: 'b' }]);
      export function App() {
        return <ul>{items().map((t, i) => <li key={i}>{t.name}</li>)}</ul>;
      }
    `, [{ name: 'b' }, { name: 'a' }, { name: 'c' }]);

    assert.equal(initial, 'ab');
    assert.equal(updated, 'bac', 'the list froze on its first render');
    assert.deepEqual(runtimeLog, [], 'the update logged a swallowed error');
  });

  it('keeps a list updating when the key interpolates the index', async () => {
    const { initial, updated, runtimeLog } = await renderThenUpdate(`
      import { signal } from 'what-framework';
      export const items = signal([{ type: 'x', name: 'a' }, { type: 'y', name: 'b' }]);
      export function App() {
        return <ul>{items().map((t, i) => <li key={\`\${t.type}-\${i}\`}>{t.name}</li>)}</ul>;
      }
    `, [{ type: 'y', name: 'b' }, { type: 'x', name: 'a' }, { type: 'z', name: 'c' }]);

    assert.equal(initial, 'ab');
    assert.equal(updated, 'bac');
    assert.deepEqual(runtimeLog, []);
  });

  it('keeps a list updating when the key comes from a variable in the callback body', async () => {
    const { initial, updated, runtimeLog } = await renderThenUpdate(`
      import { signal } from 'what-framework';
      export const items = signal([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
      export function App() {
        return <ul>{items().map((t) => {
          const rowKey = 'row-' + t.id;
          return <li key={rowKey}>{t.name}</li>;
        })}</ul>;
      }
    `, [{ id: 2, name: 'b' }, { id: 1, name: 'a' }, { id: 3, name: 'c' }]);

    assert.equal(initial, 'ab');
    assert.equal(updated, 'bac');
    assert.deepEqual(runtimeLog, []);
  });

  it('does not emit a key function with a free variable', async () => {
    // The direct assertion on the defect: whatever the compiler emits, the key
    // function must not read a name nothing binds.
    for (const key of ['i', '`${t.type}-${i}`', 'i + 1']) {
      const code = quietCompile(
        `const A = () => <ul>{items().map((t, i) => <li key={${key}}>{t.name}</li>)}</ul>;`,
      );
      const emitted = /key:\s*[^\n]*/.exec(code)?.[0] ?? '';
      assert.ok(
        !/key:\s*\w+\s*=>[^\n]*\bi\b/.test(emitted),
        `emitted a key function reading the unbound index: ${emitted}`,
      );
    }
  });

  it('warns at compile time, naming the unreachable binding', async () => {
    const log = captureConsole(() => {
      compile('const A = () => <ul>{items().map((t, i) => <li key={`${t.type}-${i}`}>{t.name}</li>)}</ul>;');
    });
    const warning = log.find((l) => l.includes('key='));
    assert.ok(warning, `no warning for an index-derived key: ${JSON.stringify(log)}`);
    assert.match(warning, /`i`/, 'the warning should name the binding');
    assert.match(warning, /position/, 'the warning should explain why an index-derived key cannot work');
    assert.match(warning, /key=\{item\.id\}/, 'the warning should show the fix');
  });

  it('says nothing about a bare index key', () => {
    // `key={i}` is a deliberate statement that position IS identity, and
    // positional reconciliation is exactly that, so there is no edit that would
    // improve the output and nothing to interrupt anyone about. The framework's
    // own tutorial keys a fixed nine-square board this way; a build warning on
    // step two of a beginner tutorial reads as something being broken.
    for (const src of [
      'const A = () => <ul>{items().map((t, i) => <li key={i}>{t.name}</li>)}</ul>;',
      'const A = () => <ul>{history().map((_, move) => <li key={move}>{move}</li>)}</ul>;',
    ]) {
      const log = captureConsole(() => compile(src));
      assert.deepEqual(log, [], `a bare index key should be silent: ${JSON.stringify(log)}`);
    }
  });

  it('still warns when the index is only part of the key', () => {
    // These are the dangerous ones: they LOOK like a stable composite identity
    // and change the moment a row moves.
    for (const key of ['`${t.type}-${i}`', 'i + 1', 'String(i)']) {
      const src = `const A = () => <ul>{items().map((t, i) => <li key={${key}}>{t.name}</li>)}</ul>;`;
      const log = captureConsole(() => compile(src));
      assert.ok(
        log.some((l) => l.includes('key=')),
        `key={${key}} should warn, it reads as stable and is not: ${JSON.stringify(log)}`,
      );
    }
  });
});

describe('reachable keys still get keyed reconciliation', () => {
  const lowers = (source) => quietCompile(source).includes('_$mapArray');

  it('lowers a key read off the item', () => {
    assert.ok(lowers('const A = () => <ul>{items().map((t, i) => <li key={t.id}>{t.name}</li>)}</ul>;'));
  });

  it('lowers a key read off a destructured item parameter', () => {
    assert.ok(lowers('const A = () => <ul>{items().map(({ id, name }, i) => <li key={id}>{name}</li>)}</ul>;'));
  });

  it('lowers a key that closes over a variable from outside the callback', () => {
    assert.ok(lowers(
      'const prefix = "p"; const A = () => <ul>{items().map((t) => <li key={prefix + t.id}>{t.name}</li>)}</ul>;',
    ));
  });

  it('does not mistake a property named like the index for the index', () => {
    // `t.i` is a property access, not a read of the `i` parameter.
    assert.ok(lowers('const A = () => <ul>{items().map((t, i) => <li key={t.i}>{t.name}</li>)}</ul>;'));
  });

  it('does not mistake a nested callback parameter for one in scope', () => {
    // The `i` belongs to the inner forEach, not to the key.
    assert.ok(lowers(
      'const A = () => <ul>{items().map((t) => { t.tags.forEach((x, i) => x); return <li key={t.id}>{t.name}</li>; })}</ul>;',
    ));
  });

  it('still reorders correctly through the keyed path', async () => {
    const { initial, updated, runtimeLog } = await renderThenUpdate(`
      import { signal } from 'what-framework';
      export const items = signal([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
      export function App() {
        return <ul>{items().map((t) => <li key={t.id}>{t.name}</li>)}</ul>;
      }
    `, [{ id: 2, name: 'b' }, { id: 1, name: 'a' }, { id: 3, name: 'c' }]);

    assert.equal(initial, 'ab');
    assert.equal(updated, 'bac');
    assert.deepEqual(runtimeLog, []);
  });
});
