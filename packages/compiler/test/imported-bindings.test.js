// An imported binding the compiler cannot see into.
//
// The compiler compiles one file at a time. `import { X } from './links'` could
// be a string, an object, a plain function, or a signal, and nothing in this
// file says which. Imports from a relative path or from What itself are
// tracked as "possibly reactive" so that an imported signal keeps updating the
// DOM. Tracking is right. CALLING the binding is not: a bare `X` used as a value
// was emitted as `X()`, and every non-function import threw
// "X is not a function" at runtime, with no build error and no SSR error.
//
// The h() spelling is the oracle. `h('a', { href: X })` resolves X at runtime:
// a function is a reactive accessor, anything else is the value. Compiled JSX
// has to mean the same thing for every shape of import, and for every JSX
// position a bare identifier can sit in.

import { describe, it, before } from 'node:test';
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

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-imported-bindings-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* already removed */ } });

const q = s => JSON.stringify(s);
let moduleId = 0;

// The module every fixture imports from, by a RELATIVE specifier, which is what
// makes the compiler treat its bindings as possibly reactive. It is plain
// JavaScript, not compiled, so the only lowering under test is the importer's.
const LINKS = `
import { signal, computed } from ${q(CORE_INDEX)};
export const DOCS_URL = '/docs';
export const COUNT = 3;
export const CLS = 'btn primary';
export const STYLE = { color: 'red' };
export const NOTHING = null;
export const FLAG = true;
export const OFF = false;
export const url = signal('/a');
export const label = computed(() => 'to ' + url());
export function describeUrl() { return 'fn:' + url(); }
export const clicks = [];
export function onPress(e) { clicks.push(e.type); }
export const refs = [];
export function captureRef(el) { refs.push(el.tagName); }
export const refObj = { current: null };
export default '/default';
`;
writeFileSync(path.join(tmpDir, 'links.js'), LINKS);

function compile(source) {
  return transformSync(source, {
    filename: path.join(tmpDir, 'fixture.jsx'),
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
  }).code
    .replaceAll('"what-framework/render"', q(CORE_RENDER))
    .replaceAll("'what-framework'", q(CORE_INDEX))
    .replaceAll('"what-framework"', q(CORE_INDEX));
}

async function load(source) {
  const file = path.join(tmpDir, `mod-${moduleId++}.mjs`);
  writeFileSync(file, compile(source));
  return import(pathToFileURL(file).href);
}

// Comments are compiler and runtime bookkeeping, not markup.
const clean = html => html.replace(/<!--.*?-->/g, '');

async function mountSource(source) {
  const mod = await load(source);
  const host = document.createElement('div');
  document.body.appendChild(host);
  host.appendChild(mod.build());
  flushSync();
  return { mod, host, html: () => clean(host.innerHTML) };
}

let links;
before(async () => {
  links = await import(pathToFileURL(path.join(tmpDir, 'links.js')).href);
});

describe('an imported constant used as an attribute value', () => {
  it('renders <a href={DOCS_URL}> instead of throwing "DOCS_URL is not a function"', async () => {
    const { html } = await mountSource(`
      import { DOCS_URL } from './links.js';
      export const build = () => <a href={DOCS_URL}>Docs</a>;
    `);
    assert.equal(html(), '<a href="/docs">Docs</a>');
  });

  it('works through every specialised setter and for default and namespace imports', async () => {
    const { html } = await mountSource(`
      import { DOCS_URL, COUNT, CLS, STYLE, NOTHING, FLAG } from './links.js';
      import DEFAULT_URL from './links.js';
      import * as L from './links.js';
      export const build = () => (
        <form>
          <a href={DOCS_URL} class={CLS} style={STYLE} data-count={COUNT} aria-label={DOCS_URL} title={NOTHING}>a</a>
          <a id="d" href={DEFAULT_URL}>b</a>
          <a id="n" href={L.DOCS_URL} title={L.CLS}>c</a>
          <input value={COUNT} checked={FLAG} type="checkbox" />
        </form>
      );
    `);
    const out = html();
    assert.match(out, /<a href="\/docs" class="btn primary" style="color: red;" data-count="3" aria-label="\/docs">a<\/a>/);
    assert.match(out, /<a id="d" href="\/default">b<\/a>/);
    assert.match(out, /<a id="n" href="\/docs" title="btn primary">c<\/a>/);
    const input = document.body.querySelector('form input');
    assert.equal(input.value, '3');
    assert.equal(input.checked, true);
  });

  it('keeps an imported signal, computed and accessor function reactive', async () => {
    links.url('/a');
    flushSync();
    const { host } = await mountSource(`
      import { url, label, describeUrl } from './links.js';
      export const build = () => <a href={url} title={label} data-fn={describeUrl} class={url}>x</a>;
    `);
    const a = host.querySelector('a');
    assert.equal(a.getAttribute('href'), '/a');
    assert.equal(a.getAttribute('title'), 'to /a');
    assert.equal(a.getAttribute('data-fn'), 'fn:/a');
    assert.equal(a.className, '/a');

    links.url('/b');
    flushSync();
    assert.equal(a.getAttribute('href'), '/b');
    assert.equal(a.getAttribute('title'), 'to /b');
    assert.equal(a.getAttribute('data-fn'), 'fn:/b');
    assert.equal(a.className, '/b');
  });

  it('matches the h() tree for the same imports, before and after a write', async () => {
    links.url('/a');
    flushSync();
    const source = `
      import { DOCS_URL, COUNT, NOTHING, url, describeUrl } from './links.js';
      import DEFAULT_URL from './links.js';
      export const build = () => (
        <div id={DEFAULT_URL} title={DOCS_URL} data-n={COUNT} data-z={NOTHING} class={url} aria-label={describeUrl}>
          {DOCS_URL}{COUNT}{url}
        </div>
      );
    `;
    const { host: jsxHost } = await mountSource(source);
    const { h, mount } = await import(CORE_INDEX);
    const hHost = document.createElement('div');
    document.body.appendChild(hHost);
    mount(h('div', {
      id: links.default, title: links.DOCS_URL, 'data-n': links.COUNT, 'data-z': links.NOTHING,
      class: links.url, 'aria-label': links.describeUrl,
    }, links.DOCS_URL, links.COUNT, links.url), hHost);
    flushSync();
    assert.equal(clean(jsxHost.innerHTML), clean(hHost.innerHTML));

    links.url('/c');
    flushSync();
    assert.equal(clean(jsxHost.innerHTML), clean(hHost.innerHTML));
    assert.match(clean(jsxHost.innerHTML), /\/docs3\/c/);
  });
});

