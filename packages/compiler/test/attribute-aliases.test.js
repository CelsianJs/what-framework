// React-style prop names whose HTML attribute has a different name.
//
// A static attribute is baked into the element's template string, and the
// template is PARSED as HTML. The parser only lowercases names, so
// `<meta httpEquiv="refresh">` in a template becomes an `httpequiv` attribute
// that means nothing. The h() path gets it right through the element's
// reflected DOM property, and so does a dynamic compiled attribute, which goes
// through setProp. So the same JSX worked or silently did nothing depending on
// whether its value happened to be a literal.
//
// The oracle is the h() tree: every alias, static and dynamic, must leave the
// element with the attributes a mount() of the equivalent h() call leaves.

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
const { h, mount } = await import(CORE_INDEX);

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-attr-aliases-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* already removed */ } });

const q = s => JSON.stringify(s);
let moduleId = 0;

async function load(source) {
  const code = transformSync(source, {
    filename: 'fixture.jsx',
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
  }).code
    .replaceAll('"what-framework/render"', q(CORE_RENDER))
    .replaceAll("'what-framework'", q(CORE_INDEX))
    .replaceAll('"what-framework"', q(CORE_INDEX));
  const file = path.join(tmpDir, `mod-${moduleId++}.mjs`);
  writeFileSync(file, code);
  return import(pathToFileURL(file).href);
}

const attrsOf = el => Object.fromEntries([...el.attributes].map(a => [a.name, a.value]));

function hRoot(vnode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mount(vnode, host);
  flushSync();
  return host.firstElementChild;
}

const CASES = [
  ['label', 'htmlFor', 'email', { for: 'email' }],
  ['meta', 'httpEquiv', 'refresh', { 'http-equiv': 'refresh' }],
  ['form', 'acceptCharset', 'utf-8', { 'accept-charset': 'utf-8' }],
  ['span', 'className', 'x', { class: 'x' }],
];

describe('compiled prop aliases match the h() tree', () => {
  for (const [tag, prop, value, expected] of CASES) {
    it(`<${tag} ${prop}> static and dynamic`, async () => {
      const oracle = attrsOf(hRoot(h(tag, { [prop]: value })));
      assert.deepEqual(oracle, expected, 'the h() oracle itself');

      const mod = await load(`
        export const value = ${q(value)};
        export const staticBuild = () => <${tag} ${prop}=${q(value)} />;
        export const dynamicBuild = (v) => <${tag} ${prop}={v} />;
      `);
      assert.deepEqual(attrsOf(mod.staticBuild()), oracle, 'static attribute');
      const dynamic = mod.dynamicBuild(value);
      flushSync();
      assert.deepEqual(attrsOf(dynamic), oracle, 'dynamic attribute');
    });
  }
});
