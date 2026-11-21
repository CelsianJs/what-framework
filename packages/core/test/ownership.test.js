// Ownership: every piece of reactive work belongs to an owner that disposes
// it. An effect or computed owns what its run creates and disposes it before
// the next run; a component is an owner, so removing it disposes everything
// its body and bindings created; boundaries are handlers on owners; hooks and
// context resolve through the owner tree.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();

const {
  signal, computed, effect, flushSync, batch, untrack, createRoot, getOwner, runWithOwner,
  mount, h, ErrorBoundary, Show, onMount, onCleanup, useEffect, useSignal,
  createContext, useContext, Portal,
} = await import('../src/index.js');
const { memo, __subsOf, __ownerOf, __ownerPath, _userEffect } = await import('../src/reactive.js');
const { insert, mapArray } = await import('../src/render.js');
const { capture, clearDiagnostics } = await import('../src/diagnostics.js');
const { __DEV__ } = await import('../src/env.js');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let host;
let errors;
const originalError = console.error;
beforeEach(() => {
  host = document.getElementById('app');
  host.textContent = '';
  errors = [];
  console.error = (...args) => errors.push(args);
});
afterEach(() => {
  mount(null, host)();
  console.error = originalError;
});

describe('an effect owns what its run creates', () => {
  it('disposes effects, computeds, roots and cleanups of a run before the next run', () => {
    const outer = signal(0);
    const inner = signal(0);
    const log = [];
    const stop = effect(() => {
      const run = outer();
      effect(() => { inner(); log.push(`effect ${run}`); });
      const c = computed(() => inner() * 2);
      effect(() => { c(); });
      createRoot(() => { onCleanup(() => log.push(`root ${run}`)); });
      onCleanup(() => log.push(`cleanup ${run}`));
    });
    assert.deepEqual(log, ['effect 0']);
    outer(1);
    flushSync();
    // Child roots first, then the run's own disposals in reverse order.
    assert.deepEqual(log, ['effect 0', 'root 0', 'cleanup 0', 'effect 1']);
    log.length = 0;
    inner(1);
    flushSync();
    assert.deepEqual(log, ['effect 1'], 'only the live run\'s nested effect answers');
    stop();
    assert.deepEqual(log, ['effect 1', 'root 1', 'cleanup 1']);
    if (__DEV__) assert.equal(__subsOf(inner).length, 0);
  });

  it('owns what a re-run creates, which a flush started inside a root does not take', () => {
    const s = signal(0);
    const t = signal(0);
    let runs = 0;
    const stop = createRoot((dispose) => {
      effect(() => { if (s()) createRoot(() => effect(() => { t(); runs++; })); });
      return dispose;
    });
    s(1);
    createRoot(() => flushSync());
    t(1);
    flushSync();
    assert.equal(runs, 2);
    stop();
    t(2);
    flushSync();
    assert.equal(runs, 2, 'disposed with the effect that created it');
  });

  it('getOwner() in a run is that run, so work attached after an await goes with it', async () => {
    const s = signal(0);
    const t = signal(0);
    let runs = 0;
    let pending = Promise.resolve();
    const stop = effect(() => {
      s();
      const owner = getOwner();
      pending = Promise.resolve().then(() => runWithOwner(owner, () => effect(() => { t(); runs++; })));
    });
    await pending;
    t(1);
    flushSync();
    assert.equal(runs, 2);
    s(1);
    flushSync();
    await pending;
    t(2);
    flushSync();
    assert.equal(runs, 4, 'the first run\'s effect went with that run');
    stop();
    t(3);
    flushSync();
    assert.equal(runs, 4);
  });

  it('work attached to a run that was superseded is disposed at once', async () => {
    const s = signal(0);
    const t = signal(0);
    let owner = null;
    let runs = 0;
    const stop = effect(() => { s(); owner = owner || getOwner(); });
    s(1);
    flushSync();
    runWithOwner(owner, () => effect(() => { t(); runs++; }));
    t(1);
    flushSync();
    assert.equal(runs, 1, 'ran its first run only');
    stop();
  });

  it('a computed owns what its evaluation creates', () => {
    const s = signal(0);
    const t = signal(0);
    let runs = 0;
    const c = computed(() => { const v = s(); effect(() => { t(); runs++; }); return v; });
    const stop = effect(() => { c(); });
    s(1);
    flushSync();
    t(1);
    flushSync();
    assert.equal(runs, 3, 'one effect per evaluation, the earlier one disposed');
    stop();
  });

  it('what a computed creates inside untrack() still belongs to its evaluation', () => {
    const s = signal(0);
    const t = signal(0);
    let runs = 0;
    const c = computed(() => { const v = s(); untrack(() => effect(() => { t(); runs++; })); return v; });
    const stop = effect(() => { c(); });
    s(1);
    flushSync();
    runs = 0;
    t(1);
    flushSync();
    assert.equal(runs, 1, 'only the latest evaluation\'s effect answers');
    stop();
  });

  it('an explicit owner set in a run stays current through untrack()', () => {
    const s = signal(0);
    let cleaned = 0;
    const stop = effect(() => {
      s();
      createRoot((dispose) => {
        untrack(() => onCleanup(() => { cleaned++; }));
        dispose();
      });
    });
    assert.equal(cleaned, 1, 'the cleanup went to the root, which disposed it');
    stop();
  });

  it('an effect that creates nothing and reads nothing is still released', () => {
    createRoot((dispose) => {
      effect(() => {});
      assert.equal(getOwner().disposals.length, 0);
      dispose();
    });
  });
});

