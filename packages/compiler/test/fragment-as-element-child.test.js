// A JSX fragment used as a child of an ELEMENT (not as the root) was lowered by
// a branch that handled expression children only, and inserted them with no
// anchor. Three failures, all silent:
//
//   <span><>plain</>{x}</span>        -> <span>x</span>       text dropped
//   <span><><b>c</b></>{x}</span>     -> <span>x</span>       element dropped
//   <span><>{"A"}</>{"C"}</span>      -> <span>CA</span>      order reversed
//
// Nothing failed, nothing warned, the markup was simply not what was written.
// Found by packages/compiler/test/lowering-parity-fuzz.test.js: 62 of its first
// 300 random trees diverged from the equivalent h() tree, all of them here.

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

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-fragment-child-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

let moduleId = 0;

async function build(jsx, values = []) {
  const code = transformSync(`export function build(s) { return ${jsx}; }`, {
    filename: 'fixture.jsx',
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
  }).code
    .replaceAll('"what-framework/render"', JSON.stringify(CORE_RENDER))
    .replaceAll('"what-framework"', JSON.stringify(CORE_INDEX));
  const file = path.join(tmpDir, `mod-${moduleId++}.mjs`);
  writeFileSync(file, code);
  const mod = await import(pathToFileURL(file).href);
  const signals = values.map((v, i) => signal(v, `s${i}`));
  const el = mod.build(signals);
  flushSync();
  // Every comment is compiler or runtime bookkeeping: the `<!--$-->` slot
  // markers and the `<!--i-->`/`<!--/list-->` bookends mapArray keeps around
  // its rows. What is asserted here is the visible markup and its order.
  return { el, signals, html: () => el.innerHTML.replace(/<!--.*?-->/g, '') };
}

describe('a fragment as a child of an element', () => {
  it('keeps its text children', async () => {
    const { html } = await build('<span><>plain text</>{s[0]()}</span>', ['x']);
    assert.equal(html(), 'plain textx');
  });

  it('keeps its element children', async () => {
    const { html } = await build('<span><><b>bold</b></>{s[0]()}</span>', ['x']);
    assert.equal(html(), '<b>bold</b>x');
  });

  it('keeps the order of mixed children', async () => {
    const { html } = await build('<span><>{"A"}<b>bold</b>{"C"}</></span>');
    assert.equal(html(), 'A<b>bold</b>C');
  });

  it('stays in position among its siblings', async () => {
    const { html } = await build('<div><i>first</i><>middle</><u>last</u></div>');
    assert.equal(html(), '<i>first</i>middle<u>last</u>');
  });

  it('places two adjacent fragments in order', async () => {
    const { html } = await build('<span><>{"B"}</><>{"C"}</>{"D"}</span>');
    assert.equal(html(), 'BCD');
  });

  it('flattens a nested fragment at the same position', async () => {
    const { html } = await build('<span>{"1"}<><>{"2"}</>{"3"}</>{"4"}</span>');
    assert.equal(html(), '1234');
  });

  it('keeps a reactive child inside a fragment reactive', async () => {
    const { html, signals } = await build('<span>[<>{() => s[0]()}</>]</span>', ['one']);
    assert.equal(html(), '[one]');
    signals[0]('two');
    flushSync();
    assert.equal(html(), '[two]');
  });
});

// Mount order is not the whole contract. Every child of the fragment used to
// insert before ONE shared marker, which holds order at mount and then loses it:
// the first time a reactive region re-runs, reconcileInsert re-places its nodes
// before that shared marker, landing them after every sibling already inserted
// there. So the assertions below all pass at mount and only diverge after the
// first write, which is why the mount-order tests above could not see this.
describe('a fragment as a child of an element, after a region re-runs', () => {
  it('keeps a keyed list ahead of the sibling written after it', async () => {
    const { html, signals } = await build(
      '<div><>{() => s[0]().map(i => <li key={i}>{i}</li>)}<p>footer</p></></div>',
      [['a', 'b']],
    );
    assert.equal(html(), '<li>a</li><li>b</li><p>footer</p>');
    signals[0](['a', 'b', 'c']);
    flushSync();
    assert.equal(html(), '<li>a</li><li>b</li><li>c</li><p>footer</p>');
  });

  it('keeps an unkeyed list ahead of the sibling written after it', async () => {
    const { html, signals } = await build(
      '<div><>{() => s[0]().map(i => <li>{i}</li>)}<p>footer</p></></div>',
      [['a', 'b']],
    );
    assert.equal(html(), '<li>a</li><li>b</li><p>footer</p>');
    signals[0](['a', 'b', 'c']);
    flushSync();
    assert.equal(html(), '<li>a</li><li>b</li><li>c</li><p>footer</p>');
  });

  // Element-to-element is the one arm swap that survived the shared anchor,
  // because reconcileInsert swaps a single node for a single node in place and
  // never consults the anchor. The arms below change the node COUNT or the
  // value's type, which is what sends the region back to the anchor.
  it('keeps a toggled ternary arm ahead of the sibling written after it', async () => {
    const { html, signals } = await build(
      '<div><>{() => s[0]() ? <b>on</b> : "off"}<u>tail</u></></div>',
      [true],
    );
    assert.equal(html(), '<b>on</b><u>tail</u>');
    signals[0](false);
    flushSync();
    assert.equal(html(), 'off<u>tail</u>');
  });

  it('keeps a toggled && arm ahead of the sibling written after it', async () => {
    const { html, signals } = await build(
      '<div><>{() => s[0]() && <b>on</b>}<u>tail</u></></div>',
      [false],
    );
    assert.equal(html(), '<u>tail</u>');
    signals[0](true);
    flushSync();
    assert.equal(html(), '<b>on</b><u>tail</u>');
  });

  // Both regions start on the text fast path, which updates a text node's data
  // in place. Writing an array takes them off it and back through
  // reconcileInsert, where the anchor decides where the nodes land.
  it('keeps two reactive regions in the order they were written', async () => {
    const { html, signals } = await build(
      '<div><>{() => s[0]()}{() => s[1]()}</></div>',
      ['first', 'second'],
    );
    assert.equal(html(), 'firstsecond');
    signals[0](['a']);
    flushSync();
    assert.equal(html(), 'asecond');
    signals[1](['b']);
    flushSync();
    assert.equal(html(), 'ab');
  });
});
