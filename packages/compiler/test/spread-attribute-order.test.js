// Static attributes were baked into the template string and spreads became
// runtime `_$spread` calls, so a spread always ran last no matter where it was
// written. `<div {...{id:'a'}} id="b"/>` rendered id="a"; the h() spelling of
// the same tree renders id="b", and so does React and so does an uncompiled
// SSR render of the same source.
//
// "Spread then pin one attribute" is an ordinary idiom, which is why this is
// worth a file of its own. Found by the lowering-parity fuzzer: 42 of its first
// 400 random trees diverged here.
//
// Every assertion below compares the compiled tree against the h() tree it
// lowers to, rather than against a hand-written expectation, because the h()
// path is the definition of what the JSX means.

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
const { mount } = await import('../../core/src/dom.js');

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-spread-order-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

const q = s => JSON.stringify(s);
let moduleId = 0;

function localize(code) {
  return code.replaceAll('"what-framework/render"', q(CORE_RENDER)).replaceAll('"what-framework"', q(CORE_INDEX));
}

async function load(code) {
  const file = path.join(tmpDir, `mod-${moduleId++}.mjs`);
  writeFileSync(file, localize(code));
  return import(pathToFileURL(file).href);
}

// Attributes only, sorted, so the assertion is about which values survived and
// not about the order the DOM happens to list them in.
function attrsOf(el) {
  return [...el.attributes].map(a => `${a.name}=${a.value}`).sort().join(' ');
}

// The compiled path returns a live element; h() returns a VNode that only
// becomes one when mounted. Both end up in a host so the same element is read.
async function render(build) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    const built = build();
    if (built && typeof built.nodeType === 'number') host.appendChild(built);
    else mount(built, host);
    flushSync();
    return attrsOf(host.firstElementChild);
  } finally {
    host.remove();
  }
}

async function compiled(jsx) {
  const code = transformSync(`export function build() { return ${jsx}; }`, {
    filename: 'fixture.jsx',
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
  }).code;
  return render((await load(code)).build);
}

async function viaH(hSource) {
  const mod = await load(`import { h } from ${q(CORE_INDEX)};\nexport function build() { return ${hSource}; }`);
  return render(mod.build);
}

async function assertParity(jsx, hSource) {
  const [a, b] = [await compiled(jsx), await viaH(hSource)];
  assert.equal(a, b, `compiled JSX and the h() tree must agree\n  jsx: ${jsx}\n  h(): ${hSource}`);
  return a;
}

describe('a spread and a static attribute on the same element', () => {
  it('lets a static attribute written after the spread win', async () => {
    const attrs = await assertParity(
      '<div {...{ id: "from-spread" }} id="static-wins" title="t" />',
      'h("div", { ...{ id: "from-spread" }, id: "static-wins", title: "t" })',
    );
    assert.equal(attrs, 'id=static-wins title=t');
  });

  it('lets the spread win over a static attribute written before it', async () => {
    const attrs = await assertParity(
      '<div id="static-first" {...{ id: "from-spread" }} title="t" />',
      'h("div", { id: "static-first", ...{ id: "from-spread" }, title: "t" })',
    );
    assert.equal(attrs, 'id=from-spread title=t');
  });

  it('resolves a key written on both sides of the spread to the last one', async () => {
    const attrs = await assertParity(
      '<div class="a" {...{ class: "b" }} class="c" />',
      'h("div", { class: "a", ...{ class: "b" }, class: "c" })',
    );
    assert.equal(attrs, 'class=c');
  });

  it('applies two spreads and the attributes between them in written order', async () => {
    const attrs = await assertParity(
      '<div {...{ id: "one" }} id="middle" {...{ title: "two" }} lang="en" />',
      'h("div", { ...{ id: "one" }, id: "middle", ...{ title: "two" }, lang: "en" })',
    );
    assert.equal(attrs, 'id=middle lang=en title=two');
  });

  it('keeps className and htmlFor mapped to their DOM names after a spread', async () => {
    await assertParity(
      '<label {...{ class: "from-spread" }} className="static-wins" htmlFor="field" />',
      'h("label", { ...{ class: "from-spread" }, className: "static-wins", htmlFor: "field" })',
    );
  });

  it('still bakes static attributes into the template when there is no spread', async () => {
    const code = transformSync('export const x = <div id="a" title="t" />;', {
      filename: 'fixture.jsx',
      plugins: [[babelPlugin, { production: false }]],
      parserOpts: { plugins: ['jsx'] },
      configFile: false,
      babelrc: false,
    }).code;
    assert.match(code, /_\$template\("<div id=\\"a\\" title=\\"t\\"><\/div>"\)/);
    assert.doesNotMatch(code, /_\$setProp/, 'no spread means nothing has to be re-applied at runtime');
  });
});