describe('components are owners', () => {
  it('a branch flip disposes the effects, bindings and cleanups of the component it removes', async () => {
    const mod = await loadCompiled(`
      import { signal, effect, onCleanup } from 'what-framework';
      export const show = signal(true);
      export const value = signal(0);
      export const R = { effect: 0, text: 0, attr: 0, cleanups: 0 };
      function Child() {
        effect(() => { value(); R.effect++; });
        onCleanup(() => { R.cleanups++; });
        return <i title={(R.attr++, String(value()))}>{() => (R.text++, value())}</i>;
      }
      export const App = () => <div>{() => show() ? <Child /> : <b>off</b>}</div>;
    `);
    mount(mod.App, host);
    mod.show(false);
    flushSync();
    assert.equal(mod.R.cleanups, 1);
    const before = { ...mod.R };
    mod.value(1);
    flushSync();
    assert.deepEqual(mod.R, before, 'nothing of the removed component runs');
  });

  it('mount() into a mounted container disposes the root it held', async () => {
    const mod = await loadCompiled(`
      import { signal, effect, onCleanup } from 'what-framework';
      export const count = signal(0);
      export const R = { runs: 0, cleanups: 0 };
      export function App() {
        effect(() => { count(); R.runs++; });
        onCleanup(() => { R.cleanups++; });
        return <p>{count()}</p>;
      }
    `);
    mount(h(mod.App, {}), host);
    mount(h(mod.App, {}), host);
    assert.equal(mod.R.cleanups, 1);
    const before = mod.R.runs;
    mod.count(1);
    flushSync();
    assert.equal(mod.R.runs - before, 1, 'only the live mount answers');
  });

  it('mount(<App />) adopts App, which was built before mount() made its root', async () => {
    const mod = await loadCompiled(`
      import { signal, effect, onCleanup } from 'what-framework';
      export const count = signal(0);
      export const R = { runs: 0, cleanups: 0 };
      function App() {
        effect(() => { count(); R.runs++; });
        onCleanup(() => { R.cleanups++; });
        return <p>{() => count()}</p>;
      }
      export const start = (el) => mount(<App />, el);
      import { mount } from 'what-framework';
    `);
    const unmount = mod.start(host);
    unmount();
    assert.equal(mod.R.cleanups, 1);
    const before = mod.R.runs;
    mod.count(1);
    flushSync();
    assert.equal(mod.R.runs, before);
  });

  it('context resolves through owners in regions, list rows and portals built long after', () => {
    const Theme = createContext('none');
    const flag = signal(false);
    const items = signal([]);
    const seen = [];
    function Reader({ where }) {
      seen.push(`${where}:${useContext(Theme)}`);
      return null;
    }
    const target = document.createElement('div');
    mount(h(Theme, { value: 'dark' },
      h('div', {},
        () => (flag() ? h(Reader, { where: 'region' }) : null),
        () => items().map((k) => h(Reader, { key: k, where: `row ${k}` })),
        h(Portal, { target }, h(Reader, { where: 'portal' })),
      ),
    ), host);
    flag(true);
    items(['a']);
    flushSync();
    assert.deepEqual(seen.sort(), ['portal:dark', 'region:dark', 'row a:dark']);
  });

  it('hooks resolve through the owner: a hook in a region of a component belongs to it', () => {
    const show = signal(true);
    let inner;
    function Panel() {
      return () => (show() ? (inner = useSignal(1), 'on') : 'off');
    }
    mount(h(Panel, {}), host);
    assert.equal(typeof inner, 'function');
  });

  it('a portal removes its nodes when its owner is disposed', () => {
    const target = document.body.appendChild(document.createElement('div'));
    const show = signal(true);
    mount(h('div', {}, () => (show() ? h(Portal, { target }, h('p', {}, 'portal')) : null)), host);
    assert.equal(target.textContent, 'portal');
    show(false);
    flushSync();
    assert.equal(target.textContent, '');
    target.remove();
  });
});

