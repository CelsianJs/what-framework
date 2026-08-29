// A signal read written as a COMPONENT's child was evaluated once and never
// again.
//
//   <div>{count()}</div>     reactive
//   <Box>{count()}</Box>     frozen at whatever count() returned first
//
// Same file, same signal, one character of difference, and no error, no warning
// and no missing markup to notice it by — just a number that stops moving. This
// is the exact failure mode accessor-auto-thunk.test.js was written for, in the
// one JSX position that fix did not reach.
//
// docs/GOTCHAS.md section 2 promises the wrap without qualification ("any call
// with no arguments is treated as a possible accessor read"), and lists no
// exception for component children. The element-child path and the fragment
// path both route expressions through lowerFragmentExprChild; the component
// children path pushed the raw expression instead.
//
// Found by the lowering-parity fuzzer, which reported 41 of 400 component trees
// and 13 of 150 island trees diverging from their h() spelling AFTER a write.
//
// Every assertion compares against the h() spelling rather than a hand-written
// expectation, because the h() tree is the definition of what the JSX means.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import babelPlugin from '../src/babel-plugin.js';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_INDEX = path.resolve(__dirname, '../../core/src/index.js');
const CORE_RENDER = path.resolve(__dirname, '../../core/src/render.js');

const { signal, flushSync } = await import('../../core/src/reactive.js');

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-component-child-thunk-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* already gone */ } });

const q = s => JSON.stringify(s);
let moduleId = 0;

function localize(code) {
  return code
    .replaceAll('"what-framework/render"', q(CORE_RENDER))
    .replaceAll("'what-framework/render'", q(CORE_RENDER))
    .replaceAll('"what-framework"', q(CORE_INDEX))
    .replaceAll("'what-framework'", q(CORE_INDEX));
}

async function load(code) {
  const file = path.join(tmpDir, `mod-${moduleId++}.mjs`);
  writeFileSync(file, code);
  return import(pathToFileURL(file).href);
}

// `Box` renders its children between two static siblings, so an insertion at
// the wrong offset is visible and not just an absent update.
const BOX = `function Box(props) { return h("div", {}, "[", props.children, "]"); }\n` +
  `function Chart(props) { return h("span", {}, props.children); }`;

async function loadJSX(body) {
  const compiled = transformSync(
    `import { h } from ${q(CORE_INDEX)};\n${BOX}\nexport function build(s) { return ${body}; }`,
    {
      filename: 'fixture.jsx',
      plugins: [[babelPlugin, { production: false }]],
      parserOpts: { plugins: ['jsx'] },
      configFile: false,
      babelrc: false,
      compact: false,
    },
  ).code;
  return { mod: await load(localize(compiled)), code: compiled };
}

function loadH(body) {
  return load(`import { h } from ${q(CORE_INDEX)};\n${BOX}\nexport function build(s) { return ${body}; }`);
}

const { mount } = await import('../../core/src/dom.js');

function mountInto(built, container) {
  if (built && typeof built.nodeType === 'number') container.appendChild(built);
  else if (Array.isArray(built)) built.forEach(item => mountInto(item, container));
  else mount(built, container);
}

// Mount one arm, read its text, write every signal, read it again.
async function textBeforeAndAfter(mod, first, second) {
  const signals = first.map((v, i) => signal(v, `s${i}`));
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    mountInto(mod.build(signals), host);
    flushSync();
    const before = host.textContent;
    second.forEach((v, i) => signals[i](v));
    flushSync();
    return [before, host.textContent];
  } finally {
    host.remove();
  }
}

// The whole contract in one helper: compiled JSX and the h() tree it lowers to
// must agree both before and after a write.
async function assertParity(jsx, hSrc, first, second) {
  const { mod: jsxMod } = await loadJSX(jsx);
  const hMod = await loadH(hSrc);
  const jsxResult = await textBeforeAndAfter(jsxMod, first, second);
  const hResult = await textBeforeAndAfter(hMod, first, second);
  assert.deepEqual(
    jsxResult, hResult,
    `compiled JSX and its h() spelling disagree\n  jsx: ${jsx}\n  h:   ${hSrc}`,
  );
  return jsxResult;
}

describe('component children auto-thunk', () => {
  it('a bare signal read as a component child stays reactive', async () => {
    const [before, after] = await assertParity(
      `<Box>{s[0]()}</Box>`,
      `h(Box, {}, (() => s[0]()))`,
      ['first'], ['second'],
    );
    assert.equal(before, '[first]');
    // The bug in one line: this used to still be "[first]".
    assert.equal(after, '[second]', 'the child must track the signal');
  });

  it('the element spelling right beside it behaves identically', async () => {
    // The comparison that makes the bug a bug rather than a design choice:
    // swapping `Box` for `div` should not change whether the value is live.
    const { mod } = await loadJSX(`<div>{s[0]()}</div>`);
    assert.deepEqual(
      await textBeforeAndAfter(mod, ['first'], ['second']),
      ['first', 'second'],
    );
  });

  it('a read nested among static siblings updates in place', async () => {
    const [before, after] = await assertParity(
      `<Box>{"A"}{s[0]()}{"B"}</Box>`,
      `h(Box, {}, "A", (() => s[0]()), "B")`,
      ['x'], ['y'],
    );
    assert.equal(before, '[AxB]');
    assert.equal(after, '[AyB]');
  });

  it('an explicit arrow child still works', async () => {
    // The guard: this spelling was never broken, and wrapping an arrow again
    // would render a function rather than call it.
    const [, after] = await assertParity(
      `<Box>{() => s[0]()}</Box>`,
      `h(Box, {}, (() => s[0]()))`,
      ['x'], ['y'],
    );
    assert.equal(after, '[y]');
  });

  it('a static child is not wrapped', async () => {
    // The over-correction guard. Wrapping everything would work at runtime but
    // would turn every literal child into an effect, and a component that reads
    // props.children as data would start seeing a function.
    const { code } = await loadJSX(`<Box>{"plain"}</Box>`);
    // The children array is still built lazily — that predates this and is why
    // component children are a factory at all. What matters is what is INSIDE
    // it: the literal itself, not `() => "plain"`.
    assert.match(code, /\(\) => \["plain"\]/);
  });

  it('a keyed .map() child lowers to _$mapArray and reconciles', async () => {
    // Routing component children through the shared helper also gives them the
    // keyed-list lowering that element and fragment children already had.
    const { code } = await loadJSX(`<Box>{s[0]().map(v => <i key={v}>{v}</i>)}</Box>`);
    assert.match(code, /_\$mapArray/);
    const [before, after] = await assertParity(
      `<Box>{s[0]().map(v => <i key={v}>{v}</i>)}</Box>`,
      `h(Box, {}, (() => s[0]().map(v => h("i", { key: v }, v))))`,
      [['a', 'b']], [['b', 'c', 'd']],
    );
    assert.equal(before, '[ab]');
    assert.equal(after, '[bcd]');
  });

  it('an island child is reactive too', async () => {
    // Islands go through the same transformComponentChildren, so they carried
    // the same bug.
    const { mod } = await loadJSX(`<div><Chart client:load>{s[0]()}</Chart></div>`);
    const signals = [signal('first', 'island')];
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      mountInto(mod.build(signals), host);
      flushSync();
      await Promise.resolve();
      await Promise.resolve();
      flushSync();
      assert.equal(host.textContent, 'first');
      signals[0]('second');
      flushSync();
      assert.equal(host.textContent, 'second', 'an island child must track the signal');
    } finally {
      host.remove();
    }
  });
});