describe('an imported function in a position where a function IS the value', () => {
  it('is attached as an event handler and a ref, not called while building', async () => {
    links.clicks.length = 0;
    links.refs.length = 0;
    links.refObj.current = null;
    const { host } = await mountSource(`
      import { onPress, captureRef, refObj } from './links.js';
      export const build = () => (
        <div>
          <button onClick={onPress} ref={captureRef}>go</button>
          <span onMouseEnter={onPress} ref={refObj}>s</span>
        </div>
      );
    `);
    assert.deepEqual(links.clicks, [], 'no handler ran while building');
    assert.deepEqual(links.refs, ['BUTTON']);
    assert.equal(links.refObj.current?.tagName, 'SPAN');
    host.querySelector('button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    host.querySelector('span').dispatchEvent(new window.MouseEvent('mouseenter'));
    assert.deepEqual(links.clicks, ['click', 'mouseenter']);
  });

  it('reaches a component prop as the same function', async () => {
    const { mod, html } = await mountSource(`
      import { onPress, DOCS_URL } from './links.js';
      export let seen;
      function Probe(props) {
        seen = { cb: props.cb, href: props.href };
        return <i>{typeof props.cb}</i>;
      }
      export const build = () => <div><Probe cb={onPress} href={DOCS_URL} /></div>;
    `);
    assert.equal(mod.seen.cb, links.onPress);
    assert.equal(mod.seen.href, '/docs');
    assert.equal(html(), '<div><i>function</i></div>');
  });
});

describe('an imported binding as a child', () => {
  it('renders a constant and keeps a signal live', async () => {
    links.url('/a');
    flushSync();
    const { html } = await mountSource(`
      import { DOCS_URL, url } from './links.js';
      import * as L from './links.js';
      export const build = () => <p>{DOCS_URL}|{L.COUNT}|{url}</p>;
    `);
    assert.equal(html(), '<p>/docs|3|/a</p>');
    links.url('/z');
    flushSync();
    assert.equal(html(), '<p>/docs|3|/z</p>');
  });
});

describe('a `when` condition the compiler cannot prove is a signal', () => {
  it('accepts an imported boolean constant in <Show> and <Match>', async () => {
    const { html } = await mountSource(`
      import { Show, Switch, Match } from 'what-framework';
      import { FLAG, OFF } from './links.js';
      export const build = () => (
        <div>
          <Show when={FLAG}><b>on</b></Show>
          <Show when={OFF} fallback={<i>off</i>}><b>never</b></Show>
          <Switch fallback={<s>none</s>}>
            <Match when={OFF}><u>no</u></Match>
            <Match when={FLAG}><em>yes</em></Match>
          </Switch>
        </div>
      );
    `);
    assert.equal(html(), '<div><b>on</b><i>off</i><em>yes</em></div>');
  });

  it('keeps an imported signal in `when` reactive, named or through a namespace', async () => {
    links.url('/a');
    flushSync();
    const { html } = await mountSource(`
      import { Show } from 'what-framework';
      import { url } from './links.js';
      import * as L from './links.js';
      export const build = () => (
        <div>
          <Show when={url}><b>set</b></Show>
          <Show when={L.url}><i>ns</i></Show>
          <Show when={L.FLAG}><u>flag</u></Show>
        </div>
      );
    `);
    assert.equal(html(), '<div><b>set</b><i>ns</i><u>flag</u></div>');
    links.url('');
    flushSync();
    assert.equal(html(), '<div><u>flag</u></div>');
    links.url('/back');
    flushSync();
    assert.equal(html(), '<div><b>set</b><i>ns</i><u>flag</u></div>');
  });

  it('accepts a destructured prop holding a plain boolean, and an accessor prop', async () => {
    const { mod, html } = await mountSource(`
      import { Show, signal } from 'what-framework';
      export const open = signal(false);
      function Panel({ when }) {
        return <section><Show when={when}><b>open</b></Show></section>;
      }
      export const build = () => <div><Panel when={true} /><Panel when={open} /></div>;
    `);
    assert.equal(html(), '<div><section><b>open</b></section><section></section></div>');
    mod.open(true);
    flushSync();
    assert.equal(html(), '<div><section><b>open</b></section><section><b>open</b></section></div>');
  });
});
