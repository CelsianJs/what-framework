// An island attribute whose name is not a JavaScript identifier.
//
// `<Chart client:load data-x="1" />` compiled to `{data-x: "1"}`. That is not
// valid JavaScript, so the build produced a file no parser would accept, and
// the error pointed at generated output rather than at the line someone wrote.
//
// The mistake is invisible while writing it: babel's builders do NOT validate,
// so `t.identifier('data-x')` constructs happily and only the printed text is
// wrong. The compiler exited 0. Nothing in the compiler's own tests noticed
// because every island fixture in them used identifier-shaped names.
//
// `data-*` and `aria-*` on an island are ordinary — a chart that needs a label
// for screen readers is the motivating case — and the regular component branch
// had always quoted them. This is the branch that did not, found by the
// lowering-parity fuzzer: 67 of its first 150 island trees produced a module
// that would not import.

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

const { flushSync } = await import('../../core/src/reactive.js');

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-island-attr-names-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* already gone */ } });

const q = s => JSON.stringify(s);
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

// Re-parse the compiler's own output as plain JavaScript. This is the assertion
// that actually pins the bug: the old output failed HERE, before any of it ran.
function assertParses(code, what) {
  assert.doesNotThrow(
    () => transformSync(code, { configFile: false, babelrc: false, code: false }),
    `${what} did not produce valid JavaScript:\n${code}`,
  );
}

function localize(code) {
  return code
    .replaceAll('"what-framework/render"', q(CORE_RENDER))
    .replaceAll("'what-framework/render'", q(CORE_RENDER))
    .replaceAll('"what-framework"', q(CORE_INDEX))
    .replaceAll("'what-framework'", q(CORE_INDEX));
}

// Mount an island and hand back the props its component was actually called
// with. `client:load` hydrates on a microtask.
async function islandPropsFor(jsx) {
  const source = `
    export const seen = [];
    function Chart(props) { seen.push(props); return <canvas />; }
    export function App() { return ${jsx}; }
  `;
  const compiled = compile(source);
  assertParses(compiled, jsx);

  const file = path.join(tmpDir, `mod-${moduleId++}.mjs`);
  writeFileSync(file, localize(compiled));
  const mod = await import(pathToFileURL(file).href);

  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    host.appendChild(mod.App());
    flushSync();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    assert.equal(mod.seen.length, 1, 'the island component must have run exactly once');
    return mod.seen[0];
  } finally {
    host.remove();
  }
}

describe('island attribute names that are not identifiers', () => {
  it('a hyphenated island attribute compiles to parseable JavaScript', async () => {
    const props = await islandPropsFor(`<Chart client:load data-x="1" />`);
    assert.equal(props['data-x'], '1');
  });

  it('aria-* survives too, which is the case that made this reachable', async () => {
    // A chart island with a screen-reader label is not an exotic shape, and it
    // took the whole build down.
    const props = await islandPropsFor(`<Chart client:load aria-label="revenue" />`);
    assert.equal(props['aria-label'], 'revenue');
  });

  it('hyphenated names survive the spread-merge path as well', async () => {
    // Two different emit sites: no spread writes one object literal, a spread
    // writes an Object.assign argument list. Both build the same properties, so
    // both could carry the bug and only one of them is covered by the tests
    // above.
    const props = await islandPropsFor(
      `<Chart client:load {...{ 'data-x': 'from-spread' }} aria-label="explicit" data-y="last" />`
    );
    assert.equal(props['data-x'], 'from-spread');
    assert.equal(props['aria-label'], 'explicit');
    assert.equal(props['data-y'], 'last');
  });

  it('an identifier-shaped name is still emitted unquoted', async () => {
    // The over-correction guard: quoting every key would work but would change
    // the output of every island in the repo. Only the names that need it are
    // quoted, so this pins the emitted shape rather than the behaviour.
    const code = compile(`export const A = () => <Chart client:load label="x" data-x="1" />;`);
    assertParses(code, 'mixed identifier and hyphenated names');
    assert.match(code, /\blabel: "x"/, 'an identifier key stays bare');
    assert.match(code, /"data-x": "1"/, 'a hyphenated key is quoted');
  });
});