describe('boundaries are handlers on owners', () => {
  function boundary(children, caught) {
    return h(ErrorBoundary, {
      onError: (e) => caught.push(e.message),
      fallback: ({ error, reset }) => h('b', { onclick: reset }, `fallback: ${error.message}`),
    }, children);
  }

  for (const [name, Child] of Object.entries({
    'an effect re-run': ({ fail }) => { effect(() => { if (fail()) throw new Error('effect'); }); return h('i', {}, 'ok'); },
    'a binding': ({ fail }) => h('i', {}, () => { if (fail()) throw new Error('binding'); return 'ok'; }),
    'a computed read in a binding': ({ fail }) => {
      const c = computed(() => { if (fail()) throw new Error('computed'); return 'ok'; });
      return h('i', {}, () => c());
    },
    'a cleanup': ({ fail }) => { effect(() => { const was = fail(); return () => { if (!was) throw new Error('cleanup'); }; }); return h('i', {}, 'ok'); },
    'a list row created on a re-run': ({ fail }) => {
      function Row({ id }) {
        effect(() => { if (fail() && id === 'b') throw new Error('row'); });
        return h('u', {}, id);
      }
      return h('ul', {}, () => (fail() ? ['a', 'b'] : ['a']).map((id) => h(Row, { key: id, id })));
    },
    'a component created later': ({ fail }) => {
      function Thrower() { throw new Error('later'); }
      return h('i', {}, () => (fail() ? h(Thrower, {}) : 'ok'));
    },
  })) {
    it(`catches an error from ${name}, and reset() rebuilds the children`, () => {
      const fail = signal(false);
      const caught = [];
      mount(h('main', {}, boundary(h(Child, { fail }), caught)), host);
      assert.equal(host.textContent, host.querySelector('main').textContent);
      assert.ok(!host.querySelector('b'));
      fail(true);
      flushSync();
      assert.equal(caught.length > 0, true, 'the boundary caught it');
      const fb = host.querySelector('b');
      assert.ok(fb, 'the fallback is shown');
      assert.deepEqual(errors, [], 'nothing is logged');
      fail(false);
      fb.click();
      flushSync();
      assert.ok(!host.querySelector('b'), 'reset shows the children again');
      assert.ok(host.querySelector('i, ul'));
    });
  }

  it('the children of a boundary that caught stop running, and a fresh copy runs after reset', () => {
    const fail = signal(false);
    const beat = signal(0);
    let beats = 0;
    let reset;
    function Child() {
      effect(() => { beat(); beats++; });
      effect(() => { if (fail()) throw new Error('x'); });
      return null;
    }
    mount(h(ErrorBoundary, { fallback: (p) => { reset = p.reset; return 'fb'; } }, h(Child, {})), host);
    fail(true);
    flushSync();
    beats = 0;
    beat(1);
    flushSync();
    assert.equal(beats, 0);
    fail(false);
    reset();
    flushSync();
    beats = 0;
    beat(2);
    flushSync();
    assert.equal(beats, 1);
  });

  it('with no boundary, an error is logged and everything keeps running', () => {
    const fail = signal(false);
    const beat = signal(0);
    let beats = 0;
    mount(h('div', {}, () => { beat(); beats++; if (fail()) throw new Error('loose'); return 'x'; }), host);
    fail(true);
    flushSync();
    assert.equal(errors.length, 1);
    beat(1);
    flushSync();
    assert.equal(beats, 3, 'the binding keeps answering');
  });

  it('an error in a fallback goes to the boundary above', () => {
    const fail = signal(false);
    const caught = [];
    function Child() { effect(() => { if (fail()) throw new Error('inner'); }); return null; }
    mount(boundary(h(ErrorBoundary, { fallback: () => { throw new Error('fallback'); } }, h(Child, {})), caught), host);
    fail(true);
    flushSync();
    assert.deepEqual(caught, ['fallback']);
    assert.match(host.textContent, /fallback: fallback/);
  });

  it('hands an error to the devtools onError hook once', async () => {
    const { __setDevToolsHooks } = await import('../src/reactive.js');
    const seen = [];
    __setDevToolsHooks({ onError: (err) => seen.push(err) });
    try {
      const fail = signal(false);
      function Child() { effect(() => { if (fail()) throw new Error('once'); }); return null; }
      mount(boundary(h(Child, {}), []), host);
      fail(true);
      flushSync();
      if (__DEV__) assert.equal(seen.filter((e) => e.message === 'once').length, 1);
    } finally {
      __setDevToolsHooks(null);
    }
  });
});

