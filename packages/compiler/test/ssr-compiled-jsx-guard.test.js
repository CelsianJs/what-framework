// what-compiler output is client-only, and this pins the two places that now
// SAY so instead of failing in a way that names the wrong thing.
//
// The fact, measured rather than assumed (probe in the PR body): a component
// whose body what-compiler lowered returns `_tmpl$0()`, a cloneNode of a
// module-scope <template>. It is finished DOM, not a vnode. Two consequences,
// and before this change both were reported misleadingly:
//
//   - On a real server there is no `document`, and the _$template() call is
//     HOISTED TO MODULE SCOPE, so the module throws `ReferenceError: document is
//     not defined` at IMPORT time, from inside what-core, naming no file of the
//     developer's.
//   - Where a DOM does exist (jsdom in a test, a shim), the component returns an
//     Element, every renderer destructures `vnode.tag` off it, gets `undefined`,
//     and reported ERR_INVALID_SSR_TAG: "Invalid tag name in SSR: undefined".
//     That code's own documentation blames a component returning a plain object
//     or a typo'd tag. Neither is what happened.
//
// The Vite plugin now refuses the transform when it is compiling for the SSR
// environment AND the output builds DOM, which is a build-time verdict on a
// build-time fact. what-server raises the same code as the backstop.
//
// NEGATIVE CONTROLS ARE THE POINT of half this file. A guard that fires on
// everything is not a guard, it is an outage: the client transform, a JSX-free
// server-action module, a hydrate()-only module, and `ssrGuard: false` must all
// still compile in an SSR graph. Those cases pass with the fix reverted too, and
// they must.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import whatVitePlugin from '../src/vite-plugin.js';

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
  // Refusing without saying what to do instead is a dead end. Both supported
  // spellings have to be in the text the developer actually sees.
  assert.match(thrown.message, /h\(\)/);
  assert.match(thrown.message, /jsxImportSource/);
  return thrown;
}

describe('what-compiler: SSR build guard', () => {
  it('refuses a component module compiled for the SSR environment, naming the file', () => {
    const plugin = whatVitePlugin();
    expectGuard(
      () => transform(plugin, COMPONENT_JSX, '/proj/src/App.jsx', { ssr: true }),
      { file: '/proj/src/App.jsx' },
    );
  });

  it('refuses a module whose JSX is only a component tag (_$createComponent builds DOM too)', () => {
    const plugin = whatVitePlugin();
    expectGuard(
      () => transform(plugin, COMPONENT_ONLY_JSX, '/proj/src/Page.jsx', { ssr: true }),
      { file: '/proj/src/Page.jsx' },
    );
  });

  it('detects the SSR environment through the Environment API, not only the ssr flag', () => {
    // Vite 6+ routes this through `this.environment`. A plugin that only read
    // the third argument would silently stop guarding.
    const plugin = whatVitePlugin();
    expectGuard(
      () => transform(plugin, COMPONENT_JSX, '/proj/src/App.jsx', { environment: { name: 'ssr' } }),
      { file: '/proj/src/App.jsx' },
    );
  });

  it('strips a query suffix from the file it names', () => {
    const plugin = whatVitePlugin();
    const err = expectGuard(
      () => transform(plugin, COMPONENT_JSX, '/proj/src/App.jsx?v=123', { ssr: true }),
      { file: '/proj/src/App.jsx' },
    );
    assert.ok(!err.message.includes('?v=123'), 'the version query is noise in an error message');
  });

  // --- negative controls: these pass on BOTH arms and must ------------------

  it('compiles the same module normally for the client', () => {
    const plugin = whatVitePlugin();
    const out = transform(plugin, COMPONENT_JSX, '/proj/src/App.jsx', { ssr: false });
    assert.ok(out && out.code, 'client transform must still produce code');
    assert.match(out.code, /_\$template/);
  });

  it('does not fire on a client-environment transform reported through the Environment API', () => {
    const plugin = whatVitePlugin();
    const out = transform(plugin, COMPONENT_JSX, '/proj/src/App.jsx', { environment: { name: 'client' } });
    assert.ok(out && out.code);
  });

  it('does not fire on a JSX-free server-action module in the SSR graph', () => {
    // This is the module the SSR graph legitimately contains, and it emits
    // nothing that builds DOM. A guard keyed on "the plugin ran" would break
    // every server action in the project.
    const plugin = whatVitePlugin();
    const out = transform(plugin, SERVER_ACTION_JS, '/proj/src/actions.js', { ssr: true });
    assert.ok(out && out.code, 'server-action module must still compile for the server');
    assert.doesNotMatch(out.code, /_\$template/);
  });

  it('does not fire on a hydrate()-only module, whose JSX lowers to an unbuilt vnode', () => {
    const plugin = whatVitePlugin();
    const out = transform(plugin, HYDRATE_ONLY_JSX, '/proj/src/entry-client.jsx', { ssr: true });
    assert.ok(out && out.code);
    assert.match(out.code, /_\$componentVNode/);
    assert.doesNotMatch(out.code, /_\$template/);
  });

  it('honours ssrGuard: false for a project that has installed a DOM on purpose', () => {
    const plugin = whatVitePlugin({ ssrGuard: false });
    const out = transform(plugin, COMPONENT_JSX, '/proj/src/App.jsx', { ssr: true });
    assert.ok(out && out.code);
    assert.match(out.code, /_\$template/);
  });

  it('leaves excluded files alone in the SSR graph', () => {
    const plugin = whatVitePlugin();
    const out = transform(plugin, COMPONENT_JSX, '/proj/node_modules/dep/App.jsx', { ssr: true });
    assert.equal(out, null);
  });
});
