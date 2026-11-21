// Vite's server transforms and what-compiler.
//
// By default a module Vite transforms for the server (the third `transform`
// argument `{ ssr: true }`, or `this.environment.name === 'ssr'` from Vite 6)
// is compiled with the server target: string templates that what-server
// renders, with no _$template() or DOM in sight. The first block pins that.
//
// The guard that used to be the only answer is still there for projects that
// opt out with `ssr: false`: their compiled client output would build DOM on a
// server, so a server transform of it is refused with ERR_COMPILED_JSX_IN_SSR,
// naming the file, instead of shipping a module that throws "document is not
// defined" the first time it renders.
//
// NEGATIVE CONTROLS ARE THE POINT of the second block. A guard that fires on
// everything is not a guard, it is an outage: the client transform, a JSX-free
// server-action module, a hydrate()-only module, and `ssrGuard: false` must all
// still compile in an SSR graph.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import whatVitePlugin from '../src/vite-plugin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SSR_RUNTIME = path.resolve(here, '../../server/src/ssr-runtime.js');
const { renderToString } = await import('../../server/src/index.js');
const { h } = await import('../../core/src/index.js');

const COMPONENT_JSX = `
export function App() {
  return <div class="app"><h1>Title</h1></div>;
}
`;

// Lowers to _$createComponent (a component tag, no host element), which builds
// DOM just as surely as a template does.
const COMPONENT_ONLY_JSX = `
import { Card } from './card.js';
export function App() { return <Card title="x" />; }
`;

// The one JSX position what-compiler deliberately leaves UNBUILT (PR #72): the
// argument of hydrate() lowers to _$componentVNode, which is a plain vnode. The
// module touches no document at import, so flagging it would be a false
// positive, and this is the case most likely to be broken by a lazy guard that
// keys off the file extension or the module specifier.
const HYDRATE_ONLY_JSX = `
import { hydrate } from 'what-framework/render';
import { App } from './app.jsx';
hydrate(<App />, document.getElementById('root'));
`;

// No JSX at all. Compiled here only so its server action gets an ID.
const SERVER_ACTION_JS = `
import { action } from 'what-framework/server';
export const save = action(async (data) => data);
`;

function transform(plugin, code, id, { ssr = false, environment } = {}) {
  const ctx = environment ? { environment } : {};
  return plugin.transform.call(ctx, code, id, ssr ? { ssr: true } : undefined);
}

function expectGuard(fn, { file }) {
  let thrown = null;
  try { fn(); } catch (e) { thrown = e; }
  assert.ok(thrown, 'expected the SSR guard to throw, but the transform succeeded');
  assert.equal(thrown.code, 'ERR_COMPILED_JSX_IN_SSR', `wrong code: ${thrown.code} — ${thrown.message}`);
  // Naming the file is the whole reason this beats the runtime failures it
  // replaces; a guard that says "something somewhere" is not an improvement.
  assert.ok(thrown.message.includes(file), `message must name the file, got: ${thrown.message}`);
  assert.equal(thrown.id, file);
  // Refusing without saying what to do instead is a dead end: the server
  // target, and both h() spellings, have to be in the text the developer sees.
  assert.match(thrown.message, /ssr: false/);
  assert.match(thrown.message, /h\(\)/);
  assert.match(thrown.message, /jsxImportSource/);
  return thrown;
}