describe('useEffect and onMount run in the user phase', () => {
  it('first run on the microtask after the component, after the bindings of that flush', async () => {
    const value = signal('a');
    const log = [];
    function C() {
      let el;
      useEffect(() => { log.push(`effect sees ${el.textContent} for ${value()}`); });
      onMount(() => { log.push(`mount sees ${el.textContent}`); });
      return h('p', { ref: (e) => { el = e; } }, () => value());
    }
    mount(h(C, {}), host);
    assert.deepEqual(log, [], 'not synchronous with the component');
    await tick();
    assert.deepEqual(log, ['effect sees a for a', 'mount sees a']);
    value('b');
    flushSync();
    assert.deepEqual(log.slice(2), ['effect sees b for b'], 'a re-run sees the binding it shares a flush with');
  });

  it('a component disposed before the flush never runs them', async () => {
    let ran = 0;
    function C() { useEffect(() => { ran++; }); onMount(() => { ran++; }); return null; }
    const unmount = mount(h(C, {}), host);
    unmount();
    await tick();
    assert.equal(ran, 0);
  });

  it('a user effect created during a flush runs after that flush\'s render effects', () => {
    const s = signal(0);
    const log = [];
    createRoot(() => {
      effect(() => { if (s()) _userEffect(() => { log.push('user'); }); });
      effect(() => { log.push(`render ${s()}`); });
    });
    log.length = 0;
    s(1);
    flushSync();
    assert.deepEqual(log, ['render 1', 'user']);
  });
});

