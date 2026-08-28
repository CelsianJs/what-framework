// Component and island spread ordering.
//
// `<Box a="1" {...s} b="2" />` is one spelling of `{ a: "1", ...s, b: "2" }`.
// Every other JSX toolchain lowers it that way, the h()/jsx-runtime path in
// this repo lowers it that way, and #65 already made the ELEMENT path lower it
// that way. The component path did not: it kept a single `spreadExpr` (so the
// second of two spreads silently replaced the first, taking every key the
// second one did not carry with it) and always applied explicit attributes
// AFTER the spread regardless of where they were written.
//
// Both halves are observable to a user, so the assertions here are on the props
// the component actually RECEIVES, not on the emitted string. A couple of
// emitted-output checks follow the convention in babel-plugin.test.js, but they
// exist to pin the shape, not to define the contract.
//
// The reactivity half matters more than the ordering half. A prop whose VALUE
// is an accessor is how this framework spells "reactive prop", and a merge that
// invoked accessors instead of copying them would trade an ordering bug for a
// silent loss of reactivity. The last two tests in the ordering section guard
// exactly that.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import babelPlugin from '../src/babel-plugin.js';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_INDEX = path.resolve(__dirname, '../../core/src/index.js');
const CORE_RENDER = path.resolve(__dirname, '../../core/src/render.js');

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-spread-order-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* the temp dir is already gone */ } });

let moduleId = 0;

function compileJSX(source) {
  return transformSync(source, {
    filename: 'fixture.jsx',
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
    compact: false,
  }).code;
}

async function compileAndLoad(source) {
  const out = compileJSX(source)
    .replaceAll('"what-framework/render"', JSON.stringify(CORE_RENDER))
    .replaceAll("'what-framework/render'", JSON.stringify(CORE_RENDER))
    .replaceAll('"what-framework"', JSON.stringify(CORE_INDEX))
    .replaceAll("'what-framework'", JSON.stringify(CORE_INDEX));

  const file = path.join(tmpDir, `mod-${moduleId++}.mjs`);
  writeFileSync(file, out);
  return import(pathToFileURL(file).href);
}

const { flushSync } = await import(pathToFileURL(CORE_INDEX).href);

// Mount a compiled `App` and hand back the props its inner `Box` was called
// with. `Box` is a plain function component, so what it sees is the reactive
// props proxy — reads go through it exactly as they would in real code.
async function propsSeenBy(jsx) {
  const mod = await compileAndLoad(`
    export const seen = [];
    function Box(props) { seen.push(props); return <i />; }
    export function App() { return ${jsx}; }
  `);
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    host.appendChild(mod.App());
    flushSync();
    assert.equal(mod.seen.length, 1, 'Box must have run exactly once');
    return mod.seen[0];
  } finally {
    host.remove();
  }
}

