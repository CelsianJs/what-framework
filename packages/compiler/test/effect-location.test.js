// A useEffect is located at its own call: the dependency diagnostics
// (ERR_EFFECT_DEP_NOT_FUNCTION, ERR_EFFECT_DEP_NOT_SIGNAL) report `at` the
// useEffect line, not where the component is rendered, and the effect's
// location, which what_explain shows, is project relative. Compiled code
// carries what-compiler's location; code the compiler did not see is located
// from the stack, with a dev server's origin and its `?t=` stamp removed.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();
const { mount, flushSync, h } = await import('what-framework');
const hooks = await import('what-framework');
const internal = await import('../../core/src/entries/internal.js');
const { capture } = await import('../../core/src/diagnostics.js');

const SOURCE = `import { useEffect } from 'what-framework';
export function List(props) {
  useEffect(() => {
    props.filter;
  }, [props.filter]);
  useEffect(function track() { props.filter; });
  return <ul />;
}
export function Page() {
  return <section><List filter="a" /></section>;
}
`;
const options = { filename: '/proj/src/List.jsx', pluginOptions: { devMetadata: true, projectRoot: '/proj' } };

let created;
before(() => {
  created = [];
  internal.__setDevToolsHooks({
    onSignalCreate() {}, onSignalUpdate() {}, onEffectDispose() {}, onComponentMount() {}, onComponentUnmount() {}, onEffectRun() {}, onError() {},
    onEffectCreate(node) { created.push(node); },
  });
});
after(() => internal.__setDevToolsHooks(null));

function run(Page) {
  const cap = capture({ quiet: true });
  const host = document.createElement('div');
  const dispose = mount(h(Page), host);
  flushSync();
  cap.stop();
  dispose();
  return cap.events.filter((e) => e.code.startsWith('ERR_EFFECT_DEP_'));
}

describe('a useEffect\'s location', () => {
  it('the compiler hands useEffect its own call\'s location', () => {
    const code = compileJSX(SOURCE, options);
    assert.match(code, /\}, \[props\.filter\], "useEffect@src\/List\.jsx:3:3"\);/);
    assert.match(code, /useEffect\(function track\(\) \{[^}]*\}, undefined, "useEffect@src\/List\.jsx:6:3"\);/);
    assert.doesNotMatch(compileJSX(SOURCE, { ...options, production: true }), /@src\/List/, 'never in production');
  });

  it('the dependency diagnostic is at the useEffect line, and so is the effect', async () => {
    const mod = await loadCompiled(SOURCE, options);
    created.length = 0;
    const [event] = run(mod.Page);
    assert.equal(event.code, 'ERR_EFFECT_DEP_NOT_FUNCTION');
    assert.equal(event.loc, 'src/List.jsx:3:3');
    assert.deepEqual(event.owner.slice(-1), ['<List>'], 'the owner still names the component');
    const names = created.map((e) => e.devName).filter(Boolean);
    assert.ok(names.includes('useEffect@src/List.jsx:3:3'), names.join(', '));
    assert.ok(names.includes('track@src/List.jsx:6:3'), names.join(', '));
  });

  it('code the compiler did not see is located from the stack, relative to the page\'s origin', () => {
    const page = vm.runInThisContext(`(function (hooks, h) {
      function List(props) {
        hooks.useEffect(() => {}, [props.filter]);
        hooks.useEffect(() => {});
        return h('ul', null);
      }
      return function Page() { return h(List, { filter: 'a' }); };
    })`, { filename: 'http://localhost:5173/src/Uncompiled.jsx?t=1732630000000' })(hooks, h);
    created.length = 0;
    const [event] = run(page);
    assert.equal(event.loc, 'src/Uncompiled.jsx:3:15');
    const locs = created.map((e) => e.devName).filter((n) => n?.startsWith('useEffect@'));
    assert.deepEqual(locs, ['useEffect@src/Uncompiled.jsx:3:15', 'useEffect@src/Uncompiled.jsx:4:15']);
  });

  it('a file outside the dev server\'s root (/@fs/) keeps its absolute path', () => {
    const page = vm.runInThisContext(`(function (hooks, h) {
      return function Page() { hooks.useEffect(() => {}, ['x']); return h('i', null); };
    })`, { filename: 'http://localhost:5173/@fs/Users/me/lib/Widget.jsx?v=3' })(hooks, h);
    const [event] = run(page);
    assert.equal(event.loc, '/Users/me/lib/Widget.jsx:2:38');
  });
});