describe('development owner API', { skip: !__DEV__ }, () => {
  it('names components and effects by the compiler\'s metadata, with the innermost location', async () => {
    const mod = await loadCompiled(`
      import { signal, effect } from 'what-framework';
      export const s = signal(0);
      export const R = {};
      function Row() {
        R.node = effect(function sync() { s(); }) && null;
        return <li>{() => s()}</li>;
      }
      export const App = () => <ul><Row /></ul>;
    `, { production: false, pluginOptions: { devMetadata: true }, filename: 'src/App.jsx' });
    mount(h(mod.App, {}), host);
    const li = host.querySelector('li');
    const owner = __ownerOf(li);
    assert.equal(owner.Component.name, 'Row');
    const path = __ownerPath(li);
    assert.deepEqual([...path], ['<App>', '<Row>']);
    assert.match(path.loc, /App\.jsx:\d+:\d+$/);
  });

  it('every coded diagnostic names the owner it was reported in', async () => {
    clearDiagnostics();
    const diagnostics = capture({ quiet: true });
    try {
      function Keyed() {
        return h('ul', {}, mapArray(() => [1, 1], (n) => document.createTextNode(String(n)), { key: (n) => n }));
      }
      mount(h(Keyed, {}), host);
      const [event] = diagnostics.events.filter((e) => e.code === 'ERR_DUPLICATE_KEY');
      assert.deepEqual(event.owner, ['<Keyed>']);
    } finally {
      diagnostics.stop();
    }
  });

  it('reports an effect created after an await in an async onMount, under no owner', async () => {
    clearDiagnostics();
    const diagnostics = capture({ quiet: true });
    let stop = () => {};
    try {
      function Loader() {
        onMount(async () => {
          await Promise.resolve();
          stop = effect(function late() { signal(0)(); });
        });
        return null;
      }
      mount(h(Loader, {}), host);
      await tick();
      const [event] = diagnostics.events.filter((e) => e.code === 'ERR_ORPHAN_EFFECT');
      assert.ok(event, 'reported');
      assert.deepEqual(event.owner, ['<Loader>']);
    } finally {
      stop();
      diagnostics.stop();
    }
  });

  it('leaves the rejection of an async onMount or useEffect callback unhandled, as production does', () => {
    // In its own process: the test runner fails whichever test an unhandled
    // rejection lands in.
    const script = `
      import { installDOM } from ${JSON.stringify(new URL('../../../test-utils/dom.js', import.meta.url).href)};
      installDOM();
      const { mount, h, onMount, useEffect } = await import(${JSON.stringify(new URL('../src/index.js', import.meta.url).href)});
      const rejected = [];
      process.on('unhandledRejection', (err) => rejected.push(err.message));
      function Loader() {
        onMount(async () => { await Promise.resolve(); throw new Error('mount failed'); });
        useEffect(async () => { throw new Error('effect failed'); });
        return null;
      }
      mount(h(Loader, {}), document.getElementById('app'));
      setTimeout(() => console.log(JSON.stringify(rejected.sort())), 10);
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), ['effect failed', 'mount failed']);
  });
});

describe('memo and batch keep their owner rules', () => {
  it('a memo created in a run belongs to that run', () => {
    const s = signal(0);
    const t = signal(1);
    const evaluations = [];
    let m;
    const stop = effect(() => { const run = s(); m = memo(() => { evaluations.push(run); return t(); }); });
    s(1);
    flushSync();
    evaluations.length = 0;
    batch(() => t(2));
    assert.equal(m(), 2);
    assert.deepEqual(evaluations, [1], 'only the live run\'s memo evaluates again');
    stop();
  });
});

describe('Show keeps its owner rules', () => {
  it('a component Show removes is disposed', () => {
    const when = signal(true);
    let cleaned = 0;
    function C() { onCleanup(() => { cleaned++; }); return 'c'; }
    mount(h(Show, { when }, h(C, {})), host);
    when(false);
    flushSync();
    assert.equal(cleaned, 1);
  });
});

describe('insert() under an owner', () => {
  it('stops with the owner it was called under', () => {
    const s = signal(0);
    let runs = 0;
    const el = document.createElement('div');
    const dispose = createRoot((d) => { insert(el, () => { runs++; return s(); }); return d; });
    dispose();
    s(1);
    flushSync();
    assert.equal(runs, 1);
  });
});
