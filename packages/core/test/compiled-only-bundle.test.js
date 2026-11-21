// A program that only uses compiled JSX must not bundle the vnode renderer
// (dom.js createDOM: element creation from vnodes, boundaries, portals). The
// renderer is installed by h.js, which every vnode producer imports, so it
// comes back exactly when something can make a vnode (T2-5). A class component
// is not a vnode: compiled JSX renders it through the bridge in render.js, so
// it works in a compiled-only bundle too. Bundled with esbuild and Rolldown,
// which honour "sideEffects": false the way Vite's production build does.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { rolldown } from 'rolldown';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';

installDOM();

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const RENDER = JSON.stringify(path.join(SRC, 'render.js'));
const INDEX = JSON.stringify(path.join(SRC, 'index.js'));
const DOM = JSON.stringify(path.join(SRC, 'dom.js'));

// Function names that only exist in the vnode renderer, and the keyed rows a
// region renders a keyed vnode list through, which h.js installs with it.
const VNODE_RENDERER = ['createElementFromVNode', 'createErrorBoundary', 'createSuspenseBoundary', 'createPortalDOM', 'createVNodeRows'];

async function bundle(source) {
  const dir = mkdtempSync(path.join(tmpdir(), 'what-compiled-only-'));
  try {
    const entry = path.join(dir, 'entry.js');
    writeFileSync(entry, source);
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      write: false,
      treeShaking: true,
      minify: false,
      logLevel: 'silent',
      define: { 'import.meta.env': 'undefined' },
    });
    return result.outputFiles[0].text;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runBundle(code) {
  const dir = mkdtempSync(path.join(tmpdir(), 'what-compiled-only-run-'));
  try {
    const file = path.join(dir, 'bundle.mjs');
    writeFileSync(file, code);
    return spawnSync(process.execPath, [file], { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'development' } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const present = (code) => VNODE_RENDERER.filter((name) => code.includes(`function ${name}`));

describe('compiled-only bundles', () => {
  it('leave the vnode renderer out of a compiled app', async () => {
    const code = await bundle(`
      import { _$template, _$createComponent, insert, _$mapKeyed } from ${RENDER};
      import { mount } from ${DOM};
      const tmpl = _$template('<p>');
      function App() { const p = tmpl(); insert(p, 'hi'); return p; }
      export const run = (el) => mount(_$createComponent(App, null, []), el);
      export const list = _$mapKeyed;
    `);
    assert.deepEqual(present(code), []);
    assert.doesNotMatch(code, /function createDOM\(/);
  });

  it('leave the list reconciler out of an app without lists', async () => {
    const code = await bundle(`
      import { _$template, insert } from ${RENDER};
      import { mount } from ${DOM};
      import { signal } from ${INDEX};
      const tmpl = _$template('<p>');
      const n = signal(0);
      export const run = (el) => mount(() => { const p = tmpl(); insert(p, () => n()); return p; }, el);
    `);
    assert.deepEqual(present(code), []);
    assert.doesNotMatch(code, /function reconcileKeyed\(/);
  });

  it('bring the renderer back with a vnode producer', async () => {
    const code = await bundle(`
      import { ErrorBoundary } from ${INDEX};
      import { _$createComponent } from ${RENDER};
      export const run = () => _$createComponent(ErrorBoundary, { fallback: 'x' }, []);
    `);
    assert.match(code, /function createDOM\(/);
    assert.ok(present(code).includes('createErrorBoundary'));
    assert.ok(present(code).includes('createVNodeRows'));
  });

  it('explain a vnode that reaches a runtime without a renderer', async () => {
    const code = await bundle(`
      import { insert } from ${RENDER};
      import { VNode } from ${JSON.stringify(path.join(SRC, 'vnode-renderer.js'))};
      const parent = { firstChild: null, insertBefore() {}, appendChild() {} };
      try {
        insert(parent, new VNode('div', {}, [], null));
        console.log('no error');
      } catch (err) {
        console.log(err.code + ' ' + err.message);
      }
    `);
    assert.deepEqual(present(code), []);
    const out = runBundle(code);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /^ERR_NO_VNODE_RENDERER /);
    assert.match(out.stdout, /no vnode renderer is installed/);
    assert.match(out.stdout, /importing h, Fragment or html/);
  });

});

// Production bundles of a compiled-only app with a class component, run
// against the test's DOM.
describe('class components in compiled-only bundles', () => {
  const app = compileJSX(`
    import { mount } from 'what-framework';
    class Legacy {
      constructor(props) { this.props = props; }
      render() { return <b>legacy {this.props.n}</b>; }
    }
    export const run = (el) => mount(() => <main><Legacy n={1} /></main>, el);
  `, { production: true }).replace(/(['"])what-framework(\/render)?\1/g, (_, q, r) => (r ? RENDER : INDEX));

  const bundlers = {
    async esbuild(entry) {
      const result = await build({
        entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', write: false,
        minify: true, logLevel: 'silent', define: { __WHAT_DEV__: 'false', 'import.meta.env': 'undefined' },
      });
      return result.outputFiles[0].text;
    },
    async rolldown(entry) {
      const result = await rolldown({ input: entry, logLevel: 'silent', transform: { define: { __WHAT_DEV__: 'false' } } });
      const { output } = await result.generate({ format: 'esm', minify: true });
      return output[0].code;
    },
  };

  for (const [name, bundleWith] of Object.entries(bundlers)) {
    it(`render with ${name}, without the vnode renderer`, async () => {
      const dir = mkdtempSync(path.join(tmpdir(), `what-class-${name}-`));
      try {
        const entry = path.join(dir, 'entry.js');
        writeFileSync(entry, app);
        const code = await bundleWith(entry);
        assert.doesNotMatch(code, /createElementFromVNode|createPortalDOM/);
        const file = path.join(dir, 'bundle.mjs');
        writeFileSync(file, code);
        const { run } = await import(pathToFileURL(file).href);
        const el = document.createElement('div');
        const unmount = run(el);
        assert.equal(el.textContent, 'legacy 1');
        assert.equal(el.querySelector('main > b').textContent, 'legacy 1');
        unmount();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

