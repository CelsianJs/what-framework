// A reactive region tracked the nodes its value produced as a SNAPSHOT taken
// when that value was inserted, and a keyed/unkeyed list embedded in the value
// keeps editing the DOM inside that snapshot afterwards through its own effect.
// Every row appended after mount was therefore invisible to the region, so
// switching the region off removed the rows that existed at mount and orphaned
// the rest:
//
//   {() => show() && <>{() => items().map(i => <li key={i}>{i}</li>)}<p>z</p></>}
//
//   items = ['a','b']          -> a b z
//   items = ['a','b','c']      -> a b c z
//   show(false)                -> <li>c</li>          (expected: nothing)
//   show(true)                 -> c a b c z           (orphan + a fresh list)
//
// Reported from Chrome against a Vite production build. The fragment is not the
// cause: it only makes the shape common, because a fragment lowers to a plain
// array and an array puts the list back through the same snapshot. A bare
// `{() => show() && items().map(...)}` leaks identically, which is why the
// assertions below cover both.

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

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-conditional-list-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* already gone */ } });

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
  // Comments are compiler and runtime bookkeeping (`<!--$-->` holes, the list's
  // own bookends, the per-item `<!--i-->` markers). What is asserted here is the
  // visible markup, so they are stripped — except where a test names the raw
  // markup, which is where an orphaned row hides.
  return {
    el,
    signals,
    html: () => el.innerHTML.replace(/<!--.*?-->/g, ''),
    write: (index, value) => { signals[index](value); flushSync(); },
  };
}

// `s[0]` is the visibility flag, `s[1]` the list, in every fixture below.
const KEYED_LIST_AND_TAIL =
  '<div>{() => s[0]() && <>{() => s[1]().map(i => <li key={i}>{i}</li>)}<p>z</p></>}</div>';

describe('a conditional region holding a list, torn down after the list grew', () => {
  it('removes rows appended after mount', async () => {
    const { html, write } = await build(KEYED_LIST_AND_TAIL, [true, ['a', 'b']]);
    assert.equal(html(), '<li>a</li><li>b</li><p>z</p>');

    write(1, ['a', 'b', 'c']);
    assert.equal(html(), '<li>a</li><li>b</li><li>c</li><p>z</p>');

    write(0, false);
    assert.equal(html(), '', 'the region was switched off, so nothing of it may remain');
  });

  it('renders exactly one list when switched back on', async () => {
    const { html, write } = await build(KEYED_LIST_AND_TAIL, [true, ['a', 'b']]);
    write(1, ['a', 'b', 'c']);
    write(0, false);
    write(0, true);
    assert.equal(html(), '<li>a</li><li>b</li><li>c</li><p>z</p>');
  });

  it('stays clean across repeated hide/show cycles', async () => {
    const { html, write } = await build(KEYED_LIST_AND_TAIL, [true, ['a', 'b']]);
    for (let cycle = 0; cycle < 3; cycle++) {
      write(1, ['a', 'b', 'c']);
      write(0, false);
      assert.equal(html(), '', `cycle ${cycle}: hidden`);
      write(0, true);
      assert.equal(html(), '<li>a</li><li>b</li><li>c</li><p>z</p>', `cycle ${cycle}: shown`);
      write(1, ['a', 'b']);
    }
  });

  it('removes rows appended after mount through a nested fragment', async () => {
    const { html, write } = await build(
      '<div>{() => s[0]() && <><>{() => s[1]().map(i => <li key={i}>{i}</li>)}</><p>z</p></>}</div>',
      [true, ['a', 'b']],
    );
    write(1, ['a', 'b', 'c']);
    write(0, false);
    assert.equal(html(), '');
  });

  // An unkeyed list replaces its rows rather than appending to them, so the
  // snapshot went stale for every row at once and the whole list was orphaned.
  it('removes an unkeyed list whose rows were replaced after mount', async () => {
    const { html, write } = await build(
      '<div>{() => s[0]() && <>{() => s[1]().map(i => <li>{i}</li>)}<p>z</p></>}</div>',
      [true, ['a', 'b']],
    );
    write(1, ['a', 'b', 'c']);
    write(0, false);
    assert.equal(html(), '');
  });

  // No fragment anywhere: the region's value IS the list. Same snapshot, same
  // leak, which is what places the defect in the runtime and not in fragment
  // lowering.
  it('removes rows appended after mount with no fragment in the shape', async () => {
    const { html, write } = await build(
      '<div>{() => s[0]() && s[1]().map(i => <li key={i}>{i}</li>)}</div>',
      [true, ['a', 'b']],
    );
    assert.equal(html(), '<li>a</li><li>b</li>');
    write(1, ['a', 'b', 'c']);
    write(0, false);
    assert.equal(html(), '');
  });

  // Switching to another value rather than to nothing takes a different road
  // through the reconciler: the arm that diffs an old node set against a new one,
  // rather than the arm that clears the region outright. Both consult the same
  // record, so both were leaking, and only one of them is reached by a `&&`.
  it('removes rows appended after mount when the region swaps to another arm', async () => {
    const { html, write } = await build(
      '<div>{() => s[0]() ? <>{() => s[1]().map(i => <li key={i}>{i}</li>)}<p>z</p></> : <b>empty</b>}</div>',
      [true, ['a', 'b']],
    );
    assert.equal(html(), '<li>a</li><li>b</li><p>z</p>');

    write(1, ['a', 'b', 'c']);
    assert.equal(html(), '<li>a</li><li>b</li><li>c</li><p>z</p>');

    write(0, false);
    assert.equal(html(), '<b>empty</b>', 'the other arm is all that may be left');

    write(0, true);
    assert.equal(html(), '<li>a</li><li>b</li><li>c</li><p>z</p>');
  });

  // The list's own effect and its per-item scopes are released by disposeTree
  // when the region removes the list's end marker. A row that survived the
  // removal is still attached to a live list, so a write that reaches it proves
  // the teardown was partial even when the markup happens to look right.
  it('leaves no live list behind that a later write can move', async () => {
    const { html, write } = await build(KEYED_LIST_AND_TAIL, [true, ['a', 'b']]);
    write(1, ['a', 'b', 'c']);
    write(0, false);
    write(1, ['c', 'b', 'a']);
    assert.equal(html(), '');
  });
});