describe('component spread ordering', () => {
  it('a spread written after an explicit attribute overrides it', async () => {
    const props = await propsSeenBy(`<Box label="static-first" {...{ label: 'from-spread' }} />`);
    assert.equal(props.label, 'from-spread');
  });

  it('an explicit attribute written after a spread still overrides it', async () => {
    // The over-correction guard for the test above: source order cuts both ways.
    const props = await propsSeenBy(`<Box {...{ label: 'from-spread' }} label="static-last" />`);
    assert.equal(props.label, 'static-last');
  });

  it('every spread contributes its keys, not just the last one', async () => {
    // The worst row of the three: `extra` lives only in the first spread, and
    // the first spread used to be dropped on the floor, so `extra` vanished.
    const props = await propsSeenBy(
      `<Box {...{ label: 'one', extra: 'x' }} {...{ label: 'two' }} />`
    );
    assert.equal(props.label, 'two', 'the later spread wins on a shared key');
    assert.equal(props.extra, 'x', 'a key only the earlier spread carries must survive');
    assert.ok('extra' in props, 'the key must be present, not merely undefined');
  });

  it('interleaved explicit attributes and spreads resolve position by position', async () => {
    const props = await propsSeenBy(
      `<Box extra="left" {...{ extra: 'from-spread' }} label="right" />`
    );
    assert.equal(props.extra, 'from-spread', 'the spread comes after `extra` and wins');
    assert.equal(props.label, 'right');
  });

  it('three spreads around two attributes all land in source order', async () => {
    const props = await propsSeenBy(
      `<Box {...{ a: 1, keep: 'a' }} b={2} {...{ a: 3, keep2: 'b' }} c="3" {...{ b: 9 }} />`
    );
    assert.equal(props.a, 3, 'later spread beats earlier spread');
    assert.equal(props.b, 9, 'a spread after an attribute beats the attribute');
    assert.equal(props.c, '3', 'an attribute after the last spread that touches it survives');
    assert.equal(props.keep, 'a');
    assert.equal(props.keep2, 'b');
  });

  it('a single spread with no explicit attributes still delivers every key', async () => {
    const props = await propsSeenBy(`<Box {...{ a: 1, b: 2 }} />`);
    assert.equal(props.a, 1);
    assert.equal(props.b, 2);
  });

  // --- reactivity -----------------------------------------------------------

  it('an accessor carried by a spread stays reactive through the merge', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const s = signal('before');
      function Box(props) { return <b>{() => props.label()}</b>; }
      export function App() {
        return <Box tag="x" {...{ label: () => s() }} />;
      }
    `);
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      host.appendChild(mod.App());
      flushSync();
      assert.equal(host.textContent, 'before');
      mod.s('after');
      flushSync();
      assert.equal(host.textContent, 'after', 'the merge must copy the accessor, not call it');
    } finally {
      host.remove();
    }
  });

  it('an accessor from an earlier spread survives a later spread', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const s = signal('before');
      function Box(props) { return <b>{() => props.label()}</b>; }
      export function App() {
        return <Box {...{ label: () => s() }} {...{ other: 1 }} />;
      }
    `);
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      host.appendChild(mod.App());
      flushSync();
      assert.equal(host.textContent, 'before');
      mod.s('after');
      flushSync();
      assert.equal(host.textContent, 'after');
    } finally {
      host.remove();
    }
  });

  it('a getter-bearing spread object reads once, on the merge path and without it', async () => {
    // What a spread object's OWN reactivity is worth, stated honestly rather
    // than assumed. createComponent (dom.js) copies props with Object.assign
    // before the component ever sees them, so a getter is invoked exactly once
    // at construction whatever the compiler emits — the reactive spelling is an
    // accessor VALUE (the two tests above), not a getter on the spread source.
    // The point of the assertion is PARITY: the merge path and the single-spread
    // path must agree, so neither can drift into double-reading or into lazily
    // holding the caller's object.
    const mod = await compileAndLoad(`
      export const reads = [];
      function Box(props) { return <i>{String(props.label)}</i>; }
      export function App({ src }) { return <Box {...src} />; }
      export function AppMerged({ src }) { return <Box {...src} other="1" />; }
    `);

    for (const [name, build] of [['single spread', mod.App], ['merged', mod.AppMerged]]) {
      let reads = 0;
      const src = { get label() { reads += 1; return 'v'; } };
      const host = document.createElement('div');
      document.body.appendChild(host);
      try {
        host.appendChild(build({ src }));
        flushSync();
        assert.equal(host.textContent, 'v', `${name}: the getter's value must arrive`);
        assert.equal(reads, 1, `${name}: the getter must be read exactly once`);
      } finally {
        host.remove();
      }
    }
  });
});

describe('island spread ordering', () => {
  // `client:*` lowers to _$createComponent(Island, ...), a second props-merge
  // site with the same bug and its own extra rule: `component` and `mode` are
  // the directive's own machinery and must never be reachable from user data.
  async function islandPropsSeenBy(jsx) {
    const mod = await compileAndLoad(`
      export const seen = [];
      function Chart(props) { seen.push(props); return <canvas />; }
      export function App() { return ${jsx}; }
    `);
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      host.appendChild(mod.App());
      flushSync();
      // client:load hydrates on a microtask.
      await Promise.resolve();
      await Promise.resolve();
      flushSync();
      assert.equal(mod.seen.length, 1, 'the island component must have run exactly once');
      return { props: mod.seen[0], host };
    } finally {
      host.remove();
    }
  }

  it('every island spread contributes its keys, in source order', async () => {
    const { props } = await islandPropsSeenBy(
      `<Chart client:load {...{ label: 'one', extra: 'x' }} {...{ label: 'two' }} />`
    );
    assert.equal(props.label, 'two');
    assert.equal(props.extra, 'x');
  });

  it('an island spread written after an explicit attribute overrides it', async () => {
    const { props } = await islandPropsSeenBy(
      `<Chart client:load label="static-first" {...{ label: 'from-spread' }} />`
    );
    assert.equal(props.label, 'from-spread');
  });

  it('an island spread can never reach the directive machinery', async () => {
    const code = compileJSX(`
      function Chart() { return <canvas />; }
      function App({ cfg }) {
        return <div><Chart client:load {...cfg} {...{ mode: 'static' }} /></div>;
      }
    `);
    const merged = code.slice(code.indexOf('Object.assign'));
    assert.ok(
      merged.indexOf('mode: "load"') > merged.lastIndexOf('cfg'),
      'the hydration mode comes from the directive, applied after all user data'
    );
    assert.ok(
      merged.indexOf('component: Chart') > merged.lastIndexOf('cfg'),
      'the component reference comes from the tag, applied after all user data'
    );
  });
});

describe('component spread lowering shape', () => {
  it('emits both spreads, in source order, with the attribute between them', () => {
    const code = compileJSX(`
      function App({ a, b }) { return <Box {...a} mid="m" {...b} />; }
    `);
    const merged = code.slice(code.indexOf('Object.assign'));
    const iA = merged.indexOf(' a,');
    const iMid = merged.indexOf('mid: "m"');
    const iB = merged.indexOf(' b)');
    assert.ok(iA >= 0, `the first spread must survive, got:\n${code}`);
    assert.ok(iB >= 0, `the second spread must survive, got:\n${code}`);
    assert.ok(iA < iMid && iMid < iB, `arguments must follow source order, got:\n${code}`);
  });
});
