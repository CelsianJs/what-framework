// The compiler auto-wraps a signal read written directly in JSX, which is what
// docs/GOTCHAS.md section 2 promises and what the eslint plugin's
// signal-call-in-jsx rule tells people to rely on. It only ever did that for
// names it had watched being created: a local `signal()`/`computed()`, a
// destructured prop, an imported binding.
//
// Everything else read like an accessor and behaved like a constant:
//
//   function Row(props)  { return <span>{props.count()}</span>; }   frozen
//   function Row(count)  { return <span>{count()}</span>; }         frozen
//   const s = useThing();  <span>{s()}</span>                       frozen
//
// No error, no warning, no missing markup, just a number that never changes.
// The rule now runs the other way: a zero-argument call is assumed to be an
// accessor unless it is a built-in conversion, because wrapping a constant
// costs one effect that never re-runs while not wrapping an accessor silently
// freezes the DOM.

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

const { flushSync, batch } = await import('../../core/src/reactive.js');

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-auto-thunk-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

const q = s => JSON.stringify(s);
let moduleId = 0;

function compile(source) {
  return transformSync(source, {
    filename: 'fixture.jsx',
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

describe('an accessor the compiler cannot identify', () => {
  it('stays live when read through props', async () => {
    const { mod, html } = await mountSource(`
      import { signal } from 'what-framework';
      export const c = signal(0);
      function ViaProps(props) { return <span>{props.count()}</span>; }
      export function build() { return <div><ViaProps count={c} /></div>; }
    `);
    assert.equal(html(), '<div><span>0</span></div>');
    mod.c(5);
    flushSync();
    assert.equal(html(), '<div><span>5</span></div>');
  });

  it('stays live when it arrived as a plain parameter', async () => {
    const { mod, html } = await mountSource(`
      import { signal } from 'what-framework';
      export const c = signal(0);
      function ViaParam(count) { return <em>{count()}</em>; }
      export function build() { const row = ViaParam(c); const el = document.createElement('div'); el.appendChild(row); return el; }
    `);
    assert.equal(html(), '<div><em>0</em></div>');
    mod.c(5);
    flushSync();
    assert.equal(html(), '<div><em>5</em></div>');
  });

  it('stays live when it came back from an unknown call', async () => {
    const { mod, html } = await mountSource(`
      import { signal } from 'what-framework';
      export const c = signal(0);
      function useThing() { return c; }
      function ViaHook() { const s = useThing(); return <u>{s()}</u>; }
      export function build() { return <div><ViaHook /></div>; }
    `);
    assert.equal(html(), '<div><u>0</u></div>');
    mod.c(5);
    flushSync();
    assert.equal(html(), '<div><u>5</u></div>');
  });

  it('stays live in an attribute, not only in a child', async () => {
    const { mod, host } = await mountSource(`
      import { signal } from 'what-framework';
      export const c = signal('one');
      function Row(props) { return <span title={props.label()} class={props.label()} />; }
      export function build() { return <div><Row label={c} /></div>; }
    `);
    const span = () => host.querySelector('span');
    assert.equal(span().getAttribute('title'), 'one');
    assert.equal(span().className, 'one');
    mod.c('two');
    flushSync();
    assert.equal(span().getAttribute('title'), 'two');
    assert.equal(span().className, 'two');
  });

  // The lowering narrows what the list's source thunk tracks: the author wrote
  // one region reading both signals, and _$mapArray(() => items(), ...) tracks
  // only the first. Row bodies have to carry their own reads or a reused row
  // keeps a stale value while a newly created row next to it shows a fresh one.
  it('keeps reused rows of a lowered .map() up to date', async () => {
    const { mod, host } = await mountSource(`
      import { signal } from 'what-framework';
      export const items = signal(['apple', 'banana']);
      export const unit = signal('USD');
      function List(props) {
        return <ul>{() => props.items().map(item => <li key={item}>{item}={props.unit()}</li>)}</ul>;
      }
      export function build() { return <div><List items={items} unit={unit} /></div>; }
    `);
    assert.equal(host.textContent, 'apple=USDbanana=USD');
    batch(() => { mod.items(['pear', 'banana', 'apple']); mod.unit('EUR'); });
    flushSync();
    assert.equal(host.textContent, 'pear=EURbanana=EURapple=EUR');
  });
});

describe('what the compiler still leaves alone', () => {
  it('does not wrap a built-in conversion', async () => {
    const code = compile(`
      export function build() { return <div>{new Date(0).toLocaleDateString()}{"x".toUpperCase()}</div>; }
    `);
    assert.doesNotMatch(code, /_\$insert\([^,]+, \(\) =>/,
      'a conversion cannot be an accessor, so wrapping it would be pure cost');
  });

  it('still wraps a conversion whose receiver is itself a read', async () => {
    const code = compile(`
      export function build(user) { return <div>{user().name.toUpperCase()}</div>; }
    `);
    assert.match(code, /_\$insert\(_el\$\d+, \(\) => user\(\)\.name\.toUpperCase\(\)/,
      'the receiver is an accessor read even though the method is not');
  });

  it('does not wrap a call that takes arguments and reads nothing reactive', async () => {
    const code = compile(`
      export function build() { return <div>{format(1, 2)}</div>; }
    `);
    assert.doesNotMatch(code, /\(\) => format\(/);
  });
});
