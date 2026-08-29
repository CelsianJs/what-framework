// Context on the COMPILED-JSX path.
// Element children of a component used to be realized at the call site, before
// the component itself ran, so a <Provider> published its value after its own
// subtree had already read it. The compiler now emits those children behind a
// factory and the runtime calls it while the provider is on the component stack.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';

installDOM();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_INDEX = path.resolve(__dirname, '../../core/src/index.js');
const CORE_RENDER = path.resolve(__dirname, '../../core/src/render.js');

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-ctx-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

let moduleId = 0;

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

const { mount } = await import(pathToFileURL(CORE_INDEX).href);

function render(node) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mount(node, host);
  return host;
}

describe('compiled JSX: context reaches component children', () => {
  it('resolves through multiple intermediate component levels', async () => {
    const mod = await compileAndLoad(`
      import { createContext, useContext } from 'what-framework';
      export const Theme = createContext('light');
      function Leaf() { return <span class="leaf">{useContext(Theme)}</span>; }
      function Middle() { return <Inner />; }
      function Inner() { return <Leaf />; }
      export function App() {
        return <Theme.Provider value="dark"><Middle /></Theme.Provider>;
      }
    `);
    const host = render(mod.App());
    assert.equal(host.querySelector('.leaf').textContent, 'dark');
    host.remove();
  });

  it('resolves through an intervening host element', async () => {
    const mod = await compileAndLoad(`
      import { createContext, useContext } from 'what-framework';
      export const Theme = createContext('light');
      function Leaf() { return <span class="leaf">{useContext(Theme)}</span>; }
      export function App() {
        return (
          <Theme.Provider value="dark">
            <div class="wrap"><Leaf /></div>
          </Theme.Provider>
        );
      }
    `);
    const host = render(mod.App());
    assert.equal(host.querySelector('.wrap .leaf').textContent, 'dark');
    host.remove();
  });

  it('nested providers: the nearest one wins', async () => {
    const mod = await compileAndLoad(`
      import { createContext, useContext } from 'what-framework';
      export const Theme = createContext('light');
      function Leaf() { return <span class="leaf">{useContext(Theme)}</span>; }
      export function App() {
        return (
          <Theme.Provider value="dark">
            <Leaf />
            <Theme.Provider value="solar">
              <Leaf />
            </Theme.Provider>
          </Theme.Provider>
        );
      }
    `);
    const host = render(mod.App());
    const leaves = host.querySelectorAll('.leaf');
    assert.equal(leaves.length, 2);
    assert.equal(leaves[0].textContent, 'dark');
    assert.equal(leaves[1].textContent, 'solar', 'inner provider must shadow the outer one');
    host.remove();
  });

  it('sibling providers stay isolated and the default survives outside both', async () => {
    const mod = await compileAndLoad(`
      import { createContext, useContext } from 'what-framework';
      export const Theme = createContext('light');
      function Leaf() { return <span class="leaf">{useContext(Theme)}</span>; }
      export function App() {
        return (
          <div class="root">
            <Theme.Provider value="dark"><Leaf /></Theme.Provider>
            <Theme.Provider value="solar"><Leaf /></Theme.Provider>
            <Leaf />
          </div>
        );
      }
    `);
    const host = render(mod.App());
    const leaves = [...host.querySelectorAll('.leaf')].map(el => el.textContent);
    assert.deepEqual(leaves, ['dark', 'solar', 'light']);
    host.remove();
  });

  it('works for a plain (non-dotted) Provider component too', async () => {
    const mod = await compileAndLoad(`
      import { createContext, useContext } from 'what-framework';
      const Theme = createContext('light');
      const Provider = Theme.Provider;
      function Leaf() { return <span class="leaf">{useContext(Theme)}</span>; }
      export function App() {
        return <Provider value="dark"><Leaf /></Provider>;
      }
    `);
    const host = render(mod.App());
    assert.equal(host.querySelector('.leaf').textContent, 'dark');
    host.remove();
  });
});

describe('compiled JSX: member-expression tags', () => {
  it('lowers <Ctx.Provider> to _$createComponent, not a template', () => {
    const code = compileJSX('export const A = () => <Ctx.Provider value="dark"><B /></Ctx.Provider>;');
    assert.match(code, /_\$createComponent\(Ctx\.Provider, \{/);
    assert.doesNotMatch(code, /undefined/);
    assert.doesNotMatch(code, /_\$template/);
  });

  it('lowers a deeply dotted tag to the full member expression', () => {
    const code = compileJSX('export const A = () => <Foo.Bar.Baz x={1} />;');
    assert.match(code, /_\$createComponent\(Foo\.Bar\.Baz, \{/);
  });

  it('treats a dotted tag nested in a host element as a dynamic child', () => {
    const code = compileJSX('export const A = () => <div><Ctx.Provider value="d"><B /></Ctx.Provider></div>;');
    assert.match(code, /_\$template\("<div><!--\$--><\/div>"\)/);
    assert.match(code, /_\$insert\(_el\$0, _\$createComponent\(Ctx\.Provider/);
  });
});

describe('compiled JSX: host-element codegen is untouched', () => {
  it('emits the same _$template output as before deferred children', () => {
    const code = compileJSX(`
export function App() {
  return (
    <div class="card">
      <h1>Title</h1>
      <p>Body</p>
    </div>
  );
}
`);
    assert.equal(code, `import { _$template } from "what-framework/render";
const _tmpl$0 = /* @__PURE__ */_$template("<div class=\\"card\\"><h1>Title</h1><p>Body</p></div>");
export function App() {
  return _tmpl$0();
}`);
  });

  it('does not wrap text-only children of a component in a factory', () => {
    const code = compileJSX('export const A = () => <Card>hello</Card>;');
    assert.match(code, /_\$createComponent\(Card, null, \["hello"\]\)/);
  });

  // An expression child is the shape a wrapper forwards its own children
  // through, so it has to be deferred too, or the subtree is built before the
  // component it is being handed to has run.
  //
  // The read INSIDE the factory is a thunk. This assertion used to spell it
  // `n()`, which pinned a bug rather than a contract: a component child was the
  // one JSX position the accessor auto-thunk never reached, so `<Card>{n()}
  // </Card>` was evaluated once and frozen while `<div>{n()}</div>` beside it
  // stayed live. See component-child-auto-thunk.test.js. The factory wrapper —
  // which is what this test is actually about — is unchanged.
  it('wraps expression children of a component in a factory', () => {
    const code = compileJSX('export const A = ({ n }) => <Card>hello {n()}</Card>;');
    assert.match(code, /_\$createComponent\(Card, null, \(\) => \["hello ", \(\) => n\(\)\]\)/);
  });
});
