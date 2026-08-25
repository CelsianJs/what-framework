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
  return { el, signals, html: () => el.innerHTML.replaceAll('<!--$-->', '') };
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