describe('what-compiler: server transforms use the server target', () => {
  it('compiles a component module for the server instead of refusing it', async () => {
    const plugin = whatVitePlugin();
    const out = transform(plugin, COMPONENT_JSX, '/proj/src/App.jsx', { ssr: true });
    assert.ok(out && out.code);
    assert.match(out.code, /from "what-framework\/ssr-runtime"/);
    assert.doesNotMatch(out.code, /_\$template|_\$createComponent|document/);
    const dir = mkdtempSync(path.join(tmpdir(), 'what-vite-ssr-'));
    try {
      const file = path.join(dir, 'App.mjs');
      writeFileSync(file, out.code.replace('"what-framework/ssr-runtime"', JSON.stringify(SSR_RUNTIME)));
      const { App } = await import(pathToFileURL(file).href);
      assert.equal(renderToString(h(App)), '<div class="app"><h1>Title</h1></div>');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('compiles a module whose JSX is only a component tag to a vnode', () => {
    const plugin = whatVitePlugin();
    const out = transform(plugin, COMPONENT_ONLY_JSX, '/proj/src/Page.jsx', { ssr: true });
    assert.match(out.code, /_\$ssrComponent\(Card,/);
  });

  it('detects the SSR environment through the Environment API, not only the ssr flag', () => {
    const plugin = whatVitePlugin();
    const out = transform(plugin, COMPONENT_JSX, '/proj/src/App.jsx', { environment: { name: 'ssr' } });
    assert.match(out.code, /what-framework\/ssr-runtime/);
  });

  it('never appends the browser HMR boundary to a server module', () => {
    const plugin = whatVitePlugin({ production: false });
    plugin.configResolved({ root: '/proj', command: 'serve' });
    const server = transform(plugin, COMPONENT_JSX, '/proj/src/App.jsx', { ssr: true });
    const client = transform(plugin, COMPONENT_JSX, '/proj/src/App.jsx');
    assert.doesNotMatch(server.code, /HMR Boundary/);
    assert.match(client.code, /HMR Boundary/);
  });
});

describe('what-compiler: SSR build guard (ssr: false)', () => {
  it('refuses a component module compiled for the SSR environment, naming the file', () => {
    const plugin = whatVitePlugin({ ssr: false });
    expectGuard(
      () => transform(plugin, COMPONENT_JSX, '/proj/src/App.jsx', { ssr: true }),
      { file: '/proj/src/App.jsx' },
    );
  });

  it('refuses a module whose JSX is only a component tag (_$createComponent builds DOM too)', () => {
    const plugin = whatVitePlugin({ ssr: false });
    expectGuard(
      () => transform(plugin, COMPONENT_ONLY_JSX, '/proj/src/Page.jsx', { ssr: true }),
      { file: '/proj/src/Page.jsx' },
    );
  });

  it('detects the SSR environment through the Environment API, not only the ssr flag', () => {
    // Vite 6+ routes this through `this.environment`. A plugin that only read
    // the third argument would silently stop guarding.
    const plugin = whatVitePlugin({ ssr: false });
    expectGuard(
      () => transform(plugin, COMPONENT_JSX, '/proj/src/App.jsx', { environment: { name: 'ssr' } }),
      { file: '/proj/src/App.jsx' },
    );
  });

  it('strips a query suffix from the file it names', () => {
    const plugin = whatVitePlugin({ ssr: false });
    const err = expectGuard(
      () => transform(plugin, COMPONENT_JSX, '/proj/src/App.jsx?v=123', { ssr: true }),
      { file: '/proj/src/App.jsx' },
    );
    assert.ok(!err.message.includes('?v=123'), 'the version query is noise in an error message');
  });

  // --- negative controls -----------------------------------------------------

  it('compiles the same module normally for the client', () => {
    const plugin = whatVitePlugin({ ssr: false });
    const out = transform(plugin, COMPONENT_JSX, '/proj/src/App.jsx', { ssr: false });
    assert.ok(out && out.code, 'client transform must still produce code');
    assert.match(out.code, /_\$template/);
  });

  it('does not fire on a client-environment transform reported through the Environment API', () => {
    const plugin = whatVitePlugin({ ssr: false });
    const out = transform(plugin, COMPONENT_JSX, '/proj/src/App.jsx', { environment: { name: 'client' } });
    assert.ok(out && out.code);
  });

  it('does not fire on a JSX-free server-action module in the SSR graph', () => {
    // This is the module the SSR graph legitimately contains, and it emits
    // nothing that builds DOM. A guard keyed on "the plugin ran" would break
    // every server action in the project.
    const plugin = whatVitePlugin({ ssr: false });
    const out = transform(plugin, SERVER_ACTION_JS, '/proj/src/actions.js', { ssr: true });
    assert.ok(out && out.code, 'server-action module must still compile for the server');
    assert.doesNotMatch(out.code, /_\$template/);
  });

  it('does not fire on a hydrate()-only module, whose JSX lowers to an unbuilt vnode', () => {
    const plugin = whatVitePlugin({ ssr: false });
    const out = transform(plugin, HYDRATE_ONLY_JSX, '/proj/src/entry-client.jsx', { ssr: true });
    assert.ok(out && out.code);
    assert.match(out.code, /_\$componentVNode/);
    assert.doesNotMatch(out.code, /_\$template/);
  });

  it('honours ssrGuard: false for a project that has installed a DOM on purpose', () => {
    for (const options of [{ ssrGuard: false }, { ssr: false, ssrGuard: false }]) {
      const plugin = whatVitePlugin(options);
      const out = transform(plugin, COMPONENT_JSX, '/proj/src/App.jsx', { ssr: true });
      assert.ok(out && out.code);
      assert.match(out.code, /_\$template/);
    }
  });

  it('leaves excluded files alone in the SSR graph', () => {
    const plugin = whatVitePlugin({ ssr: false });
    const out = transform(plugin, COMPONENT_JSX, '/proj/node_modules/dep/App.jsx', { ssr: true });
    assert.equal(out, null);
  });
});
