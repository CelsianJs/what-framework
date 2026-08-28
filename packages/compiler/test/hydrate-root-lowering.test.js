// The JSX handed to hydrate() must reach it UNBUILT.
//
// `hydrate(<App />, container)` is the documented client entry, and it lowered to
// `hydrate(_$createComponent(App, ...), container)`. _$createComponent RUNS the
// component and builds its DOM, so hydrate() was handed a finished tree whose
// bindings were already wired to itself. There is nothing hydrateNode can do
// with that but insert it and let the trim delete the server's markup: every
// compiled app that hydrated discarded its whole server render and did a full
// client render instead. In a production build, where the dev warning is
// stripped, without a sound.
//
// The assertion that matters here is NODE IDENTITY, not markup. A client render
// of the same tree produces byte-identical HTML — that is precisely why this
// survived so long — so `container.firstChild === theNodeCapturedBeforehand` is
// the only check a re-render cannot pass. A warning firing is the same signal
// read the other way round: it means the fallback was taken.
//
// The server markup is produced by the real renderToString rather than written
// out by hand, so the test cannot pass by adopting a string that was authored to
// match the client.
//
// Scope, stated so it is not mistaken for something larger: this fixes the ROOT
// of the hydrate call. A component whose own body is compiled still returns a
// template CLONE, which is built DOM, and still cannot adopt anything — but such
// a component cannot be server-rendered either (renderToString has no DOM-node
// branch), so it has no server markup to adopt. The configuration this fixes is
// the one the framework actually ships: h()-authored components that SSR, and a
// JSX client entry. See hydrate-prebuilt-dom.test.js in core for the built-input
// fallback that remains.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import babelPlugin from '../src/babel-plugin.js';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM();
globalThis.__WHAT_DEV__ = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_INDEX = path.resolve(__dirname, '../../core/src/index.js');
const CORE_RENDER = path.resolve(__dirname, '../../core/src/render.js');

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-hydrate-root-'));
process.on('exit', () => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

let moduleId = 0;

function compile(source, filename = 'entry-client.jsx') {
  return transformSync(source, {
    filename,
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
    compact: false,
  }).code;
}

function localize(code) {
  return code
    .replaceAll('"what-framework/render"', JSON.stringify(CORE_RENDER))
    .replaceAll("'what-framework/render'", JSON.stringify(CORE_RENDER))
    .replaceAll('"what-framework"', JSON.stringify(CORE_INDEX))
    .replaceAll("'what-framework'", JSON.stringify(CORE_INDEX));
}

async function compileAndLoad(source) {
  const file = path.join(tmpDir, `mod-${moduleId++}.mjs`);
  writeFileSync(file, localize(compile(source)));
  return import(pathToFileURL(file).href);
}

const { h, flushSync } = await import(pathToFileURL(CORE_INDEX).href);
// The server's own output, not a hand-written approximation of it: adopting
// markup is only proved by adopting the markup the server actually emits.
const { renderToString } = await import('../../server/src/index.js');

// An h()-authored component, which is what an SSR-capable component in this
// framework looks like (see smoke/apps/* and the create-what fullstack
// template). The JSX in these fixtures is only ever at the hydrate call site,
// exactly as a real client entry has it.
const APP_SOURCE = `
  import { h, signal } from 'what-framework';
  export const count = signal(0);
  export function App(props) {
    return h('div', { class: 'app' },
      h('h1', null, props.title || 'Title'),
      h('button', { onClick: () => count(count() + 1) }, 'inc'),
      h('span', null, () => String(count())),
      props.children,
    );
  }
`;

let warnings;
let realWarn;

beforeEach(() => {
  warnings = [];
  realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
});

afterEach(() => {
  console.warn = realWarn;
});

// Put the server's render for `props` in the container and hand back the nodes
// captured BEFORE hydration, which are the only identities worth comparing.
async function serverRender(App, props = {}) {
  const html = renderToString(h(App, props));
  document.body.innerHTML = `<div id="app">${html}</div>`;
  const container = document.getElementById('app');
  return {
    container,
    root: container.firstChild,
    h1: container.querySelector('h1'),
    button: container.querySelector('button'),
  };
}

describe('compiled hydrate() root', () => {
  it('adopts the server DOM instead of re-rendering it', async () => {
    const mod = await compileAndLoad(`${APP_SOURCE}
      import { hydrate } from 'what-framework';
      export function boot(container) { hydrate(<App />, container); }
    `);

    const server = await serverRender(mod.App);
    mod.boot(server.container);
    flushSync();

    assert.equal(server.container.firstChild, server.root, 'the server root node must be REUSED');
    assert.equal(server.container.querySelector('h1'), server.h1, 'the server <h1> must be REUSED');
    assert.equal(server.container.querySelector('button'), server.button, 'the server <button> must be REUSED');
    assert.deepEqual(warnings, [], 'a warning means the client-render fallback was taken');

    // Adopted, not merely left alone: the bindings have to be live on the
    // server's own nodes.
    server.button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    flushSync();
    assert.equal(server.container.querySelector('span').textContent, '1');
    assert.equal(server.container.firstChild, server.root, 'still the server node after an update');
  });

  it('carries props and children through the unbuilt root', async () => {
    const mod = await compileAndLoad(`${APP_SOURCE}
      import { hydrate } from 'what-framework';
      export function boot(container) {
        hydrate(<App title="Hydrated"><p>child</p></App>, container);
      }
    `);

    const server = await serverRender(mod.App, { title: 'Hydrated', children: h('p', null, 'child') });
    mod.boot(server.container);
    flushSync();

    assert.equal(server.container.firstChild, server.root, 'the server root node must be REUSED');
    assert.equal(server.container.querySelector('h1').textContent, 'Hydrated');
    assert.equal(server.container.querySelectorAll('p').length, 1);
    assert.equal(server.container.querySelector('p').textContent, 'child');
  });

  it('leaves the app interactive when the container holds no server markup', async () => {
    // hydrate() into an empty root is a legitimate degenerate case (a bad cache,
    // a stripped response). The unbuilt tree has to build itself there.
    const mod = await compileAndLoad(`${APP_SOURCE}
      import { hydrate } from 'what-framework';
      export function boot(container) { hydrate(<App />, container); }
    `);

    document.body.innerHTML = '<div id="app"></div>';
    const container = document.getElementById('app');
    mod.boot(container);
    flushSync();

    assert.equal(container.querySelector('h1').textContent, 'Title');
    container.querySelector('button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    flushSync();
    assert.equal(container.querySelector('span').textContent, '1');
  });
});

describe('which hydrate() the compiler rewrites', () => {
  const CALL = 'hydrate(<App />, el)';

  function lower(source) {
    return compile(`function App() {}\n${source}`);
  }

  it('rewrites a plain named import', () => {
    const code = lower(`import { hydrate } from 'what-framework';\nexport const go = (el) => ${CALL};`);
    assert.match(code, /hydrate\(_\$componentVNode\(App, null, \[\]\), el\)/);
    assert.doesNotMatch(code, /_\$createComponent/);
  });

  it('rewrites an aliased import, because the binding remembers the imported name', () => {
    const code = lower(`import { hydrate as boot } from 'what-framework';\nexport const go = (el) => boot(<App />, el);`);
    assert.match(code, /boot\(_\$componentVNode\(App, null, \[\]\), el\)/);
    assert.doesNotMatch(code, /_\$createComponent/);
  });

  it('rewrites a namespace import', () => {
    const code = lower(`import * as what from 'what-framework';\nexport const go = (el) => what.hydrate(<App />, el);`);
    assert.match(code, /what\.hydrate\(_\$componentVNode\(App, null, \[\]\), el\)/);
    assert.doesNotMatch(code, /_\$createComponent/);
  });

  it('rewrites an import of the render entry too', () => {
    const code = lower(`import { hydrate } from 'what-framework/render';\nexport const go = (el) => ${CALL};`);
    assert.match(code, /hydrate\(_\$componentVNode\(App, null, \[\]\), el\)/);
  });

  // The negative half. Each of these still has to compile to the BUILT form:
  // rewriting them would silently change what somebody else's code means.
  it('leaves a module-level function named hydrate alone', () => {
    const code = lower(`function hydrate(v, el) { el.append(v); }\nexport const go = (el) => ${CALL};`);
    assert.match(code, /hydrate\(_\$createComponent\(App, null, \[\]\), el\)/);
    assert.doesNotMatch(code, /_\$componentVNode/);
  });

  it('leaves a LOCAL hydrate that shadows the import alone', () => {
    // The one case a name check cannot get right, and the reason the lookup goes
    // through Babel's scope: the import is real, the call is not to it.
    const code = lower(
      `import { hydrate } from 'what-framework';\n` +
      `export function go(el) {\n` +
      `  const hydrate = (v, node) => node.append(v);\n` +
      `  ${CALL};\n` +
      `}`
    );
    assert.match(code, /_\$createComponent\(App, null, \[\]\)/);
    assert.doesNotMatch(code, /_\$componentVNode/);
  });

  it("leaves another package's hydrate alone", () => {
    const code = lower(`import { hydrate } from 'preact';\nexport const go = (el) => ${CALL};`);
    assert.match(code, /hydrate\(_\$createComponent\(App, null, \[\]\), el\)/);
    assert.doesNotMatch(code, /_\$componentVNode/);
  });

  it('leaves an unresolved global hydrate alone', () => {
    const code = lower(`export const go = (el) => ${CALL};`);
    assert.match(code, /hydrate\(_\$createComponent\(App, null, \[\]\), el\)/);
    assert.doesNotMatch(code, /_\$componentVNode/);
  });

  it('rewrites only the first argument, which is the only one that is a tree', () => {
    const code = lower(
      `import { hydrate } from 'what-framework';\n` +
      `function Container() {}\n` +
      `export const go = () => hydrate(<App />, <Container />);`
    );
    assert.match(code, /hydrate\(_\$componentVNode\(App, null, \[\]\), _\$createComponent\(Container, null, \[\]\)\)/);
  });

  it('leaves mount() building its component, as it always did', () => {
    const code = lower(`import { mount } from 'what-framework';\nexport const go = (el) => mount(<App />, el);`);
    assert.match(code, /mount\(_\$createComponent\(App, null, \[\]\), el\)/);
    assert.doesNotMatch(code, /_\$componentVNode/);
  });

  it('imports the unbuilt helper only where it is used', () => {
    const rewritten = lower(`import { hydrate } from 'what-framework';\nexport const go = (el) => ${CALL};`);
    assert.match(rewritten, /import \{[^}]*_\$componentVNode[^}]*\} from "what-framework\/render"/);

    const untouched = lower(`import { mount } from 'what-framework';\nexport const go = (el) => mount(<App />, el);`);
    assert.doesNotMatch(untouched, /_\$componentVNode/);
  });
});
